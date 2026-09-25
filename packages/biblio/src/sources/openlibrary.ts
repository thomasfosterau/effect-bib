/**
 * @copyright Thomas Foster
 *
 * OpenLibrary (ISBN) source client, refit onto the CSL-aligned
 * {@link BiblioRecord} (biblio B3, issue #1070; carries forward the KB-010
 * ingestion client, issue #574). Resolves an edition by ISBN, follows the
 * referenced `/authors/OL...A` records for display names, and normalises
 * the pair into a record — richer than the pre-B3 flat shape: publisher
 * place lands in the standard CSL `publisher-place` variable, and subjects
 * (which CSL has no standard slot for) are carried in the `extra`
 * passthrough as `extra.subject`.
 *
 * Untrusted-response discipline unchanged from pre-B3: the schema is
 * deliberately lenient (every field optional), and the normaliser only
 * trusts what it extracts and sanitises.
 *
 * @module biblio/sources/openlibrary
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { decodeIsbn, type Isbn } from "../identifiers.ts";
import {
  type BiblioRecord,
  type CslDate,
  type CslName,
  dateFromYear,
  MAX_AUTHORS,
  MAX_TEXT_FIELD_LENGTH,
  parsePersonName,
  sanitiseText,
  sanitiseYear,
} from "../record.ts";
import { LookupFailed } from "./errors.ts";
import { firstString, makeGet } from "./http.ts";

const OPENLIBRARY_BASE = "https://openlibrary.org";

/** Cap on how many subject strings a record carries in `extra.subject`. */
const MAX_SUBJECTS = 50;

/**
 * Lenient schema for the OpenLibrary `/isbn/<isbn>.json` edition record.
 * Only the fields we read are modelled, all optional; `Schema.Unknown`
 * arrays absorb the `authors` reference objects whose shape we resolve
 * separately. Unknown extra keys are ignored.
 *
 * @since 0.1.0
 */
export const OpenLibraryEdition = Schema.Struct({
  title: Schema.optional(Schema.Unknown),
  subtitle: Schema.optional(Schema.Unknown),
  publish_date: Schema.optional(Schema.Unknown),
  publish_places: Schema.optional(Schema.Array(Schema.Unknown)),
  publishers: Schema.optional(Schema.Array(Schema.Unknown)),
  isbn_10: Schema.optional(Schema.Array(Schema.Unknown)),
  isbn_13: Schema.optional(Schema.Array(Schema.Unknown)),
  subjects: Schema.optional(Schema.Array(Schema.Unknown)),
  // `authors` on an edition is an array of `{ key: "/authors/OL..A" }`
  // reference objects; we resolve names separately via the author
  // lookups below.
  authors: Schema.optional(Schema.Array(Schema.Unknown)),
});
/**
 * @since 0.1.0
 */
export type OpenLibraryEdition = typeof OpenLibraryEdition.Type;

/**
 * Lenient schema for an OpenLibrary `/authors/<id>.json` record — we read
 * only the display `name`.
 *
 * @since 0.1.0
 */
export const OpenLibraryAuthor = Schema.Struct({
  name: Schema.optional(Schema.Unknown),
});
/**
 * @since 0.1.0
 */
export type OpenLibraryAuthor = typeof OpenLibraryAuthor.Type;

/**
 * Extracts the `/authors/OL...A` keys referenced by an edition record.
 *
 * @since 0.1.0
 */
export function openLibraryAuthorKeys(edition: OpenLibraryEdition): readonly string[] {
  return Array.filterMap(edition.authors ?? [], (ref): Result.Result<string, void> => {
    if (!Predicate.isObjectOrArray(ref) || !("key" in ref)) return Result.failVoid;
    const key = (ref as { key: unknown }).key;
    // Author keys look like `/authors/OL12345A`; the strict class is the
    // SSRF guard for the follow-up author lookup URL.
    return Predicate.isString(key) && /^\/authors\/OL\d+A$/.test(key)
      ? Result.succeed(key)
      : Result.failVoid;
  }).slice(0, MAX_AUTHORS);
}

/**
 * Reads the OpenLibrary author `name` field, sanitised.
 *
 * @since 0.1.0
 */
export function openLibraryAuthorName(author: OpenLibraryAuthor): Option.Option<string> {
  return sanitiseText(author.name);
}

/** Extracts a {@link CslDate} carrying just the year from a free-text `publish_date` like "Jan 2003". */
function dateFromPublishDate(value: unknown): Option.Option<CslDate> {
  if (!Predicate.isString(value)) return Option.none();
  const match = value.match(/(\d{4})/);
  const year = match ? sanitiseYear(match[1]) : Option.none<number>();
  return Option.isNone(year) ? Option.none() : Option.some(dateFromYear(year.value));
}

/** Picks the first checksum-valid ISBN literal echoed by the upstream 13/10 arrays, else the requested one. */
function pickIsbn(edition: OpenLibraryEdition, requested: Isbn): Isbn {
  const candidates = Array.flatMap([edition.isbn_13, edition.isbn_10], (list) => list ?? []);
  const decoded = Array.filterMap(candidates, (value): Result.Result<Isbn, void> => {
    if (!Predicate.isString(value)) return Result.failVoid;
    const isbn = decodeIsbn(value);
    return Option.isNone(isbn) ? Result.failVoid : Result.succeed(isbn.value);
  });
  return Option.getOrElse(Array.head(decoded), () => requested);
}

