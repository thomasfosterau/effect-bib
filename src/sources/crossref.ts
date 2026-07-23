/**
 * @copyright Thomas Foster
 *
 * Crossref (DOI) source client, refit onto the CSL-aligned
 * {@link BiblioRecord} (biblio B3, issue #1070; carries forward the KB-010
 * ingestion client, issue #574). Crossref is natively CSL-adjacent — its
 * `message.type` already maps closely onto the CSL item-type vocabulary,
 * and `container-title` / `volume` / `issue` / `page` / `ISSN` are direct
 * upstream fields — so this normaliser mostly *simplifies* relative to the
 * pre-B3 flat mapping rather than growing.
 *
 * Untrusted-response discipline unchanged from pre-B3: the schema is
 * deliberately lenient, and the normaliser only trusts what it extracts
 * and sanitises.
 *
 * @module biblio/sources/crossref
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { decodeDoi, decodeIssn, type Doi, type Issn } from "../identifiers";
import {
  type BiblioRecord,
  type CslDate,
  type CslItemType,
  type CslName,
  makeCslName,
  MAX_AUTHORS,
  sanitiseText,
  sanitiseYear,
} from "../record";
import { LookupFailed } from "./errors";
import { firstString, makeGet } from "./http";

const CROSSREF_BASE = "https://api.crossref.org";

/**
 * Lenient schema for the Crossref `/works/<doi>` response envelope. Only
 * the `message` fields we read are modelled, all optional.
 */
export const CrossrefResponse = Schema.Struct({
  message: Schema.optional(
    Schema.Struct({
      DOI: Schema.optional(Schema.Unknown),
      type: Schema.optional(Schema.Unknown),
      title: Schema.optional(Schema.Array(Schema.Unknown)),
      "container-title": Schema.optional(Schema.Array(Schema.Unknown)),
      publisher: Schema.optional(Schema.Unknown),
      volume: Schema.optional(Schema.Unknown),
      issue: Schema.optional(Schema.Unknown),
      page: Schema.optional(Schema.Unknown),
      ISSN: Schema.optional(Schema.Array(Schema.Unknown)),
      author: Schema.optional(Schema.Array(Schema.Unknown)),
      // `published` / `issued` carry `{ "date-parts": [[year, month, day]] }`.
      published: Schema.optional(Schema.Unknown),
      issued: Schema.optional(Schema.Unknown),
    }),
  ),
});
export type CrossrefResponse = typeof CrossrefResponse.Type;

/** Crossref `message.type` → CSL item type; unlisted types fall back to `article-journal`. */
const CROSSREF_TYPES: Readonly<Record<string, CslItemType>> = {
  "journal-article": "article-journal",
  "proceedings-article": "paper-conference",
  "book-chapter": "chapter",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  "reference-book": "book",
  dissertation: "thesis",
  report: "report",
  dataset: "dataset",
  "posted-content": "manuscript",
  "peer-review": "review",
  standard: "standard",
};

/** Maps a Crossref `message.type`, defaulting to `article-journal` (Crossref's overwhelming common case). */
function crossrefType(raw: unknown): CslItemType {
  return typeof raw === "string" ? (CROSSREF_TYPES[raw] ?? "article-journal") : "article-journal";
}

/** Sanitises a value Crossref may send as a string or a number (`volume`, `issue`). */
function stringField(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? sanitiseText(String(value))
    : sanitiseText(value);
}

/** Builds a structured {@link CslName} from a Crossref author `{ given, family, name, ORCID }` object. */
function crossrefAuthorName(entry: unknown): CslName | null {
  if (typeof entry !== "object" || entry === null) return null;
  const obj = entry as { given?: unknown; family?: unknown; name?: unknown; ORCID?: unknown };
  const hasStructured = typeof obj.family === "string" || typeof obj.given === "string";
  return makeCslName({
    family: obj.family,
    given: obj.given,
    // Some entries (organisations) carry a single `name` instead of
    // family/given — fall back to it as the CSL `literal` form.
    literal: hasStructured ? undefined : obj.name,
    orcid: obj.ORCID,
  });
}

/** Extracts a {@link CslDate} from a Crossref `date-parts` object, keeping month/day when present. */
function crossrefDate(value: unknown): CslDate | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const dateParts = (value as { "date-parts"?: unknown })["date-parts"];
  if (!Array.isArray(dateParts) || dateParts.length === 0) return undefined;
  const first = dateParts[0];
  if (!Array.isArray(first) || first.length === 0) return undefined;
  const nums = first.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (nums.length === 0) return undefined;
  const year = sanitiseYear(nums[0]);
  if (year === null) return undefined;
  return { "date-parts": [[year, ...nums.slice(1)]] };
}

/** The first checksum-valid ISSN from Crossref's `ISSN` array, or `undefined`. */
function firstIssn(values: readonly unknown[] | undefined): Issn | undefined {
  for (const v of values ?? []) {
    if (typeof v !== "string") continue;
    const decoded = decodeIssn(v);
    if (Option.isSome(decoded)) return decoded.value;
  }
  return undefined;
}

