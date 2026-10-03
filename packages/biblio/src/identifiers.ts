/**
 * First-class bibliographic identifiers — ISBN, DOI, ISSN, ORCID — as
 * branded, checksum-validated types (#1069).
 *
 * This module is the identity boundary and the SSRF / path-injection
 * boundary for every path that interpolates an identifier into a URL or
 * keys dedup / external-identifier assertions on one. Each family is a
 * branded Effect-Schema value with:
 *
 * - a **lenient decoder** (`decode*`) that takes an untrusted string and
 *   returns `Option.some(branded)` only when the value is syntactically
 *   well-formed **and** passes its checksum, else `Option.none()` — a
 *   partial or hostile input yields nothing, never a throw (the same
 *   untrusted-input posture as the lookup sources' response schemas);
 * - a **real checksum** where the scheme has one (ISBN-10 mod-11,
 *   ISBN-13 mod-10 / EAN, ISSN mod-11, ORCID ISO 7064 mod-11-2); and
 * - a **converter** where meaningful (ISBN 10 ↔ 13).
 *
 * The branding is why a proven `Isbn` can't be confused with a raw
 * `string` at a call site: the checksum has run, and the canonical form is
 * exclusively the digit class the upstream URL path admits.
 *
 * The package stays persistence-free: storing these is the application's
 * job; this module only produces proven identifiers.
 *
 * @copyright Thomas Foster
 * @module biblio/identifiers
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as String from "effect/String";

// ── Branded types ─────────────────────────────────────────────────────

/**
 * A proven ISBN, stored as its canonical **13-digit** form (every valid
 * ISBN-10 has a 978-prefixed 13-form, and the 13-form is the stable
 * identity used for dedup). The 10-form, where it exists, is recovered on
 * demand via {@link isbnForms}. The value is exclusively digits — the
 * path-segment SSRF guard for any URL built from it.
 *
 * @since 0.1.0
 */
export const Isbn = Schema.String.pipe(Schema.brand("Isbn"));
/**
 * @since 0.1.0
 */
export type Isbn = typeof Isbn.Type;

/**
 * A proven DOI, canonicalised to lower case with resolver/scheme prefixes stripped.
 *
 * @since 0.1.0
 */
export const Doi = Schema.String.pipe(Schema.brand("Doi"));
/**
 * @since 0.1.0
 */
export type Doi = typeof Doi.Type;

/**
 * A proven ISSN in canonical `NNNN-NNNN` form (an `X` check digit upper-cased).
 *
 * @since 0.1.0
 */
export const Issn = Schema.String.pipe(Schema.brand("Issn"));
/**
 * @since 0.1.0
 */
export type Issn = typeof Issn.Type;

/**
 * A proven ORCID in canonical `0000-0002-1825-0097` form.
 *
 * @since 0.1.0
 */
export const Orcid = Schema.String.pipe(Schema.brand("Orcid"));
/**
 * @since 0.1.0
 */
export type Orcid = typeof Orcid.Type;

// ── ISBN ──────────────────────────────────────────────────────────────

/** Strips ISBN punctuation (hyphens, spaces) and upper-cases the `X` check digit. */
function cleanIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** The numeric value of an ISBN digit character (`X` → 10). */
function isbnDigit(char: string): number {
  return char === "X" ? 10 : char.charCodeAt(0) - 48;
}

/**
 * True when a cleaned 10-character string is a checksum-valid ISBN-10:
 * `Σ (10 − i)·dᵢ ≡ 0 (mod 11)`, the trailing check digit optionally `X`
 * (= 10). Syntax is validated first so a non-ISBN can't index out of range.
 */
function isValidIsbn10(cleaned: string): boolean {
  if (!/^\d{9}[\dX]$/.test(cleaned)) return false;
  const sum = Array.reduce(
    cleaned.split(""),
    0,
    (acc, char, i) => acc + (10 - i) * isbnDigit(char),
  );
  return sum % 11 === 0;
}

/**
 * True when a cleaned 13-digit string is a checksum-valid ISBN-13 / EAN:
 * alternating weights `1,3,1,3,…` over all 13 digits sum to `0 (mod 10)`.
 */
function isValidIsbn13(cleaned: string): boolean {
  if (!/^\d{13}$/.test(cleaned)) return false;
  const sum = Array.reduce(
    cleaned.split(""),
    0,
    (acc, char, i) => acc + (i % 2 === 0 ? 1 : 3) * isbnDigit(char),
  );
  return sum % 10 === 0;
}

