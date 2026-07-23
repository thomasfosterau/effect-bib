/**
 * Unit tests for the branded, checksum-validated identifier layer
 * (`src/identifiers.ts`).
 *
 * Covers each checksum (ISBN-10 mod-11, ISBN-13 mod-10/EAN, ISSN mod-11,
 * ORCID ISO 7064 mod-11-2), the ISBN 10↔13 conversions, the canonical
 * forms the decoders emit, and the SSRF / path-injection rejection every
 * identifier path relies on. Each checksum carries a **property test**: a
 * pool of freshly-generated valid values decode, and any single-digit
 * mutation of a valid value is rejected. No network, no database.
 *
 * @module tests/unit/biblio-identifiers
 */

import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import {
  convertIsbn10To13,
  convertIsbn13To10,
  decodeDoi,
  decodeIsbn,
  decodeIssn,
  decodeOrcid,
  isbnForms,
  isbnLength,
  normaliseDoi,
  normaliseIsbn,
} from "@thomasfosterau/biblio";

// ── Deterministic pseudo-random generator (dependency-free property tests) ─

/** A small deterministic PRNG so the property runs are reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const DIGITS = "0123456789";
const CHECK_CHARS = "0123456789X";

/** A random string of `n` decimal digits. */
function randomDigits(rng: () => number, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += DIGITS[Math.floor(rng() * 10)];
  return out;
}

/**
 * Finds the single check character (`0`–`9` or `X`) that makes `body`
 * decode under `decode`, or `null` if the scheme admits none for this body.
 * Lets a checksum be exercised without duplicating its algorithm here.
 */
function findValidCheck<T>(body: string, decode: (raw: string) => Option.Option<T>): string | null {
  for (const check of CHECK_CHARS) {
    if (Option.isSome(decode(body + check))) return check;
  }
  return null;
}

/** Mutates one character of `value` to a different digit (deterministically). */
function mutateDigit(rng: () => number, value: string): string {
  const positions = [...value].map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  const at = positions[Math.floor(rng() * positions.length)]!;
  const original = value[at]!;
  let replacement = original;
  while (replacement === original) replacement = DIGITS[Math.floor(rng() * 10)]!;
  return value.slice(0, at) + replacement + value.slice(at + 1);
}

// ── ISBN ──────────────────────────────────────────────────────────────

describe("decodeIsbn", () => {
  it("accepts a hyphenated ISBN-13 and canonicalises to the 13-digit form", () => {
    const isbn = decodeIsbn("978-0-14-044913-6");
    expect(Option.isSome(isbn)).toBe(true);
    expect(Option.getOrNull(isbn)).toBe("9780140449136");
  });

  it("accepts an ISBN-10 (X check digit) and converts it to the canonical 13-form", () => {
    const isbn = decodeIsbn("0-8044-2957-x");
    expect(Option.getOrNull(isbn)).toBe(convertIsbn10To13("080442957X"));
  });

  it("rejects a checksum-invalid ISBN-13 (the pre-B2 scanner would have accepted the syntax)", () => {
    // A syntactically well-formed 13-digit string with a wrong check digit.
    expect(normaliseIsbn("9780140449137")).toBe("9780140449137"); // syntax-only legacy accepts
    expect(Option.isNone(decodeIsbn("9780140449137"))).toBe(true); // checksum rejects
  });

  it.each([
    ["too short", "12345"],
    ["too long", "97801404491360"],
    ["letters in the body", "97801404A9136"],
    ["a path-traversal attempt", "../../etc/passwd"],
    ["a slash", "9780140/449136"],
    ["empty", ""],
  ])("rejects %s (SSRF guard)", (_label, value) => {
    expect(Option.isNone(decodeIsbn(value))).toBe(true);
  });

  it("property: freshly-generated valid ISBN-13s decode; any single-digit mutation fails", () => {
    const rng = makeRng(0x1b7);
    for (let n = 0; n < 200; n++) {
      const isbn13 = convertIsbn10To13(`${randomDigits(rng, 9)}0`);
      expect(Option.getOrNull(decodeIsbn(isbn13))).toBe(isbn13);
      expect(Option.isNone(decodeIsbn(mutateDigit(rng, isbn13)))).toBe(true);
    }
  });

  it("property: valid ISBN-10s decode to their 13-form; any single-digit mutation fails", () => {
    const rng = makeRng(0x2c8);
    for (let n = 0; n < 200; n++) {
      const isbn13 = convertIsbn10To13(`${randomDigits(rng, 9)}0`);
      const isbn10 = convertIsbn13To10(isbn13);
      expect(isbn10).not.toBeNull();
      expect(Option.getOrNull(decodeIsbn(isbn10!))).toBe(isbn13);
      // Mutating a body digit of the 10-form invalidates the mod-11 checksum.
      const mutated = mutateDigit(rng, isbn10!.slice(0, 9)) + isbn10!.slice(9);
      expect(Option.isNone(decodeIsbn(mutated))).toBe(true);
    }
  });
});

describe("ISBN 10 ↔ 13 conversion", () => {
  it("round-trips a 978-prefixed ISBN through both conversions", () => {
    expect(convertIsbn13To10("9780140449136")).toBe("0140449132");
    expect(convertIsbn10To13("0140449132")).toBe("9780140449136");
  });

  it("returns null converting a 979-prefixed ISBN-13 to a (nonexistent) ISBN-10", () => {
    const isbn13 = convertIsbn10To13(`${randomDigits(makeRng(9), 9)}0`).replace(/^978/, "979");
    expect(convertIsbn13To10(isbn13)).toBeNull();
  });

  it("isbnForms exposes both canonical forms of a proven ISBN", () => {
    const isbn = decodeIsbn("9780140449136");
    expect(Option.isSome(isbn)).toBe(true);
    expect(isbnForms(Option.getOrThrow(isbn))).toEqual({
      isbn13: "9780140449136",
      isbn10: "0140449132",
    });
  });
});

