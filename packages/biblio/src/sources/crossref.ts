/**
 * Crossref (DOI) source client, refit onto the CSL-aligned
 * {@link BiblioRecord} (#1070, #574). Crossref is natively CSL-adjacent — its
 * `message.type` already maps closely onto the CSL item-type vocabulary,
 * and `container-title` / `volume` / `issue` / `page` / `ISSN` are direct
 * upstream fields — so this normaliser is mostly a direct mapping.
 *
 * Untrusted-response discipline: the schema is
 * deliberately lenient, and the normaliser only trusts what it extracts
 * and sanitises.
 *
 * @copyright Thomas Foster
 * @module biblio/sources/crossref
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import { decodeDoi, decodeIssn, type Doi, type Issn } from "../identifiers.ts";
import {
  type BiblioRecord,
  type CslDate,
  type CslItemType,
  type CslName,
  makeCslName,
  MAX_AUTHORS,
  sanitiseText,
  sanitiseYear,
} from "../record.ts";
import { LookupFailed } from "./errors.ts";
import { firstString, makeGet } from "./http.ts";

const CROSSREF_BASE = "https://api.crossref.org";

/**
 * Lenient schema for the Crossref `/works/<doi>` response envelope. Only
 * the `message` fields we read are modelled, all optional.
 *
 * @since 0.1.0
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
/**
 * @since 0.1.0
 */
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
  return Predicate.isString(raw) ? (CROSSREF_TYPES[raw] ?? "article-journal") : "article-journal";
}

/** Sanitises a value Crossref may send as a string or a number (`volume`, `issue`). */
function stringField(value: unknown): Option.Option<string> {
  return Predicate.isNumber(value) && Number.isFinite(value)
    ? sanitiseText(String(value))
    : sanitiseText(value);
}

/** Builds a structured {@link CslName} from a Crossref author `{ given, family, name, ORCID }` object. */
function crossrefAuthorName(entry: unknown): Option.Option<CslName> {
  if (!Predicate.isObjectOrArray(entry)) return Option.none();
  const obj = entry as { given?: unknown; family?: unknown; name?: unknown; ORCID?: unknown };
  const hasStructured = Predicate.isString(obj.family) || Predicate.isString(obj.given);
  return Option.fromNullishOr(
    makeCslName({
      family: obj.family,
      given: obj.given,
      // Some entries (organisations) carry a single `name` instead of
      // family/given — fall back to it as the CSL `literal` form.
      literal: hasStructured ? undefined : obj.name,
      orcid: obj.ORCID,
    }),
  );
}

/** Extracts a {@link CslDate} from a Crossref `date-parts` object, keeping month/day when present. */
function crossrefDate(value: unknown): Option.Option<CslDate> {
  if (!Predicate.isObjectOrArray(value)) return Option.none();
  const dateParts = (value as { "date-parts"?: unknown })["date-parts"];
  if (!Array.isArray(dateParts) || Array.isArrayEmpty(dateParts)) return Option.none();
  const first = dateParts[0];
  if (!Array.isArray(first) || Array.isArrayEmpty(first)) return Option.none();
  const nums = first.filter((n): n is number => Predicate.isNumber(n) && Number.isFinite(n));
  if (Array.isArrayEmpty(nums)) return Option.none();
  const year = sanitiseYear(nums[0]);
  if (Option.isNone(year)) return Option.none();
  return Option.some({ "date-parts": [[year.value, ...nums.slice(1)]] });
}

/** The first checksum-valid ISSN from Crossref's `ISSN` array, or `None`. */
function firstIssn(values: Option.Option<readonly unknown[]>): Option.Option<Issn> {
  return Array.head(
    Array.filterMap(
      Option.isNone(values) ? [] : values.value,
      (value): Result.Result<Issn, void> => {
        if (!Predicate.isString(value)) return Result.failVoid;
        const decoded = decodeIssn(value);
        return Option.isNone(decoded) ? Result.failVoid : Result.succeed(decoded.value);
      },
    ),
  );
}

/** The non-empty `message` body of a decoded {@link CrossrefResponse}. */
type CrossrefMessage = NonNullable<CrossrefResponse["message"]>;