/** The non-empty `message` body of a decoded {@link CrossrefResponse}. */
type CrossrefMessage = NonNullable<CrossrefResponse["message"]>;

/** Bounded, ordered author list from `message.author`. */
function collectCrossrefAuthors(entries: readonly unknown[] | undefined): CslName[] {
  const author: CslName[] = [];
  for (const entry of entries ?? []) {
    if (author.length >= MAX_AUTHORS) break;
    const name = crossrefAuthorName(entry);
    if (name !== null) author.push(name);
  }
  return author;
}

/** The record's DOI: the upstream-echoed one when it re-validates, else the requested one. */
function crossrefDoi(message: CrossrefMessage, requestedDoi: Doi): Doi {
  const echoed = typeof message.DOI === "string" ? decodeDoi(message.DOI) : Option.none<Doi>();
  return Option.getOrElse(echoed, () => requestedDoi);
}

/** The fields {@link assembleCrossrefRecord} needs, already extracted and sanitised. */
interface CrossrefFields {
  readonly type: CslItemType;
  readonly title: string;
  readonly containerTitle: string | null;
  readonly publisher: string | null;
  readonly volume: string | null;
  readonly issue: string | null;
  readonly page: string | null;
  readonly author: readonly CslName[];
  readonly issued: CslDate | undefined;
  readonly doi: Doi;
  readonly issn: Issn | undefined;
  readonly requestedDoi: Doi;
}

/** Assembles the CSL {@link BiblioRecord} from already-extracted {@link CrossrefFields}. */
function assembleCrossrefRecord(fields: CrossrefFields): BiblioRecord {
  const {
    type,
    title,
    containerTitle,
    publisher,
    volume,
    issue,
    page,
    author,
    issued,
    doi,
    issn,
    requestedDoi,
  } = fields;
  return {
    type,
    title,
    ...(containerTitle !== null ? { "container-title": containerTitle } : {}),
    ...(publisher !== null ? { publisher } : {}),
    ...(volume !== null ? { volume } : {}),
    ...(issue !== null ? { issue } : {}),
    ...(page !== null ? { page } : {}),
    ...(author.length > 0 ? { author } : {}),
    ...(issued !== undefined ? { issued } : {}),
    identifiers: { doi, ...(issn !== undefined ? { issn } : {}) },
    provenance: {
      source: "crossref",
      retrievedBy: {
        identifierType: "doi",
        identifier: requestedDoi,
        endpoint: `${CROSSREF_BASE}/works/${encodeURIComponent(requestedDoi)}`,
      },
    },
  };
}

/**
 * Normalises a Crossref `/works/<doi>` response into a CSL-aligned
 * {@link BiblioRecord}. `requestedDoi` is the already-validated {@link Doi}
 * the lookup was keyed by; the record prefers the DOI Crossref echoes
 * (re-validated, never trusted verbatim) and falls back to the requested
 * one. Returns `null` when the record has no usable title.
 */
export function normaliseCrossrefRecord(
  response: CrossrefResponse,
  requestedDoi: Doi,
): BiblioRecord | null {
  const message = response.message;
  if (!message) return null;
  const title = firstString(message.title);
  if (title === null) return null;

  return assembleCrossrefRecord({
    type: crossrefType(message.type),
    title,
    containerTitle: firstString(message["container-title"]),
    publisher: sanitiseText(message.publisher),
    volume: stringField(message.volume),
    issue: stringField(message.issue),
    page: stringField(message.page),
    author: collectCrossrefAuthors(message.author),
    issued: crossrefDate(message.published) ?? crossrefDate(message.issued),
    doi: crossrefDoi(message, requestedDoi),
    issn: firstIssn(message.ISSN),
    requestedDoi,
  });
}

/**
 * Resolves a {@link Doi} against Crossref, normalised into a CSL
 * {@link BiblioRecord}. `Option.none()` on a clean 404; a {@link LookupFailed}
 * on any other upstream fault. `client` is expected to already carry the
 * polite User-Agent and `filterStatusOk` (composed once in `service.ts`).
 */
export const lookupCrossrefByDoi = (
  client: HttpClient.HttpClient,
  doi: Doi,
): Effect.Effect<Option.Option<BiblioRecord>, LookupFailed> =>
  Effect.gen(function* () {
    const cr = makeGet(client, CROSSREF_BASE, "crossref");
    // Percent-encode the DOI: a valid DOI suffix may contain `/`, `(`, `)`
    // etc., which must not be read as path separators upstream.
    const response = yield* cr(`/works/${encodeURIComponent(doi)}`, CrossrefResponse);
    if (Option.isNone(response)) return Option.none();
    return Option.fromNullishOr(normaliseCrossrefRecord(response.value, doi));
  });
