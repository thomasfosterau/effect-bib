/**
 * OpenAlex source client, emitting the CSL-aligned {@link BiblioRecord}.
 * Two capabilities:
 * a works lookup by DOI ({@link lookupOpenAlexByDoi}), and a title search
 * returning ranked candidates ({@link searchOpenAlexByTitle}), which backs
 * `BiblioLookup.byTitle`.
 *
 * **Polite-pool etiquette.** OpenAlex asks callers to identify themselves
 * with a contact email — either a `mailto` query parameter or a `mailto:`
 * User-Agent — in exchange for a faster, more reliable service tier. We do
 * both: the composed service's User-Agent already carries the caller's
 * {@link LookupContact} address, and every request here additionally
 * appends `?mailto=` with the same address so the polite pool applies to a
 * caller that composes its own client with a different User-Agent.
 *
 * Untrusted-response discipline: the {@link OpenAlexWork} schema is
 * deliberately lenient (every field optional), and the normaliser only
 * trusts what it extracts and sanitises — the same posture as the sibling
 * OpenLibrary / Crossref clients.
 *
 * @copyright Thomas Foster
 * @module biblio/sources/openalex
 * @since 0.1.0
 */

// website#1070: the modern scholarly-graph source, added alongside the
// OpenLibrary/Crossref refit.

import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Types from "effect/Types";
import { HttpClient } from "effect/http";
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
import { type LookupContact } from "./contact.ts";
import { LookupFailed } from "./errors.ts";
import { jsonGet } from "./http.ts";

const OPENALEX_BASE = "https://api.openalex.org";

/** How many search results {@link searchOpenAlexByTitle} returns at most. */
const MAX_SEARCH_RESULTS = 10;

/** Upper bound on a caller-supplied search query, defensively clamped before it reaches the URL. */
const MAX_QUERY_LENGTH = 500;

/**
 * Lenient schema for one OpenAlex `Work` object — from both the
 * single-work lookup and the `results` array of a search response. Only
 * the fields we read are modelled, all optional.
 *
 * @since 0.1.0
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
/**
 * @since 0.1.0
 */
export type OpenAlexWork = typeof OpenAlexWork.Type;

/**
 * Lenient schema for the `GET /works?search=...` envelope.
 *
 * @since 0.1.0
 */
export const OpenAlexSearchResponse = Schema.Struct({
  results: Schema.optional(Schema.Array(Schema.Unknown)),
});
/**
 * @since 0.1.0
 */
export type OpenAlexSearchResponse = typeof OpenAlexSearchResponse.Type;

const decodeOpenAlexWork = Schema.decodeUnknownOption(OpenAlexWork);

/** OpenAlex `type` → CSL item type; unlisted types fall back to `document`. */
const OPENALEX_TYPES = HashMap.fromIterable<string, CslItemType>([
  ["article", "article-journal"],
  ["book-chapter", "chapter"],
  ["book", "book"],
  ["dissertation", "thesis"],
  ["dataset", "dataset"],
  ["peer-review", "review"],
  ["posted-content", "manuscript"],
  ["proceedings-article", "paper-conference"],
  ["report", "report"],
  ["standard", "standard"],
  ["editorial", "article"],
  ["letter", "article"],
  ["erratum", "article"],
]);

const decodeString = Schema.decodeUnknownOption(Schema.String);

/** Maps an OpenAlex `type`, defaulting to `document` for the long tail. */
function openAlexType(raw: Option.Option<string>): CslItemType {
  return Option.getOrElse(
    Option.flatMap(raw, (type) => HashMap.get(OPENALEX_TYPES, type)),
    (): CslItemType => "document",
  );
}

/** An OpenAlex location object: `{ display_name }` directly, or nested under `source`. */
const OpenAlexLocation = Schema.Struct({
  display_name: Schema.optional(Schema.Unknown),
  source: Schema.optional(Schema.Unknown),
});
const decodeOpenAlexLocation = Schema.decodeUnknownOption(OpenAlexLocation);

/** The `source` of an OpenAlex location, which carries its own `display_name`. */
const decodeOpenAlexSource = Schema.decodeUnknownOption(
  Schema.Struct({ display_name: Schema.optional(Schema.Unknown) }),
);

/** Reads the display name of an OpenAlex `{ source: { display_name } }` / `{ display_name }` location object. */
function locationDisplayName(location: typeof OpenAlexLocation.Type): Option.Option<string> {
  const direct = sanitiseText(location.display_name);
  if (Option.isSome(direct)) return direct;
  return Option.flatMap(decodeOpenAlexSource(location.source), (source) =>
    sanitiseText(source.display_name),
  );
}

/** The hosting container title: `primary_location` first, else the deprecated `host_venue`. */
function openAlexContainerTitle(work: OpenAlexWork): Option.Option<string> {
  return Option.firstSomeOf([
    Option.flatMap(decodeOpenAlexLocation(work.primary_location), locationDisplayName),
    Option.flatMap(decodeOpenAlexLocation(work.host_venue), locationDisplayName),
  ]);
}

/** OpenAlex's `biblio` sub-object: volume, issue and the page range's ends. */
const decodeOpenAlexBiblio = Schema.decodeUnknownOption(
  Schema.Struct({
    volume: Schema.optional(Schema.Unknown),
    issue: Schema.optional(Schema.Unknown),
    first_page: Schema.optional(Schema.Unknown),
    last_page: Schema.optional(Schema.Unknown),
  }),
);