/** Bounded, ordered author list from `message.author`. */
function collectCrossrefAuthors(entries: Option.Option<readonly unknown[]>): CslName[] {
  return Array.filterMap(
    Option.isNone(entries) ? [] : entries.value,
    (entry): Result.Result<CslName, void> => {
      const name = crossrefAuthorName(entry);
      return Option.isNone(name) ? Result.failVoid : Result.succeed(name.value);
    },
  ).slice(0, MAX_AUTHORS);
}

/** The record's DOI: the upstream-echoed one when it re-validates, else the requested one. */
function crossrefDoi(message: CrossrefMessage, requestedDoi: Doi): Doi {
  const echoed = Predicate.isString(message.DOI) ? decodeDoi(message.DOI) : Option.none<Doi>();
  return Option.getOrElse(echoed, () => requestedDoi);
}

/** The fields {@link assembleCrossrefRecord} needs, already extracted and sanitised. */
interface CrossrefFields {
  readonly type: CslItemType;
  readonly title: string;
  readonly containerTitle: Option.Option<string>;
  readonly publisher: Option.Option<string>;
  readonly volume: Option.Option<string>;
  readonly issue: Option.Option<string>;
  readonly page: Option.Option<string>;
  readonly author: readonly CslName[];
  readonly issued: Option.Option<CslDate>;
  readonly doi: Doi;
  readonly issn: Option.Option<Issn>;
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
    ...(Option.isSome(containerTitle) ? { "container-title": containerTitle.value } : {}),
    ...(Option.isSome(publisher) ? { publisher: publisher.value } : {}),
    ...(Option.isSome(volume) ? { volume: volume.value } : {}),
    ...(Option.isSome(issue) ? { issue: issue.value } : {}),
    ...(Option.isSome(page) ? { page: page.value } : {}),
    ...(Array.isReadonlyArrayNonEmpty(author) ? { author } : {}),
    ...(Option.isSome(issued) ? { issued: issued.value } : {}),
    identifiers: { doi, ...(Option.isSome(issn) ? { issn: issn.value } : {}) },
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
 * one. `Option.none()` when the record has no usable title.
 *
 * @since 0.1.0
 */
export function normaliseCrossrefRecord(
  response: CrossrefResponse,
  requestedDoi: Doi,
): Option.Option<BiblioRecord> {
  const message = response.message;
  if (!message) return Option.none();
  const title = firstString(Option.fromNullishOr(message.title));
  if (Option.isNone(title)) return Option.none();

  return Option.some(
    assembleCrossrefRecord({
      type: crossrefType(message.type),
      title: title.value,
      containerTitle: firstString(Option.fromNullishOr(message["container-title"])),
      publisher: sanitiseText(message.publisher),
      volume: stringField(message.volume),
      issue: stringField(message.issue),
      page: stringField(message.page),
      author: collectCrossrefAuthors(Option.fromNullishOr(message.author)),
      issued: Option.firstSomeOf([crossrefDate(message.published), crossrefDate(message.issued)]),
      doi: crossrefDoi(message, requestedDoi),
      issn: firstIssn(Option.fromNullishOr(message.ISSN)),
      requestedDoi,
    }),
  );
}

/**
 * Resolves a {@link Doi} against Crossref, normalised into a CSL
 * {@link BiblioRecord}. `Option.none()` on a clean 404; a {@link LookupFailed}
 * on any other upstream fault. `client` is expected to already carry the
 * polite User-Agent and `filterStatusOk` (composed once in `service.ts`).
 *
 * @since 0.1.0
 */
export const lookupCrossrefByDoi: (
  client: HttpClient.HttpClient,
  doi: Doi,
) => Effect.Effect<Option.Option<BiblioRecord>, LookupFailed> = Effect.fn("lookupCrossrefByDoi")(
  function* (client: HttpClient.HttpClient, doi: Doi) {
    const cr = makeGet(client, CROSSREF_BASE, "crossref");
    // Percent-encode the DOI: a valid DOI suffix may contain `/`, `(`, `)`
    // etc., which must not be read as path separators upstream.
    const response = yield* cr(`/works/${encodeURIComponent(doi)}`, CrossrefResponse);
    if (Option.isNone(response)) return Option.none();
    return normaliseCrossrefRecord(response.value, doi);
  },
);
