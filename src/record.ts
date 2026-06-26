/**
 * @copyright Thomas Foster
 *
 * Neutral ingested-record shape and identifier helpers for the
 * bibliographic ingestion pipeline (KB-010, issue #574).
 *
 * An {@link IngestedRecord} is the provider-neutral intermediate the
 * lookup services ({@link module:lib/server/biblio/lookup}) normalise
 * their raw OpenLibrary / Crossref responses into, before the ingest
 * operation ({@link module:lib/server/biblio/ingest}) maps it onto the
 * concrete CreativeWork subtypes that carry the identifiers and anchor
 * Authorship — **ISBN -> Book + Edition**, **DOI -> Article**. The FRBR
 * `works.ts` tracer is a separate abstract chain that carries no
 * identifiers and cannot anchor a Contribution (its `subjectId` is a
 * `CreativeWorkId`), so ingested records land on the CreativeWork
 * subtypes, not on Work / Expression / Manifestation.
 *
 * Everything here is pure: identifier validation and the record shape
 * are unit-testable without a database or network. The provider field
 * doubles as the import provenance recorded on each created Entity via
 * the existing `entity.authoritySource` / `entity.authorityId` pair.
 *
 * @module lib/server/biblio/record
 */

import * as Schema from "effect/Schema";

/**
 * The external authority a record was ingested from. Stored verbatim as
 * the created Entity's `authoritySource`, so re-import of the same
 * identifier de-duplicates against the `(authoritySource, authorityId)`
 * unique index rather than minting a new Entity.
 */
// Runtime schema for the import-source literal; the type alias below is
// consumed across biblio, the Schema value is the validation seam for the
// deferred ingestion API surface (#574).
export const ImportSource = Schema.Literals(["openlibrary", "crossref"]);
export type ImportSource = typeof ImportSource.Type;

/** A normalised contributor (author) extracted from an external record. */
export interface IngestedAuthor {
  /** Display name, already trimmed and length-bounded. */
  readonly name: string;
}

/**
 * Provider-neutral bibliographic record. Every string field is already
 * trimmed and length-bounded by the normalisers; consumers treat these
 * as trusted application values, not raw upstream output.
 */
export interface IngestedRecord {
  /** Which external authority resolved this record. */
  readonly source: ImportSource;
  /**
   * The authority identifier this record is keyed by (a normalised ISBN
   * for OpenLibrary, a lower-cased DOI for Crossref). Combined with
   * {@link IngestedRecord.source} this is the dedup / provenance key.
   */
  readonly authorityId: string;
  /** Which bibliographic shape to materialise. */
  readonly kind: "book" | "article";
  /** Title — always present (normalisers reject records without one). */
  readonly title: string;
  /** Publication year, if the upstream supplied a plausible one. */
  readonly publicationYear: number | null;
  /** Publisher display name, if known (books). */
  readonly publisher: string | null;
  /** Normalised ISBN-10, if present (books). */
  readonly isbn10: string | null;
  /** Normalised ISBN-13, if present (books). */
  readonly isbn13: string | null;
  /** Lower-cased DOI, if present (articles). */
  readonly doi: string | null;
  /** Extracted authors, in upstream order. */
  readonly authors: readonly IngestedAuthor[];
}

// ── Field bounds ──────────────────────────────────────────────────────

/**
 * Upper bound on any single free-text field copied from an untrusted
 * upstream record. Titles, publisher names and author names are clamped
 * to this before persistence so a hostile or malformed response can't
 * push an unbounded blob into the database (defence in depth — the
 * columns are `text`, but we don't want to store megabytes).
 */
export const MAX_TEXT_FIELD_LENGTH = 2000;

/** Cap on how many authors we extract from a single record. */
export const MAX_AUTHORS = 100;

/** The narrowest plausible publication year we accept from upstream. */
const MIN_PUBLICATION_YEAR = 1;
/** Guard against absurd future years. */
const MAX_PUBLICATION_YEAR = 2200;

/**
 * Trims, collapses, and length-clamps an untrusted free-text value.
 * Returns `null` for empty / whitespace-only input so callers can map
 * "nothing usable" to a cleared column rather than an empty string.
 */
export function sanitiseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, MAX_TEXT_FIELD_LENGTH);
}

/**
 * Coerces an untrusted value to a plausible publication year, or `null`.
 * Accepts a number or a numeric string (upstreams send both); rejects
 * non-integers and years outside {@link MIN_PUBLICATION_YEAR} …
 * {@link MAX_PUBLICATION_YEAR}.
 */
export function sanitiseYear(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n)) return null;
  if (n < MIN_PUBLICATION_YEAR || n > MAX_PUBLICATION_YEAR) return null;
  return n;
}

// ── Identifier validation (SSRF / path-injection defence) ─────────────

/**
 * Strips ISBN punctuation (hyphens, spaces) and upper-cases the trailing
 * `x` check digit. Does **not** validate the checksum — upstreams accept
 * lookups by raw ISBN and we let them 404 rather than re-implement the
 * mod-11 / mod-10 algorithm. Returns `null` if the cleaned value isn't a
 * syntactically well-formed ISBN-10 or ISBN-13.
 *
 * The strict character class is the SSRF guard: the cleaned value is
 * interpolated into the upstream URL path, so it must be exclusively
 * digits (plus a possible `X` check digit on ISBN-10) — never a slash,
 * dot, or anything that could escape the intended path segment.
 */
export function normaliseIsbn(raw: string): string | null {
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(cleaned)) return cleaned;
  if (/^\d{13}$/.test(cleaned)) return cleaned;
  return null;
}

/** Classifies a normalised ISBN as 10- or 13-digit. */
export function isbnLength(normalised: string): 10 | 13 {
  return normalised.length === 13 ? 13 : 10;
}

/**
 * Validates and lower-cases a DOI. A DOI is `10.<registrant>/<suffix>`;
 * we accept the registered-syntax shape and reject anything that doesn't
 * start with the `10.` prefix or contains whitespace / control
 * characters. The result is percent-encoded by the caller before being
 * placed in the URL path, but we still reject control characters here so
 * a malformed value never reaches the request builder.
 */
export function normaliseDoi(raw: string): string | null {
  const trimmed = raw.trim();
  // DOIs are case-insensitive; the registry canonicalises to lower case.
  const lowered = trimmed.toLowerCase();
  // Strip a leading resolver URL or `doi:` scheme if the caller pasted one.
  const bare = lowered
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .trim();
  if (bare.length === 0 || bare.length > 256) return null;
  // Reject ASCII control characters defensively before the value reaches
  // the URL builder. A codepoint check (not a literal-control-char regex)
  // keeps this source file free of control bytes.
  for (let i = 0; i < bare.length; i++) {
    const code = bare.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  // `10.` prefix, a registrant code, a slash, and a non-empty suffix with
  // no whitespace (`\S+` rules out spaces and the control chars above).
  if (!/^10\.\d{2,9}\/\S+$/.test(bare)) return null;
  // Defence in depth: reject any `..` path-traversal segment. The suffix
  // is percent-encoded before it reaches the URL (so `/` and `.` are
  // already neutralised there), but a value containing `..` is never a
  // legitimate DOI and we refuse to persist or look it up.
  if (bare.split("/").some((segment) => segment === "..")) return null;
  return bare;
}
