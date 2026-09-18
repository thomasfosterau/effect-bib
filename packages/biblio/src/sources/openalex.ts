/**
 * @copyright Thomas Foster
 *
 * OpenAlex source client (biblio B3, issue #1070) — the modern
 * scholarly-graph source added alongside the OpenLibrary/Crossref refit.
 * Two capabilities, both emitting the CSL-aligned {@link BiblioRecord}:
 * a works lookup by DOI ({@link lookupOpenAlexByDoi}), and a title search
 * returning ranked candidates ({@link searchOpenAlexByTitle}) — the
 * additive `BiblioLookup.byTitle` method the B1 design doc names as what
 * OpenAlex justifies.
 *
 * **Polite-pool etiquette.** OpenAlex asks callers to identify themselves
 * with a contact email — either a `mailto` query parameter or a `mailto:`
 * User-Agent — in exchange for a faster, more reliable service tier. We do
 * both: the shared User-Agent (`service.ts`) already carries `mailto:`,
 * and every request here additionally appends `?mailto=` so the polite
 * pool applies even if a future caller swaps the User-Agent.
 *
 * Untrusted-response discipline: the {@link OpenAlexWork} schema is
 * deliberately lenient (every field optional), and the normaliser only
 * trusts what it extracts and sanitises — the same posture as the sibling
 * OpenLibrary / Crossref clients.
 *
 * @module biblio/sources/openalex
 */

import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { decodeDoi, decodeOrcid, type Doi } from "../identifiers.ts";
import {
  type BiblioRecord,
  type CslItemType,
  type CslName,
  dateFromYear,
  MAX_AUTHORS,
  parsePersonName,
  sanitiseText,
} from "../record.ts";
import { LookupFailed } from "./errors.ts";
import { makeGet } from "./http.ts";

const OPENALEX_BASE = "https://api.openalex.org";

/** The contact address sent for OpenAlex's polite-pool etiquette. */
const CONTACT_EMAIL = "me@thomasfoster.au";

/** How many search results {@link searchOpenAlexByTitle} returns at most. */
const MAX_SEARCH_RESULTS = 10;

/** Upper bound on a caller-supplied search query, defensively clamped before it reaches the URL. */
const MAX_QUERY_LENGTH = 500;

/**
 * Lenient schema for one OpenAlex `Work` object — from both the
 * single-work lookup and the `results` array of a search response. Only
 * the fields we read are modelled, all optional.
 */
export const OpenAlexWork = Schema.Struct({
  doi: Schema.optional(Schema.Unknown),
  title: Schema.optional(Schema.Unknown),
  display_name: Schema.optional(Schema.Unknown),
  type: Schema.optional(Schema.Unknown),
  publication_year: Schema.optional(Schema.Unknown),
  // `primary_location.source.display_name` is the current field for the
  // hosting journal/venue name; `host_venue.display_name` is the
  // deprecated equivalent some older responses still carry.
  primary_location: Schema.optional(Schema.Unknown),
  host_venue: Schema.optional(Schema.Unknown),
  biblio: Schema.optional(Schema.Unknown),
  authorships: Schema.optional(Schema.Array(Schema.Unknown)),
});
export type OpenAlexWork = typeof OpenAlexWork.Type;

/** Lenient schema for the `GET /works?search=...` envelope. */
export const OpenAlexSearchResponse = Schema.Struct({
  results: Schema.optional(Schema.Array(Schema.Unknown)),
});
export type OpenAlexSearchResponse = typeof OpenAlexSearchResponse.Type;

const decodeOpenAlexWork = Schema.decodeUnknownOption(OpenAlexWork);

/** OpenAlex `type` → CSL item type; unlisted types fall back to `document`. */
const OPENALEX_TYPES: Readonly<Record<string, CslItemType>> = {
  article: "article-journal",
  "book-chapter": "chapter",
  book: "book",
  dissertation: "thesis",
  dataset: "dataset",
  "peer-review": "review",
  "posted-content": "manuscript",
  "proceedings-article": "paper-conference",
  report: "report",
  standard: "standard",
  editorial: "article",
  letter: "article",
  erratum: "article",
};

