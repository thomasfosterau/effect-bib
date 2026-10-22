/**
 * First-class bibliographic identifiers — ISBN, DOI, ISSN, ORCID, PubMed
 * (PMID / PMCID) and arXiv — as branded, validated types.
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
 *   ISBN-13 mod-10 / EAN, ISSN mod-11, ORCID ISO 7064 mod-11-2), and a
 *   strict syntax where it has none (PMID, PMCID, arXiv); and
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

// See website#1069.

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

/**
 * A proven PubMed identifier: its digits alone, no leading zero.
 *
 * @since 1.0.0
 */
export const Pmid = Schema.String.pipe(Schema.brand("Pmid"));
/**
 * @since 1.0.0
 */
export type Pmid = typeof Pmid.Type;

/**
 * A proven PubMed Central identifier in canonical `PMC1234567` form.
 *
 * @since 1.0.0
 */
export const Pmcid = Schema.String.pipe(Schema.brand("Pmcid"));
/**
 * @since 1.0.0
 */
export type Pmcid = typeof Pmcid.Type;

/**
 * A proven arXiv identifier, bare (no `arXiv:` prefix): a current-scheme
 * `2101.01234` or an old-scheme `hep-th/9901001`, with any `v2` version
 * suffix kept.
 *
 * @since 1.0.0
 */
export const Arxiv = Schema.String.pipe(Schema.brand("Arxiv"));
/**
 * @since 1.0.0
 */
export type Arxiv = typeof Arxiv.Type;

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
 * The two canonical forms of a proven {@link Isbn}, as {@link isbnForms}
 * returns them.
 *
 * @since 0.1.0
 */
export interface IsbnForms {
  /** The ISBN-13 form, always present. */
  readonly isbn13: string;
  /** The ISBN-10 form, or `null` when the ISBN-13 has none (a `979` prefix). */
  // oxlint-disable-next-line effect/prefer-option-over-null -- cross-slice: apps/api consumes `isbn10` as a plain nullable
  readonly isbn10: string | null;
}

/**
 * Both canonical forms of a proven {@link Isbn}: the 13-form always, the
 * 10-form when it exists. `isbn10` is `null`, not an `Option`, by contract
 * (a stable shape existing consumers rely on).
 *
 * @since 0.1.0
 */
export function isbnForms(isbn: Isbn): IsbnForms {
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

// ── PubMed ────────────────────────────────────────────────────────────

/**
 * Lenient PMID decoder: strips a `PMID:` prefix and returns the digits as a
 * branded {@link Pmid}, or `Option.none()`. A PMID has no check digit, so
 * the syntax (one to nine digits, no leading zero) is the whole test.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { decodePmid } from "@thomasfosterau/biblio"
 *
 * assert.strictEqual(Option.getOrNull(decodePmid("PMID: 15371539")), "15371539")
 * assert.strictEqual(Option.isNone(decodePmid("PMC3159421")), true)
 * ```
 *
 * @since 1.0.0
 */
export function decodePmid(raw: string): Option.Option<Pmid> {
  const bare = raw.trim().replace(/^pmid:?\s*/i, "");
  return /^[1-9]\d{0,8}$/.test(bare) ? Option.some(Pmid.make(bare)) : Option.none();
}

/**
 * Lenient PMCID decoder: accepts `PMC` followed by digits, in any case and
 * with a `PMCID:` prefix, and returns the canonical `PMC1234567` branded
 * {@link Pmcid}, or `Option.none()`. Bare digits are refused: they read as
 * a PMID.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { decodePmcid } from "@thomasfosterau/biblio"
 *
 * assert.strictEqual(Option.getOrNull(decodePmcid("pmc3159421")), "PMC3159421")
 * ```
 *
 * @since 1.0.0
 */
export function decodePmcid(raw: string): Option.Option<Pmcid> {
  const match = /^PMC(\d{1,9})$/i.exec(raw.trim().replace(/^pmcid:?\s*/i, ""));
  return match === null ? Option.none() : Option.some(Pmcid.make(`PMC${match[1]}`));
}

// ── arXiv ─────────────────────────────────────────────────────────────

/** A current-scheme arXiv id (`YYMM.NNNN` to April 2014, `YYMM.NNNNN` since), with an optional version. */
const ARXIV_CURRENT = /^(\d{2})(0[1-9]|1[0-2])\.\d{4,5}(?:v[1-9]\d{0,2})?$/;

/** An old-scheme arXiv id (`archive[.SC]/YYMMNNN`, before April 2007), with an optional version. */
const ARXIV_OLD =
  /^[a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?\/\d{2}(?:0[1-9]|1[0-2])\d{3}(?:v[1-9]\d{0,2})?$/;

/**
 * Lenient arXiv decoder: strips an `arXiv:` prefix or an
 * `https://arxiv.org/abs/` (or `/pdf/`) URL and returns the bare id as a
 * branded {@link Arxiv} when it matches the current (`2101.01234v2`) or the
 * old (`hep-th/9901001`) scheme, or `Option.none()`. The id is exclusively
 * letters, digits, `.`, `-` and one `/`, so it is safe in a URL path.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { decodeArxiv } from "@thomasfosterau/biblio"
 *
 * assert.strictEqual(Option.getOrNull(decodeArxiv("arXiv:2101.01234v2")), "2101.01234v2")
 * assert.strictEqual(Option.getOrNull(decodeArxiv("https://arxiv.org/abs/hep-th/9901001")), "hep-th/9901001")
 * ```
 *
 * @since 1.0.0
 */
export function decodeArxiv(raw: string): Option.Option<Arxiv> {
  const bare = raw
    .trim()
    .replace(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/^arxiv:\s*/i, "")
    .replace(/\.pdf$/i, "");
  return ARXIV_CURRENT.test(bare) || ARXIV_OLD.test(bare)
    ? Option.some(Arxiv.make(bare))
    : Option.none();
}
