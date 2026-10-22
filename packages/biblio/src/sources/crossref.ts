/**
 * Crossref (DOI) source client, emitting the CSL-aligned
 * {@link BiblioRecord}. Crossref is natively CSL-adjacent — its
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

// Refit onto the CSL-aligned `BiblioRecord` (website#1070, website#574).

import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Types from "effect/Types";
import { HttpClient } from "effect/http";
import { decodeDoi, decodeIssn, type Doi, type Issn } from "../identifiers.ts";
import {
  type BiblioRecord,
  type CslDate,
  type CslItemType,
  type CslName,
  MAX_AUTHORS,
  readCslName,
  sanitiseText,
  sanitiseYear,
} from "../record.ts";
import { LookupFailed } from "./errors.ts";
import { firstString, jsonGet } from "./http.ts";

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
const CROSSREF_TYPES = HashMap.fromIterable<string, CslItemType>([
  ["journal-article", "article-journal"],
  ["proceedings-article", "paper-conference"],
  ["book-chapter", "chapter"],
  ["book", "book"],
  ["monograph", "book"],
  ["edited-book", "book"],
  ["reference-book", "book"],
  ["dissertation", "thesis"],
  ["report", "report"],
  ["dataset", "dataset"],
  ["posted-content", "manuscript"],
  ["peer-review", "review"],
  ["standard", "standard"],
]);

const decodeString = Schema.decodeUnknownOption(Schema.String);

/** Maps a Crossref `message.type`, defaulting to `article-journal` (Crossref's overwhelming common case). */
function crossrefType(raw: Option.Option<string>): CslItemType {
  return Option.getOrElse(
    Option.flatMap(raw, (type) => HashMap.get(CROSSREF_TYPES, type)),
    (): CslItemType => "article-journal",
  );
}

/** A value Crossref may send as a string or a number (`volume`, `issue`); anything else is `None`. */
const decodeStringField = Schema.decodeUnknownOption(Schema.Union([Schema.String, Schema.Finite]));

/** Sanitises a value Crossref may send as a string or a number (`volume`, `issue`). */
function stringField(value: Option.Option<string | number>): Option.Option<string> {
  return Option.flatMap(value, (field) => sanitiseText(String(field)));
}

/** A Crossref author object: structured `given` / `family`, or a single `name` (organisations). */
const CrossrefAuthor = Schema.Struct({
  given: Schema.optional(Schema.Unknown),
  family: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
  ORCID: Schema.optional(Schema.Unknown),
});
const decodeCrossrefAuthor = Schema.decodeUnknownOption(CrossrefAuthor);

/** Builds a structured {@link CslName} from a Crossref author `{ given, family, name, ORCID }` object. */
function crossrefAuthorName(author: typeof CrossrefAuthor.Type): Option.Option<CslName> {
  const hasStructured = Predicate.isString(author.family) || Predicate.isString(author.given);
  return readCslName({
    family: author.family,
    given: author.given,
    // Some entries (organisations) carry a single `name` instead of
    // family/given — fall back to it as the CSL `literal` form.
    literal: hasStructured ? undefined : author.name,
    orcid: author.ORCID,
  });
}

/**
 * A Crossref date object, `{ "date-parts": [[year, month, day]] }`, read as
 * far as its first part list.
 */
const CrossrefDate = Schema.Struct({
  "date-parts": Schema.TupleWithRest(Schema.Tuple([Schema.Array(Schema.Unknown)]), [
    Schema.Unknown,
  ]),
});
const decodeCrossrefDate = Schema.decodeUnknownOption(CrossrefDate);

/** Extracts a {@link CslDate} from a Crossref `date-parts` object, keeping month/day when present. */
function crossrefDate(date: typeof CrossrefDate.Type): Option.Option<CslDate> {
  const nums = Array.filter(
    date["date-parts"][0],
    (n): n is number => Predicate.isNumber(n) && Number.isFinite(n),
  );
  if (!Array.isReadonlyArrayNonEmpty(nums)) return Option.none();
  return Option.map(sanitiseYear(Array.headNonEmpty(nums)), (year) => ({
    "date-parts": [[year, ...Array.tailNonEmpty(nums)]],
  }));
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
      const name = Option.flatMap(decodeCrossrefAuthor(entry), crossrefAuthorName);
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
  const optional: Types.Mutable<Partial<BiblioRecord>> = {};
  if (Option.isSome(containerTitle)) optional["container-title"] = containerTitle.value;
  if (Option.isSome(publisher)) optional.publisher = publisher.value;
  if (Option.isSome(volume)) optional.volume = volume.value;
  if (Option.isSome(issue)) optional.issue = issue.value;
  if (Option.isSome(page)) optional.page = page.value;
  if (Array.isReadonlyArrayNonEmpty(author)) optional.author = author;
  if (Option.isSome(issued)) optional.issued = issued.value;
  const identifiers: Types.Mutable<BiblioRecord["identifiers"]> = { doi };
  if (Option.isSome(issn)) identifiers.issn = issn.value;
  return {
    type,
    title,
    ...optional,
    identifiers,
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
      type: crossrefType(decodeString(message.type)),
      title: title.value,
      containerTitle: firstString(Option.fromNullishOr(message["container-title"])),
      publisher: sanitiseText(message.publisher),
      volume: stringField(decodeStringField(message.volume)),
      issue: stringField(decodeStringField(message.issue)),
      page: stringField(decodeStringField(message.page)),
      author: collectCrossrefAuthors(Option.fromNullishOr(message.author)),
      issued: Option.firstSomeOf([
        Option.flatMap(decodeCrossrefDate(message.published), crossrefDate),
        Option.flatMap(decodeCrossrefDate(message.issued), crossrefDate),
      ]),
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
    const cr = jsonGet(client, CROSSREF_BASE, "crossref");
    // Percent-encode the DOI: a valid DOI suffix may contain `/`, `(`, `)`
    // etc., which must not be read as path separators upstream.
    const response = yield* cr(`/works/${encodeURIComponent(doi)}`, CrossrefResponse);
    if (Option.isNone(response)) return Option.none();
    return normaliseCrossrefRecord(response.value, doi);
  },
);