/** The sanitised volume, issue and page range read from an OpenAlex `biblio` sub-object. */
interface OpenAlexBiblioFields {
  readonly volume: Option.Option<string>;
  readonly issue: Option.Option<string>;
  readonly page: Option.Option<string>;
}

/** Volume / issue / page range from OpenAlex's `biblio` sub-object. */
function openAlexBiblio(work: OpenAlexWork): OpenAlexBiblioFields {
  const biblio = decodeOpenAlexBiblio(work.biblio);
  const first = Option.flatMap(biblio, (b) => sanitiseText(b.first_page));
  const last = Option.flatMap(biblio, (b) => sanitiseText(b.last_page));
  return {
    volume: Option.flatMap(biblio, (b) => sanitiseText(b.volume)),
    issue: Option.flatMap(biblio, (b) => sanitiseText(b.issue)),
    page: Option.map(first, (start) =>
      Option.match(last, { onNone: () => start, onSome: (end) => `${start}-${end}` }),
    ),
  };
}

/** One `authorships[]` entry: `{ author: { display_name, orcid } }`. */
const decodeOpenAlexAuthorship = Schema.decodeUnknownOption(
  Schema.Struct({
    author: Schema.Struct({
      display_name: Schema.String,
      orcid: Schema.optional(Schema.Unknown),
    }),
  }),
);

/** Structures one `authorships[]` entry's `{ author: { display_name, orcid } }` into a {@link CslName}. */
function openAlexAuthorName(author: {
  readonly display_name: string;
  readonly orcid?: unknown;
}): Option.Option<CslName> {
  const base = parsePersonName(author.display_name);
  if (base === null) return Option.none();
  const orcid = Option.flatMap(decodeString(author.orcid), decodeOrcid);
  return Option.some(Option.isSome(orcid) ? { ...base, orcid: orcid.value } : base);
}

/** Bounded, ordered author list from `authorships[]`. */
function openAlexAuthors(value: Option.Option<readonly unknown[]>): CslName[] {
  return Array.filterMap(
    Option.isNone(value) ? [] : value.value,
    (entry): Result.Result<CslName, void> => {
      const name = Option.flatMap(decodeOpenAlexAuthorship(entry), ({ author }) =>
        openAlexAuthorName(author),
      );
      return Option.isNone(name) ? Result.failVoid : Result.succeed(name.value);
    },
  ).slice(0, MAX_AUTHORS);
}

const decodeNumber = Schema.decodeUnknownOption(Schema.Number);

/**
 * Normalises one OpenAlex `Work` into a CSL-aligned {@link BiblioRecord}.
 * `Option.none()` when the work has no usable title.
 *
 * @since 0.1.0
 */
export function normaliseOpenAlexRecord(work: OpenAlexWork): Option.Option<BiblioRecord> {
  const title = Option.firstSomeOf([sanitiseText(work.title), sanitiseText(work.display_name)]);
  if (Option.isNone(title)) return Option.none();

  const author = openAlexAuthors(Option.fromNullishOr(work.authorships));
  const containerTitle = openAlexContainerTitle(work);
  const { volume, issue, page } = openAlexBiblio(work);
  const doi = Option.flatMap(decodeString(work.doi), decodeDoi);
  const year = Option.filter(decodeNumber(work.publication_year), Number.isInteger);

  const optional: Types.Mutable<Partial<BiblioRecord>> = {};
  if (Option.isSome(containerTitle)) optional["container-title"] = containerTitle.value;
  if (Option.isSome(volume)) optional.volume = volume.value;
  if (Option.isSome(issue)) optional.issue = issue.value;
  if (Option.isSome(page)) optional.page = page.value;
  if (Array.isReadonlyArrayNonEmpty(author)) optional.author = author;
  if (Option.isSome(year)) optional.issued = dateFromYear(year.value);
  return Option.some({
    type: openAlexType(decodeString(work.type)),
    title: title.value,
    ...optional,
    identifiers: Option.isSome(doi) ? { doi: doi.value } : {},
    provenance: {
      source: "openalex",
      retrievedBy: Option.isSome(doi)
        ? { identifierType: "doi", identifier: doi.value, endpoint: OPENALEX_BASE }
        : { endpoint: OPENALEX_BASE },
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
 * `contact.email` is sent as OpenAlex's `mailto` parameter.
 *
 * @since 0.1.0
 */
export const lookupOpenAlexByDoi: (
  client: HttpClient.HttpClient,
  doi: Doi,
  contact: LookupContact,
) => Effect.Effect<Option.Option<BiblioRecord>, LookupFailed> = Effect.fn("lookupOpenAlexByDoi")(
  function* (client: HttpClient.HttpClient, doi: Doi, contact: LookupContact) {
    const get = jsonGet(client, OPENALEX_BASE, "openalex");
    const mailto = encodeURIComponent(contact.email);
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
 * channel. `contact.email` is sent as OpenAlex's `mailto` parameter.
 *
 * @since 0.1.0
 */
export const searchOpenAlexByTitle: (
  client: HttpClient.HttpClient,
  query: string,
  contact: LookupContact,
) => Effect.Effect<readonly BiblioRecord[], LookupFailed> = Effect.fn("searchOpenAlexByTitle")(
  function* (client: HttpClient.HttpClient, query: string, contact: LookupContact) {
    const safeQuery = query.slice(0, MAX_QUERY_LENGTH);
    const params = new URLSearchParams({
      search: safeQuery,
      "per-page": String(MAX_SEARCH_RESULTS),
      mailto: contact.email,
    });
    const get = jsonGet(client, OPENALEX_BASE, "openalex");
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
