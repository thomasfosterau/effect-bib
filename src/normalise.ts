/**
 * @copyright Thomas Foster
 *
 * Untrusted-response schemas and pure normalisers for the bibliographic
 * lookup services (KB-010, issue #574).
 *
 * OpenLibrary and Crossref responses are **untrusted**: the schemas here
 * are deliberately lenient (every field optional, arrays of unknown
 * shapes tolerated) so a partial or unexpected payload decodes rather
 * than throwing, and the normalisers then extract only the fields we
 * trust, sanitising each one ({@link module:lib/server/biblio/record}).
 * Decoding never trusts upstream lengths or types — a hostile response
 * can at worst yield a record with fewer fields, never an injection.
 *
 * These functions are pure and unit-tested against captured fixtures
 * without any network access.
 *
 * @module lib/server/biblio/normalise
 */

import * as Schema from "effect/Schema";
import { isbnLength, normaliseDoi, normaliseIsbn } from "./identifiers";
import {
  type IngestedAuthor,
  type IngestedRecord,
  MAX_AUTHORS,
  MAX_TEXT_FIELD_LENGTH,
  sanitiseText,
  sanitiseYear,
} from "./record";

// ── OpenLibrary (ISBN) ────────────────────────────────────────────────

/**
 * Lenient schema for the OpenLibrary `/isbn/<isbn>.json` edition record.
 * Only the fields we read are modelled, all optional; `Schema.Unknown`
 * arrays absorb the `authors` / `works` reference objects whose shape we
 * don't depend on. Unknown extra keys are ignored.
 */
export const OpenLibraryEdition = Schema.Struct({
  title: Schema.optional(Schema.Unknown),
  subtitle: Schema.optional(Schema.Unknown),
  publish_date: Schema.optional(Schema.Unknown),
  publishers: Schema.optional(Schema.Array(Schema.Unknown)),
  isbn_10: Schema.optional(Schema.Array(Schema.Unknown)),
  isbn_13: Schema.optional(Schema.Array(Schema.Unknown)),
  // `authors` on an edition is an array of `{ key: "/authors/OL..A" }`
  // reference objects; we resolve names separately via the author
  // lookups, so the names are supplied to the normaliser out-of-band.
  authors: Schema.optional(Schema.Array(Schema.Unknown)),
});
export type OpenLibraryEdition = typeof OpenLibraryEdition.Type;

/**
 * Lenient schema for an OpenLibrary `/authors/<id>.json` record — we
 * read only the display `name`.
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

/**
 * Builds the first plausible publisher string from the upstream array.
 */
function firstString(values: readonly unknown[] | undefined): string | null {
  if (!values) return null;
  for (const v of values) {
    const s = sanitiseText(v);
    if (s !== null) return s;
  }
  return null;
}

/** Extracts a 4-digit year from a free-text `publish_date` like "Jan 2003". */
function yearFromPublishDate(value: unknown): number | null {
  const text = typeof value === "string" ? value : null;
  if (text === null) return null;
  const match = text.match(/(\d{4})/);
  return match ? sanitiseYear(match[1]) : null;
}

/**
 * Normalises an OpenLibrary edition (plus separately-resolved author
 * names) into a neutral {@link IngestedRecord}. `requestedIsbn` is the
 * already-normalised ISBN the lookup was keyed by; it becomes the
 * record's `authorityId` and is slotted into the matching `isbn10` /
 * `isbn13` field if the upstream didn't echo one.
 *
 * Returns `null` when the record has no usable title — we won't ingest a
 * titleless book.
 */