/** Bounded, sanitised subject strings for the `extra.subject` passthrough. */
function subjectList(values: Option.Option<readonly unknown[]>): Option.Option<readonly string[]> {
  if (Option.isNone(values)) return Option.none();
  const subjects = Array.filterMap(values.value, (value): Result.Result<string, void> => {
    const text = sanitiseText(value);
    return Option.isNone(text) ? Result.failVoid : Result.succeed(text.value);
  }).slice(0, MAX_SUBJECTS);
  return Array.isArrayNonEmpty(subjects) ? Option.some(subjects) : Option.none();
}

/** Structures a bounded list of author display names into {@link CslName}s. */
function structuredAuthors(names: readonly string[]): CslName[] {
  return Array.filterMap(names, (name): Result.Result<CslName, void> => {
    const parsed = parsePersonName(name);
    return parsed === null ? Result.failVoid : Result.succeed(parsed);
  }).slice(0, MAX_AUTHORS);
}

/**
 * Normalises an OpenLibrary edition (plus separately-resolved author
 * names) into a CSL-aligned {@link BiblioRecord}. `requestedIsbn` is the
 * already-validated {@link Isbn} the lookup was keyed by; it is the
 * fallback identifier when the upstream body echoes none of its own.
 *
 * `Option.none()` when the record has no usable title — we won't emit a
 * titleless book.
 *
 * @since 0.1.0
 */
export function normaliseOpenLibraryRecord(
  edition: OpenLibraryEdition,
  requestedIsbn: Isbn,
  authorNames: readonly string[],
): Option.Option<BiblioRecord> {
  const baseTitle = sanitiseText(edition.title);
  if (Option.isNone(baseTitle)) return Option.none();
  const subtitle = sanitiseText(edition.subtitle);
  const title = Option.isNone(subtitle)
    ? baseTitle.value
    : `${baseTitle.value}: ${subtitle.value}`.slice(0, MAX_TEXT_FIELD_LENGTH);

  const isbn = pickIsbn(edition, requestedIsbn);
  const publisher = firstString(Option.fromNullishOr(edition.publishers));
  const publisherPlace = firstString(Option.fromNullishOr(edition.publish_places));
  const issued = dateFromPublishDate(edition.publish_date);
  const author = structuredAuthors(authorNames);
  const subject = subjectList(Option.fromNullishOr(edition.subjects));

  return Option.some({
    type: "book",
    title,
    ...(Option.isSome(publisher) ? { publisher: publisher.value } : {}),
    ...(Option.isSome(publisherPlace) ? { "publisher-place": publisherPlace.value } : {}),
    ...(Array.isReadonlyArrayNonEmpty(author) ? { author } : {}),
    ...(Option.isSome(issued) ? { issued: issued.value } : {}),
    identifiers: { isbn },
    provenance: {
      source: "openlibrary",
      retrievedBy: {
        identifierType: "isbn",
        identifier: requestedIsbn,
        endpoint: `${OPENLIBRARY_BASE}/isbn/${requestedIsbn}.json`,
      },
    },
    ...(Option.isSome(subject) ? { extra: { subject: subject.value } } : {}),
  });
}

/**
 * Resolves an {@link Isbn} against OpenLibrary: the edition record, then
 * its referenced author records, normalised into a CSL {@link BiblioRecord}.
 * `Option.none()` on a clean 404 from the edition lookup; a {@link LookupFailed}
 * on any other upstream fault. `client` is expected to already carry the
 * polite User-Agent and `filterStatusOk` (composed once in `service.ts`).
 *
 * @since 0.1.0
 */
export const lookupOpenLibraryByIsbn: (
  client: HttpClient.HttpClient,
  isbn: Isbn,
) => Effect.Effect<Option.Option<BiblioRecord>, LookupFailed> = Effect.fn(
  "lookupOpenLibraryByIsbn",
)(function* (client: HttpClient.HttpClient, isbn: Isbn) {
  const ol = makeGet(client, OPENLIBRARY_BASE, "openlibrary");
  // `isbn` is exclusively digits (the identifier layer's SSRF guard) —
  // safe in the path.
  const edition = yield* ol(`/isbn/${isbn}.json`, OpenLibraryEdition);
  if (Option.isNone(edition)) return Option.none();

  // Sequential (`concurrency: 1`): OpenLibrary is a courtesy-rate-limited
  // public API, and the author lookups must stay in edition order.
  // `key` is validated `/authors/OL\d+A` — safe in the path.
  const authors = yield* Effect.forEach(
    openLibraryAuthorKeys(edition.value),
    (key) => ol(`${key}.json`, OpenLibraryAuthor),
    { concurrency: 1 },
  );
  const authorNames = Array.filterMap(authors, (author): Result.Result<string, void> => {
    if (Option.isNone(author)) return Result.failVoid;
    const name = openLibraryAuthorName(author.value);
    return Option.isNone(name) ? Result.failVoid : Result.succeed(name.value);
  });

  return normaliseOpenLibraryRecord(edition.value, isbn, authorNames);
});