/** The EAN-13 check digit for a 12-digit prefix. */
function isbn13CheckDigit(twelve: string): string {
  const sum = Array.reduce(
    twelve.split(""),
    0,
    (acc, char, i) => acc + (i % 2 === 0 ? 1 : 3) * isbnDigit(char),
  );
  return ((10 - (sum % 10)) % 10).toString();
}

/** The mod-11 check digit (`X` = 10) for a 9-digit ISBN-10 body. */
function isbn10CheckDigit(nine: string): string {
  const sum = Array.reduce(nine.split(""), 0, (acc, char, i) => acc + (10 - i) * isbnDigit(char));
  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? "X" : remainder.toString();
}

/**
 * Converts a checksum-valid ISBN-10 to its ISBN-13 form: `978` + the
 * first nine digits + a recomputed EAN check digit. Assumes a validated
 * input (callers pass only values that cleared {@link isValidIsbn10}).
 *
 * @since 0.1.0
 */
export function convertIsbn10To13(isbn10: string): string {
  const twelve = `978${cleanIsbn(isbn10).slice(0, 9)}`;
  return twelve + isbn13CheckDigit(twelve);
}

/**
 * Converts an ISBN-13 to its ISBN-10 form, or `Option.none()` when it has
 * none — only `978`-prefixed 13-forms convert back (a `979` ISBN has no
 * ISBN-10). The ISBN-10 check digit is recomputed (mod-11), not copied.
 *
 * @since 0.1.0
 */
export function convertIsbn13To10(isbn13: string): Option.Option<string> {
  const cleaned = cleanIsbn(isbn13);
  if (!/^978\d{10}$/.test(cleaned)) return Option.none();
  const nine = cleaned.slice(3, 12);
  return Option.some(nine + isbn10CheckDigit(nine));
}

/**
 * Both canonical forms of a proven {@link Isbn}: the 13-form always, the
 * 10-form when it exists. `isbn10` is `null`, not an `Option`, by contract
 * (a stable shape existing consumers rely on).
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line effect/prefer-option-over-null -- cross-slice: apps/api consumes `isbn10` as a plain nullable
export function isbnForms(isbn: Isbn): { readonly isbn13: string; readonly isbn10: string | null } {
  return { isbn13: isbn, isbn10: Option.getOrNull(convertIsbn13To10(isbn)) };
}

/**
 * Lenient ISBN decoder: accepts a hyphenated / spaced ISBN-10 or ISBN-13,
 * validates its checksum, and returns the canonical 13-form branded
 * {@link Isbn} — or `Option.none()` for anything that isn't a proven ISBN.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { decodeIsbn, isbnForms } from "@thomasfosterau/biblio"
 *
 * // Hyphens and spaces are ignored; an ISBN-10 canonicalises to its 13-form.
 * const isbn = decodeIsbn("0-06-231609-5")
 * assert.strictEqual(Option.getOrNull(isbn), "9780062316097")
 *
 * // Both forms are recoverable from the proven value.
 * assert.deepStrictEqual(Option.map(isbn, isbnForms), Option.some({ isbn13: "9780062316097", isbn10: "0062316095" }))
 *
 * // A checksum failure is `Option.none()`, never a throw.
 * assert.strictEqual(Option.isNone(decodeIsbn("978-0-06-231609-8")), true)
 * ```
 *
 * @since 0.1.0
 */
export function decodeIsbn(raw: string): Option.Option<Isbn> {
  const cleaned = cleanIsbn(raw);
  if (isValidIsbn13(cleaned)) return Option.some(Isbn.make(cleaned));
  if (isValidIsbn10(cleaned)) return Option.some(Isbn.make(convertIsbn10To13(cleaned)));
  return Option.none();
}

// ── DOI ───────────────────────────────────────────────────────────────

/**
 * Validates and lower-cases a DOI, stripping a leading resolver URL or
 * `doi:` scheme. A DOI is `10.<registrant>/<suffix>`; control characters,
 * whitespace, over-length values, and `..` path-traversal segments are
 * rejected before the value could reach a URL builder. Returns the bare
 * lowercased DOI string, or `Option.none()`.
 *
 * {@link decodeDoi} brands the result.
 *
 * @since 0.1.0
 */