export function normaliseOpenLibrary(
  edition: OpenLibraryEdition,
  requestedIsbn: string,
  authorNames: readonly string[],
): IngestedRecord | null {
  const baseTitle = sanitiseText(edition.title);
  if (baseTitle === null) return null;
  const subtitle = sanitiseText(edition.subtitle);
  const title = subtitle ? `${baseTitle}: ${subtitle}`.slice(0, MAX_TEXT_FIELD_LENGTH) : baseTitle;

  const isbn10FromUpstream = firstNormalisedIsbn(edition.isbn_10, 10);
  const isbn13FromUpstream = firstNormalisedIsbn(edition.isbn_13, 13);
  const requestedLen = isbnLength(requestedIsbn);
  const isbn10 = isbn10FromUpstream ?? (requestedLen === 10 ? requestedIsbn : null);
  const isbn13 = isbn13FromUpstream ?? (requestedLen === 13 ? requestedIsbn : null);

  const authors: IngestedAuthor[] = [];
  for (const name of authorNames) {
    if (authors.length >= MAX_AUTHORS) break;
    const clean = sanitiseText(name);
    if (clean !== null) authors.push({ name: clean });
  }

  return {
    source: "openlibrary",
    authorityId: requestedIsbn,
    kind: "book",
    title,
    publicationYear: yearFromPublishDate(edition.publish_date),
    publisher: firstString(edition.publishers),
    isbn10,
    isbn13,
    doi: null,
    authors,
  };
}

/** Reads the OpenLibrary author `name` field, sanitised. */
export function openLibraryAuthorName(author: OpenLibraryAuthor): string | null {
  return sanitiseText(author.name);
}

function firstNormalisedIsbn(values: readonly unknown[] | undefined, want: 10 | 13): string | null {
  if (!values) return null;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const normalised = normaliseIsbn(v);
    if (normalised !== null && isbnLength(normalised) === want) return normalised;
  }
  return null;
}

// ── Crossref (DOI) ────────────────────────────────────────────────────

/**
 * Lenient schema for the Crossref `/works/<doi>` response envelope. Only
 * the `message` fields we read are modelled, all optional.
 */
export const CrossrefResponse = Schema.Struct({
  message: Schema.optional(
    Schema.Struct({
      DOI: Schema.optional(Schema.Unknown),
      title: Schema.optional(Schema.Array(Schema.Unknown)),
      publisher: Schema.optional(Schema.Unknown),
      author: Schema.optional(Schema.Array(Schema.Unknown)),
      // `published` / `issued` carry `{ "date-parts": [[year, month, day]] }`.
      published: Schema.optional(Schema.Unknown),
      issued: Schema.optional(Schema.Unknown),
    }),
  ),
});
export type CrossrefResponse = typeof CrossrefResponse.Type;

/** Extracts the publication year from a Crossref `date-parts` object. */
function crossrefYear(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const dateParts = (value as { "date-parts"?: unknown })["date-parts"];
  if (!Array.isArray(dateParts) || dateParts.length === 0) return null;
  const first = dateParts[0];
  if (!Array.isArray(first) || first.length === 0) return null;
  return sanitiseYear(first[0]);
}

/** Builds a display name from a Crossref author `{ given, family }` object. */
function crossrefAuthorName(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const obj = entry as { given?: unknown; family?: unknown; name?: unknown };
  const given = sanitiseText(obj.given);
  const family = sanitiseText(obj.family);
  if (family !== null) return given !== null ? `${given} ${family}` : family;
  // Some entries (organisations) carry a single `name`.
  return sanitiseText(obj.name);
}

/**
 * Normalises a Crossref `/works/<doi>` response into a neutral
 * {@link IngestedRecord}. `requestedDoi` is the already-normalised DOI
 * the lookup was keyed by; it becomes the record's `authorityId` and the
 * `doi` field. Returns `null` when the record has no usable title.
 */
export function normaliseCrossref(
  response: CrossrefResponse,
  requestedDoi: string,
): IngestedRecord | null {
  const message = response.message;
  if (!message) return null;
  const title = firstString(message.title);
  if (title === null) return null;

  const authors: IngestedAuthor[] = [];
  for (const entry of message.author ?? []) {
    if (authors.length >= MAX_AUTHORS) break;
    const name = crossrefAuthorName(entry);
    if (name !== null) authors.push({ name });
  }

  // Prefer the DOI echoed by Crossref (canonical casing) but fall back to
  // the requested one; re-normalise so a hostile echo can't smuggle a
  // malformed value into the persisted column.
  const echoed = typeof message.DOI === "string" ? normaliseDoi(message.DOI) : null;
  const doi = echoed ?? requestedDoi;

  return {
    source: "crossref",
    authorityId: requestedDoi,
    kind: "article",
    title,
    publicationYear: crossrefYear(message.published) ?? crossrefYear(message.issued),
    publisher: sanitiseText(message.publisher),
    isbn10: null,
    isbn13: null,
    doi,
    authors,
  };
}