/** Maps an OpenAlex `type`, defaulting to `document` for the long tail. */
function openAlexType(raw: unknown): CslItemType {
  return Predicate.isString(raw) ? (OPENALEX_TYPES[raw] ?? "document") : "document";
}

/** Reads the display name of an OpenAlex `{ source: { display_name } }` / `{ display_name }` location object. */
function locationDisplayName(value: unknown): Option.Option<string> {
  if (!Predicate.isObjectOrArray(value)) return Option.none();
  const obj = value as { display_name?: unknown; source?: unknown };
  const direct = sanitiseText(obj.display_name);
  if (Option.isSome(direct)) return direct;
  if (Predicate.isObjectOrArray(obj.source)) {
    return sanitiseText((obj.source as { display_name?: unknown }).display_name);
  }
  return Option.none();
}

/** The hosting container title: `primary_location` first, else the deprecated `host_venue`. */
function openAlexContainerTitle(work: OpenAlexWork): Option.Option<string> {
  return Option.firstSomeOf([
    locationDisplayName(work.primary_location),
    locationDisplayName(work.host_venue),
  ]);
}

/** Volume / issue / page range from OpenAlex's `biblio` sub-object. */
function openAlexBiblio(work: OpenAlexWork): {
  readonly volume?: string;
  readonly issue?: string;
  readonly page?: string;
} {
  if (!Predicate.isObjectOrArray(work.biblio)) return {};
  const b = work.biblio as {
    volume?: unknown;
    issue?: unknown;
    first_page?: unknown;
    last_page?: unknown;
  };
  const volume = sanitiseText(b.volume);
  const issue = sanitiseText(b.issue);
  const first = sanitiseText(b.first_page);
  const last = sanitiseText(b.last_page);
  const page = Option.isNone(first)
    ? Option.none()
    : Option.isNone(last)
      ? first
      : Option.some(`${first.value}-${last.value}`);
  return {
    ...(Option.isSome(volume) ? { volume: volume.value } : {}),
    ...(Option.isSome(issue) ? { issue: issue.value } : {}),
    ...(Option.isSome(page) ? { page: page.value } : {}),
  };
}

/** Structures one `authorships[]` entry's `{ author: { display_name, orcid } }` into a {@link CslName}. */
function openAlexAuthorName(entry: unknown): Option.Option<CslName> {
  if (!Predicate.isObjectOrArray(entry)) return Option.none();
  const author = (entry as { author?: unknown }).author;
  if (!Predicate.isObjectOrArray(author)) return Option.none();
  const a = author as { display_name?: unknown; orcid?: unknown };
  if (!Predicate.isString(a.display_name)) return Option.none();
  const base = parsePersonName(a.display_name);
  if (base === null) return Option.none();
  if (Predicate.isString(a.orcid)) {
    const orcid = decodeOrcid(a.orcid);
    if (Option.isSome(orcid)) return Option.some({ ...base, orcid: orcid.value });
  }
  return Option.some(base);
}

/** Bounded, ordered author list from `authorships[]`. */
function openAlexAuthors(value: Option.Option<readonly unknown[]>): CslName[] {
  return Array.filterMap(
    Option.isNone(value) ? [] : value.value,
    (entry): Result.Result<CslName, void> => {
      const name = openAlexAuthorName(entry);
      return Option.isNone(name) ? Result.failVoid : Result.succeed(name.value);
    },
  ).slice(0, MAX_AUTHORS);
}

/**
 * Normalises one OpenAlex `Work` into a CSL-aligned {@link BiblioRecord}.
 * `Option.none()` when the work has no usable title.
 */