export function normaliseDoi(raw: string): Option.Option<string> {
  const trimmed = raw.trim();
  // DOIs are case-insensitive; the registry canonicalises to lower case.
  const lowered = trimmed.toLowerCase();
  // Strip a leading resolver URL or `doi:` scheme if the caller pasted one.
  const bare = lowered
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .trim();
  if (String.isEmpty(bare) || bare.length > 256) return Option.none();
  // Reject ASCII control characters defensively before the value reaches
  // the URL builder. A codepoint check (not a literal-control-char regex)
  // keeps this source file free of control bytes.
  const hasControlChar = Array.some(bare.split(""), (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (hasControlChar) return Option.none();
  // `10.` prefix, a registrant code, a slash, and a non-empty suffix with
  // no whitespace (`\S+` rules out spaces and the control chars above).
  if (!/^10\.\d{2,9}\/\S+$/.test(bare)) return Option.none();
  // Defence in depth: reject any `..` path-traversal segment.
  if (bare.split("/").some((segment) => segment === "..")) return Option.none();
  return Option.some(bare);
}

/**
 * Lenient DOI decoder: the hardened {@link normaliseDoi} plus branding.
 * `Option.none()` for anything that isn't a well-formed DOI.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { decodeDoi } from "@thomasfosterau/biblio"
 *
 * // A pasted resolver URL is stripped and the DOI lower-cased.
 * assert.strictEqual(Option.getOrNull(decodeDoi("https://doi.org/10.1038/NPHYS1170")), "10.1038/nphys1170")
 *
 * assert.strictEqual(Option.isNone(decodeDoi("not a doi")), true)
 * ```
 *
 * @since 0.1.0
 */
export function decodeDoi(raw: string): Option.Option<Doi> {
  return Option.map(normaliseDoi(raw), Doi.make);
}

// ── ISSN ──────────────────────────────────────────────────────────────

/**
 * True when a cleaned 8-character string is a checksum-valid ISSN:
 * `Σ (8 − i)·dᵢ ≡ 0 (mod 11)`, the trailing check digit optionally `X`.
 */
function isValidIssn(cleaned: string): boolean {
  if (!/^\d{7}[\dX]$/.test(cleaned)) return false;
  const sum = Array.reduce(cleaned.split(""), 0, (acc, char, i) => acc + (8 - i) * isbnDigit(char));
  return sum % 11 === 0;
}

/**
 * Lenient ISSN decoder: accepts a hyphenated or bare 8-character ISSN,
 * validates the mod-11 checksum, and returns the canonical `NNNN-NNNN`
 * branded {@link Issn} — or `Option.none()`.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { decodeIssn } from "@thomasfosterau/biblio"
 *
 * assert.strictEqual(Option.getOrNull(decodeIssn("00280836")), "0028-0836")
 * ```
 *
 * @since 0.1.0
 */
export function decodeIssn(raw: string): Option.Option<Issn> {
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!isValidIssn(cleaned)) return Option.none();
  return Option.some(Issn.make(`${cleaned.slice(0, 4)}-${cleaned.slice(4)}`));
}

// ── ORCID ─────────────────────────────────────────────────────────────

/**
 * True when a cleaned 16-character string is a checksum-valid ORCID under
 * ISO 7064 mod-11-2 over the first 15 digits, the 16th being the check
 * character (`X` = 10).
 */
function isValidOrcid(cleaned: string): boolean {
  if (!/^\d{15}[\dX]$/.test(cleaned)) return false;
  const total = Array.reduce(
    cleaned.slice(0, 15).split(""),
    0,
    (acc, char) => ((acc + isbnDigit(char)) * 2) % 11,
  );
  const result = (12 - (total % 11)) % 11;
  const check = result === 10 ? "X" : result.toString();
  return check === cleaned[15];
}

/**
 * Lenient ORCID decoder: strips a leading `https://orcid.org/`, validates
 * the ISO 7064 checksum, and returns the canonical
 * `0000-0002-1825-0097` branded {@link Orcid} — or `Option.none()`.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { decodeOrcid } from "@thomasfosterau/biblio"
 *
 * assert.strictEqual(Option.getOrNull(decodeOrcid("https://orcid.org/0000-0002-1825-0097")), "0000-0002-1825-0097")
 * ```
 *
 * @since 0.1.0
 */
export function decodeOrcid(raw: string): Option.Option<Orcid> {
  const bare = raw.trim().replace(/^https?:\/\/orcid\.org\//i, "");
  const cleaned = bare.replace(/[\s-]/g, "").toUpperCase();
  if (!isValidOrcid(cleaned)) return Option.none();
  const canonical = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12)}`;
  return Option.some(Orcid.make(canonical));
}
