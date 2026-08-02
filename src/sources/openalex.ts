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

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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
  return typeof raw === "string" ? (OPENALEX_TYPES[raw] ?? "document") : "document";
}

/** Reads the display name of an OpenAlex `{ source: { display_name } }` / `{ display_name }` location object. */
function locationDisplayName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as { display_name?: unknown; source?: unknown };
  const direct = sanitiseText(obj.display_name);
  if (direct !== null) return direct;
  if (typeof obj.source === "object" && obj.source !== null) {
    return sanitiseText((obj.source as { display_name?: unknown }).display_name);
  }
  return null;
}

/** The hosting container title: `primary_location` first, else the deprecated `host_venue`. */
function openAlexContainerTitle(work: OpenAlexWork): string | null {
  return locationDisplayName(work.primary_location) ?? locationDisplayName(work.host_venue);
}

/** Volume / issue / page range from OpenAlex's `biblio` sub-object. */
function openAlexBiblio(work: OpenAlexWork): {
  readonly volume?: string;
  readonly issue?: string;
  readonly page?: string;
} {
  if (typeof work.biblio !== "object" || work.biblio === null) return {};
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
  const page = first !== null ? (last !== null ? `${first}-${last}` : first) : undefined;
  return {
    ...(volume !== null ? { volume } : {}),
    ...(issue !== null ? { issue } : {}),
    ...(page !== undefined ? { page } : {}),
  };
}

/** Structures one `authorships[]` entry's `{ author: { display_name, orcid } }` into a {@link CslName}. */
function openAlexAuthorName(entry: unknown): CslName | null {
  if (typeof entry !== "object" || entry === null) return null;
  const author = (entry as { author?: unknown }).author;
  if (typeof author !== "object" || author === null) return null;
  const a = author as { display_name?: unknown; orcid?: unknown };
  if (typeof a.display_name !== "string") return null;
  const base = parsePersonName(a.display_name);
  if (base === null) return null;
  if (typeof a.orcid === "string") {
    const orcid = decodeOrcid(a.orcid);
    if (Option.isSome(orcid)) return { ...base, orcid: orcid.value };
  }
  return base;
}

/** Bounded, ordered author list from `authorships[]`. */
function openAlexAuthors(value: readonly unknown[] | undefined): CslName[] {
  const authors: CslName[] = [];
  for (const entry of value ?? []) {
    if (authors.length >= MAX_AUTHORS) break;
    const name = openAlexAuthorName(entry);
    if (name !== null) authors.push(name);
  }
  return authors;
}

/**
 * Normalises one OpenAlex `Work` into a CSL-aligned {@link BiblioRecord}.
 * Returns `null` when the work has no usable title.
 */
export function normaliseOpenAlexRecord(work: OpenAlexWork): BiblioRecord | null {
  const title = sanitiseText(work.title) ?? sanitiseText(work.display_name);
  if (title === null) return null;

  const author = openAlexAuthors(work.authorships);
  const containerTitle = openAlexContainerTitle(work);
  const { volume, issue, page } = openAlexBiblio(work);
  const doi = typeof work.doi === "string" ? Option.getOrUndefined(decodeDoi(work.doi)) : undefined;
  const year =
    typeof work.publication_year === "number" && Number.isInteger(work.publication_year)
      ? work.publication_year
      : null;

  return {
    type: openAlexType(work.type),
    title,
    ...(containerTitle !== null ? { "container-title": containerTitle } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(issue !== undefined ? { issue } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(author.length > 0 ? { author } : {}),
    ...(year !== null ? { issued: dateFromYear(year) } : {}),
    identifiers: doi !== undefined ? { doi } : {},
    provenance: {
      source: "openalex",
      retrievedBy: {
        ...(doi !== undefined ? { identifierType: "doi", identifier: doi } : {}),
        endpoint: OPENALEX_BASE,
      },
    },
  };
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
export const lookupOpenAlexByDoi = (
  client: HttpClient.HttpClient,
  doi: Doi,
): Effect.Effect<Option.Option<BiblioRecord>, LookupFailed> =>
  Effect.gen(function* () {
    const get = makeGet(client, OPENALEX_BASE, "openalex");
    const mailto = encodeURIComponent(CONTACT_EMAIL);
    // The `doi:` id form is OpenAlex's documented DOI-lookup shorthand;
    // percent-encoding the DOI (which may itself contain `/`) matches the
    // Crossref client's path-injection guard.
    const path = `/works/doi:${encodeURIComponent(doi)}?mailto=${mailto}`;
    const work = yield* get(path, OpenAlexWork);
    if (Option.isNone(work)) return Option.none();
    return Option.fromNullishOr(normaliseOpenAlexRecord(work.value));
  });

/**
 * Searches OpenAlex works by title, returning up to {@link MAX_SEARCH_RESULTS}
 * ranked candidates as CSL {@link BiblioRecord}s (OpenAlex's `search`
 * parameter ranks by relevance). Individual malformed results are dropped
 * rather than failing the whole search (fail-soft, matching the package's
 * untrusted-input posture); an empty result set is not an error. Only a
 * transport/decode fault on the search request itself fails on the typed
 * channel.
 */
export const searchOpenAlexByTitle = (
  client: HttpClient.HttpClient,
  query: string,
): Effect.Effect<readonly BiblioRecord[], LookupFailed> =>
  Effect.gen(function* () {
    const safeQuery = query.slice(0, MAX_QUERY_LENGTH);
    const params = new URLSearchParams({
      search: safeQuery,
      "per-page": String(MAX_SEARCH_RESULTS),
      mailto: CONTACT_EMAIL,
    });
    const get = makeGet(client, OPENALEX_BASE, "openalex");
    const response = yield* get(`/works?${params.toString()}`, OpenAlexSearchResponse);
    if (Option.isNone(response)) return [];

    const records: BiblioRecord[] = [];
    for (const raw of response.value.results ?? []) {
      const decoded = Schema.decodeUnknownOption(OpenAlexWork)(raw);
      if (Option.isNone(decoded)) continue;
      const record = normaliseOpenAlexRecord(decoded.value);
      if (record !== null) records.push(record);
    }
    return records;
  });