export function normaliseOpenAlexRecord(work: OpenAlexWork): Option.Option<BiblioRecord> {
  const title = Option.firstSomeOf([sanitiseText(work.title), sanitiseText(work.display_name)]);
  if (Option.isNone(title)) return Option.none();

  const author = openAlexAuthors(Option.fromNullishOr(work.authorships));
  const containerTitle = openAlexContainerTitle(work);
  const { volume, issue, page } = openAlexBiblio(work);
  const doi = Predicate.isString(work.doi) ? decodeDoi(work.doi) : Option.none();
  const year =
    Predicate.isNumber(work.publication_year) && Number.isInteger(work.publication_year)
      ? Option.some(work.publication_year)
      : Option.none();

  return Option.some({
    type: openAlexType(work.type),
    title: title.value,
    ...(Option.isSome(containerTitle) ? { "container-title": containerTitle.value } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(issue !== undefined ? { issue } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(Array.isReadonlyArrayNonEmpty(author) ? { author } : {}),
    ...(Option.isSome(year) ? { issued: dateFromYear(year.value) } : {}),
    identifiers: Option.isSome(doi) ? { doi: doi.value } : {},
    provenance: {
      source: "openalex",
      retrievedBy: {
        ...(Option.isSome(doi) ? { identifierType: "doi", identifier: doi.value } : {}),
        endpoint: OPENALEX_BASE,
      },
    },
  });
}

/**
 * Resolves a {@link Doi} against OpenAlex's works-by-DOI lookup, normalised
 * into a CSL {@link BiblioRecord}. `Option.none()` on a clean 404; a
 * {@link LookupFailed} on any other upstream fault. Exposed as a standalone
 * source function (per source-client parity with OpenLibrary/Crossref) —
 * the composed {@link BiblioLookup} keeps Crossref as the primary DOI
 * authority and wires this source in for `byTitle` search; this function
 * is what the cross-source dedup coherence proof exercises directly.
 */
export const lookupOpenAlexByDoi: (
  client: HttpClient.HttpClient,
  doi: Doi,
) => Effect.Effect<Option.Option<BiblioRecord>, LookupFailed> = Effect.fn("lookupOpenAlexByDoi")(
  function* (client: HttpClient.HttpClient, doi: Doi) {
    const get = makeGet(client, OPENALEX_BASE, "openalex");
    const mailto = encodeURIComponent(CONTACT_EMAIL);
    // The `doi:` id form is OpenAlex's documented DOI-lookup shorthand;
    // percent-encoding the DOI (which may itself contain `/`) matches the
    // Crossref client's path-injection guard.
    const path = `/works/doi:${encodeURIComponent(doi)}?mailto=${mailto}`;
    const work = yield* get(path, OpenAlexWork);
    if (Option.isNone(work)) return Option.none();
    return normaliseOpenAlexRecord(work.value);
  },
);

/**
 * Searches OpenAlex works by title, returning up to {@link MAX_SEARCH_RESULTS}
 * ranked candidates as CSL {@link BiblioRecord}s (OpenAlex's `search`
 * parameter ranks by relevance). Individual malformed results are dropped
 * rather than failing the whole search (fail-soft, matching the package's
 * untrusted-input posture); an empty result set is not an error. Only a
 * transport/decode fault on the search request itself fails on the typed
 * channel.
 */
export const searchOpenAlexByTitle: (
  client: HttpClient.HttpClient,
  query: string,
) => Effect.Effect<readonly BiblioRecord[], LookupFailed> = Effect.fn("searchOpenAlexByTitle")(
  function* (client: HttpClient.HttpClient, query: string) {
    const safeQuery = query.slice(0, MAX_QUERY_LENGTH);
    const params = new URLSearchParams({
      search: safeQuery,
      "per-page": String(MAX_SEARCH_RESULTS),
      mailto: CONTACT_EMAIL,
    });
    const get = makeGet(client, OPENALEX_BASE, "openalex");
    const response = yield* get(`/works?${params.toString()}`, OpenAlexSearchResponse);
    if (Option.isNone(response)) return [];

    return Array.filterMap(
      response.value.results ?? [],
      (raw): Result.Result<BiblioRecord, void> => {
        const decoded = decodeOpenAlexWork(raw);
        if (Option.isNone(decoded)) return Result.failVoid;
        const record = normaliseOpenAlexRecord(decoded.value);
        return Option.isNone(record) ? Result.failVoid : Result.succeed(record.value);
      },
    );
  },
);