// ── DOI ───────────────────────────────────────────────────────────────

describe("decodeDoi / normaliseDoi", () => {
  it("lower-cases and keeps a well-formed DOI", () => {
    expect(normaliseDoi("10.1037/0003-066X.59.1.29")).toBe("10.1037/0003-066x.59.1.29");
    expect(Option.getOrNull(decodeDoi("10.1037/0003-066X.59.1.29"))).toBe(
      "10.1037/0003-066x.59.1.29",
    );
  });

  it("strips a doi.org resolver prefix and a doi: scheme", () => {
    expect(normaliseDoi("https://doi.org/10.1000/182")).toBe("10.1000/182");
    expect(normaliseDoi("doi:10.1000/182")).toBe("10.1000/182");
  });

  it.each([
    ["no 10. prefix", "11.1000/xyz"],
    ["no slash", "10.1000"],
    ["empty suffix", "10.1000/"],
    ["contains a space", "10.1000/ xyz"],
    ["a path-traversal attempt", "10.1000/../../secret"],
  ])("rejects %s", (_label, value) => {
    expect(normaliseDoi(value)).toBeNull();
    expect(Option.isNone(decodeDoi(value))).toBe(true);
  });

  it("rejects a DOI containing a control character", () => {
    const withControl = `10.1000/x${String.fromCharCode(0x07)}y`;
    expect(normaliseDoi(withControl)).toBeNull();
  });

  it("rejects an over-long DOI", () => {
    expect(normaliseDoi(`10.1000/${"a".repeat(300)}`)).toBeNull();
  });
});

// ── ISSN ──────────────────────────────────────────────────────────────

describe("decodeIssn", () => {
  it("accepts a bare or hyphenated ISSN and canonicalises to NNNN-NNNN", () => {
    expect(Option.getOrNull(decodeIssn("03785955"))).toBe("0378-5955");
    expect(Option.getOrNull(decodeIssn("0378-5955"))).toBe("0378-5955");
  });

  it("accepts an X check digit", () => {
    expect(Option.getOrNull(decodeIssn("2434-561X"))).toBe("2434-561X");
  });

  it("rejects a wrong check digit and a malformed value", () => {
    expect(Option.isNone(decodeIssn("0378-5954"))).toBe(true);
    expect(Option.isNone(decodeIssn("not-an-issn"))).toBe(true);
  });

  it("property: generated valid ISSNs decode; any single-digit mutation fails", () => {
    const rng = makeRng(0x3d9);
    let generated = 0;
    for (let n = 0; n < 300 && generated < 150; n++) {
      const body = randomDigits(rng, 7);
      const check = findValidCheck(body, decodeIssn);
      if (check === null) continue;
      generated++;
      const issn = body + check;
      expect(Option.isSome(decodeIssn(issn))).toBe(true);
      const mutated = mutateDigit(rng, body) + check;
      expect(Option.isNone(decodeIssn(mutated))).toBe(true);
    }
    expect(generated).toBeGreaterThan(0);
  });
});

// ── ORCID ─────────────────────────────────────────────────────────────

describe("decodeOrcid", () => {
  it("accepts the canonical ORCID example and strips a resolver URL", () => {
    expect(Option.getOrNull(decodeOrcid("0000-0002-1825-0097"))).toBe("0000-0002-1825-0097");
    expect(Option.getOrNull(decodeOrcid("https://orcid.org/0000-0002-1825-0097"))).toBe(
      "0000-0002-1825-0097",
    );
  });

  it("rejects a wrong check digit and a malformed value", () => {
    expect(Option.isNone(decodeOrcid("0000-0002-1825-0098"))).toBe(true);
    expect(Option.isNone(decodeOrcid("nope"))).toBe(true);
  });

  it("property: generated valid ORCIDs decode; any single-digit mutation fails", () => {
    const rng = makeRng(0x4ea);
    let generated = 0;
    for (let n = 0; n < 400 && generated < 150; n++) {
      const body = randomDigits(rng, 15);
      const check = findValidCheck(body, decodeOrcid);
      if (check === null) continue;
      generated++;
      const orcid = body + check;
      expect(Option.isSome(decodeOrcid(orcid))).toBe(true);
      const mutated = mutateDigit(rng, body) + check;
      expect(Option.isNone(decodeOrcid(mutated))).toBe(true);
    }
    expect(generated).toBeGreaterThan(0);
  });
});

// ── Legacy syntax-only helpers (retained for the B4 shim) ─────────────

describe("legacy normaliseIsbn / isbnLength", () => {
  it("normaliseIsbn strips punctuation without validating the checksum", () => {
    expect(normaliseIsbn("978-0-14-044913-6")).toBe("9780140449136");
    expect(normaliseIsbn("080442957x")).toBe("080442957X");
    expect(normaliseIsbn("../../etc/passwd")).toBeNull();
  });

  it("isbnLength classifies the cleaned form", () => {
    expect(isbnLength("9780140449136")).toBe(13);
    expect(isbnLength("080442957X")).toBe(10);
  });
});
