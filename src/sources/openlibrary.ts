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
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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
export type OpenLibraryEdition = typeof OpenLibraryEdition.Type;

/**
 * Lenient schema for an OpenLibrary `/authors/<id>.json` record — we read
 * only the display `name`.
 */
export const OpenLibraryAuthor = Schema.Struct({
  name: Schema.optional(Schema.Unknown),
});
export type OpenLibraryAuthor = typeof OpenLibraryAuthor.Type;

/** Extracts the `/authors/OL...A` keys referenced by an edition record. */
export function openLibraryAuthorKeys(edition: OpenLibraryEdition): readonly string[] {
  const refs = edition.authors ?? [];
  const keys: string[] = [];
  for (const ref of refs) {
    if (keys.length >= MAX_AUTHORS) break;
    if (typeof ref === "object" && ref !== null && "key" in ref) {
      const key = (ref as { key: unknown }).key;
      // Author keys look like `/authors/OL12345A`; the strict class is the
      // SSRF guard for the follow-up author lookup URL.
      if (typeof key === "string" && /^\/authors\/OL\d+A$/.test(key)) {
        keys.push(key);
      }
    }
  }
  return keys;
}

/** Reads the OpenLibrary author `name` field, sanitised. */
export function openLibraryAuthorName(author: OpenLibraryAuthor): string | null {
  return sanitiseText(author.name);
}

/** Extracts a {@link CslDate} carrying just the year from a free-text `publish_date` like "Jan 2003". */
function dateFromPublishDate(value: unknown): CslDate | undefined {
  const text = typeof value === "string" ? value : null;
  if (text === null) return undefined;
  const match = text.match(/(\d{4})/);
  const year = match ? sanitiseYear(match[1]) : null;
  return year === null ? undefined : dateFromYear(year);
}

/** Picks the first checksum-valid ISBN literal echoed by the upstream 13/10 arrays, else the requested one. */
function pickIsbn(edition: OpenLibraryEdition, requested: Isbn): Isbn {
  for (const list of [edition.isbn_13, edition.isbn_10]) {
    for (const v of list ?? []) {
      if (typeof v !== "string") continue;
      const decoded = decodeIsbn(v);
      if (Option.isSome(decoded)) return decoded.value;
    }
  }
  return requested;
}

/** Bounded, sanitised subject strings for the `extra.subject` passthrough. */
function subjectList(values: readonly unknown[] | undefined): readonly string[] | undefined {
  if (!values) return undefined;
  const subjects: string[] = [];
  for (const v of values) {
    if (subjects.length >= MAX_SUBJECTS) break;
    const s = sanitiseText(v);
    if (s !== null) subjects.push(s);
  }
  return subjects.length > 0 ? subjects : undefined;
}

/** Structures a bounded list of author display names into {@link CslName}s. */
function structuredAuthors(names: readonly string[]): CslName[] {
  const authors: CslName[] = [];
  for (const name of names) {
    if (authors.length >= MAX_AUTHORS) break;
    const parsed = parsePersonName(name);
    if (parsed !== null) authors.push(parsed);
  }
  return authors;
}

/**
 * Normalises an OpenLibrary edition (plus separately-resolved author
 * names) into a CSL-aligned {@link BiblioRecord}. `requestedIsbn` is the
 * already-validated {@link Isbn} the lookup was keyed by; it is the
 * fallback identifier when the upstream body echoes none of its own.
 *
 * Returns `null` when the record has no usable title — we won't emit a
 * titleless book.
 */
export function normaliseOpenLibraryRecord(
  edition: OpenLibraryEdition,
  requestedIsbn: Isbn,
  authorNames: readonly string[],
): BiblioRecord | null {
  const baseTitle = sanitiseText(edition.title);
  if (baseTitle === null) return null;
  const subtitle = sanitiseText(edition.subtitle);
  const title = subtitle ? `${baseTitle}: ${subtitle}`.slice(0, MAX_TEXT_FIELD_LENGTH) : baseTitle;

  const isbn = pickIsbn(edition, requestedIsbn);
  const publisher = firstString(edition.publishers);
  const publisherPlace = firstString(edition.publish_places);
  const issued = dateFromPublishDate(edition.publish_date);
  const author = structuredAuthors(authorNames);
  const subject = subjectList(edition.subjects);

  return {
    type: "book",
    title,
    ...(publisher !== null ? { publisher } : {}),
    ...(publisherPlace !== null ? { "publisher-place": publisherPlace } : {}),
    ...(author.length > 0 ? { author } : {}),
    ...(issued !== undefined ? { issued } : {}),
    identifiers: { isbn },
    provenance: {
      source: "openlibrary",
      retrievedBy: {
        identifierType: "isbn",
        identifier: requestedIsbn,
        endpoint: `${OPENLIBRARY_BASE}/isbn/${requestedIsbn}.json`,
      },
    },
    ...(subject !== undefined ? { extra: { subject } } : {}),
  };
}

/**
 * Resolves an {@link Isbn} against OpenLibrary: the edition record, then
 * its referenced author records, normalised into a CSL {@link BiblioRecord}.
 * `Option.none()` on a clean 404 from the edition lookup; a {@link LookupFailed}
 * on any other upstream fault. `client` is expected to already carry the
 * polite User-Agent and `filterStatusOk` (composed once in `service.ts`).
 */
export const lookupOpenLibraryByIsbn = (
  client: HttpClient.HttpClient,
  isbn: Isbn,
): Effect.Effect<Option.Option<BiblioRecord>, LookupFailed> =>
  Effect.gen(function* () {
    const ol = makeGet(client, OPENLIBRARY_BASE, "openlibrary");
    // `isbn` is exclusively digits (the identifier layer's SSRF guard) —
    // safe in the path.
    const edition = yield* ol(`/isbn/${isbn}.json`, OpenLibraryEdition);
    if (Option.isNone(edition)) return Option.none();

    const authorNames: string[] = [];
    for (const key of openLibraryAuthorKeys(edition.value)) {
      if (authorNames.length >= MAX_AUTHORS) break;
      // `key` is validated `/authors/OL\d+A` — safe in the path.
      const author = yield* ol(`${key}.json`, OpenLibraryAuthor);
      if (Option.isSome(author)) {
        const name = openLibraryAuthorName(author.value);
        if (name !== null) authorNames.push(name);
      }
    }

    return Option.fromNullishOr(normaliseOpenLibraryRecord(edition.value, isbn, authorNames));
  });
