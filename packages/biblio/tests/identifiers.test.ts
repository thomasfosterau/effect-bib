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

import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";
import {
  convertIsbn10To13,
  convertIsbn13To10,
  decodeDoi,
  decodeIsbn,
  decodeIssn,
  decodeOrcid,
  isbnForms,
  normaliseDoi,
} from "@thomasfosterau/biblio";
import { expectPresent, expectSome } from "./assert.ts";

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
  return Array.makeBy(n, () => DIGITS[Math.floor(rng() * 10)]).join("");
}

/**
 * Finds the single check character (`0`–`9` or `X`) that makes `body`
 * decode under `decode`, or `None` if the scheme admits none for this body.
 * Lets a checksum be exercised without duplicating its algorithm here.
 */
function findValidCheck<T>(
  body: string,
  decode: (raw: string) => Option.Option<T>,
): Option.Option<string> {
  return Array.findFirst(CHECK_CHARS.split(""), (check) => Option.isSome(decode(body + check)));
}

/** Mutates one character of `value` to a different digit (deterministically). */
function mutateDigit(rng: () => number, value: string): string {
  const positions = Array.filterMap(value.split(""), (c, i): Result.Result<number, void> =>
    /\d/.test(c) ? Result.succeed(i) : Result.failVoid,
  );
  const at = expectPresent(positions[Math.floor(rng() * positions.length)], "a digit position");
  const original = Number(expectPresent(value[at], "a digit"));
  // One draw, rotated forward on a collision, so the digit always changes.
  const drawn = Math.floor(rng() * 10);
  const replacement = String(drawn === original ? (drawn + 1) % 10 : drawn);
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

  it("rejects a checksum-invalid ISBN-13 (a syntactically well-formed 13-digit string)", () => {
    // A syntactically well-formed 13-digit string with a wrong check digit.
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
    Array.forEach(Array.range(1, 200), () => {
      const isbn13 = convertIsbn10To13(`${randomDigits(rng, 9)}0`);
      expect(Option.getOrNull(decodeIsbn(isbn13))).toBe(isbn13);
      expect(Option.isNone(decodeIsbn(mutateDigit(rng, isbn13)))).toBe(true);
    });
  });

  it("property: valid ISBN-10s decode to their 13-form; any single-digit mutation fails", () => {
    const rng = makeRng(0x2c8);
    Array.forEach(Array.range(1, 200), () => {
      const isbn13 = convertIsbn10To13(`${randomDigits(rng, 9)}0`);
      const isbn10 = expectSome(convertIsbn13To10(isbn13), "an ISBN-10 form");
      expect(Option.getOrNull(decodeIsbn(isbn10))).toBe(isbn13);
      // Mutating a body digit of the 10-form invalidates the mod-11 checksum.
      const mutated = mutateDigit(rng, isbn10.slice(0, 9)) + isbn10.slice(9);
      expect(Option.isNone(decodeIsbn(mutated))).toBe(true);
    });
  });
});

describe("ISBN 10 ↔ 13 conversion", () => {
  it("round-trips a 978-prefixed ISBN through both conversions", () => {
    expect(convertIsbn13To10("9780140449136")).toStrictEqual(Option.some("0140449132"));
    expect(convertIsbn10To13("0140449132")).toBe("9780140449136");
  });

  it("returns None converting a 979-prefixed ISBN-13 to a (nonexistent) ISBN-10", () => {
    const isbn13 = convertIsbn10To13(`${randomDigits(makeRng(9), 9)}0`).replace(/^978/, "979");
    expect(convertIsbn13To10(isbn13)).toStrictEqual(Option.none());
  });

  it("isbnForms exposes both canonical forms of a proven ISBN", () => {
    const isbn = decodeIsbn("9780140449136");
    expect(isbnForms(expectSome(isbn, "an ISBN"))).toEqual({
      isbn13: "9780140449136",
      isbn10: "0140449132",
    });
  });
});

// ── DOI ───────────────────────────────────────────────────────────────

describe("decodeDoi / normaliseDoi", () => {
  it("lower-cases and keeps a well-formed DOI", () => {
    expect(normaliseDoi("10.1037/0003-066X.59.1.29")).toStrictEqual(
      Option.some("10.1037/0003-066x.59.1.29"),
    );
    expect(Option.getOrNull(decodeDoi("10.1037/0003-066X.59.1.29"))).toBe(
      "10.1037/0003-066x.59.1.29",
    );
  });

  it("strips a doi.org resolver prefix and a doi: scheme", () => {
    expect(normaliseDoi("https://doi.org/10.1000/182")).toStrictEqual(Option.some("10.1000/182"));
    expect(normaliseDoi("doi:10.1000/182")).toStrictEqual(Option.some("10.1000/182"));
  });

  it.each([
    ["no 10. prefix", "11.1000/xyz"],
    ["no slash", "10.1000"],
    ["empty suffix", "10.1000/"],
    ["contains a space", "10.1000/ xyz"],
    ["a path-traversal attempt", "10.1000/../../secret"],
  ])("rejects %s", (_label, value) => {
    expect(normaliseDoi(value)).toStrictEqual(Option.none());
    expect(Option.isNone(decodeDoi(value))).toBe(true);
  });

  it("rejects a DOI containing a control character", () => {
    const withControl = `10.1000/x${String.fromCharCode(0x07)}y`;
    expect(normaliseDoi(withControl)).toStrictEqual(Option.none());
  });

  it("rejects an over-long DOI", () => {
    expect(normaliseDoi(`10.1000/${"a".repeat(300)}`)).toStrictEqual(Option.none());
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
    const generated = Array.reduce(Array.range(1, 300), 0, (count) => {
      if (count >= 150) return count;
      const body = randomDigits(rng, 7);
      const check = findValidCheck(body, decodeIssn);
      if (Option.isNone(check)) return count;
      expect(Option.isSome(decodeIssn(body + check.value))).toBe(true);
      expect(Option.isNone(decodeIssn(mutateDigit(rng, body) + check.value))).toBe(true);
      return count + 1;
    });
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
    const generated = Array.reduce(Array.range(1, 400), 0, (count) => {
      if (count >= 150) return count;
      const body = randomDigits(rng, 15);
      const check = findValidCheck(body, decodeOrcid);
      if (Option.isNone(check)) return count;
      expect(Option.isSome(decodeOrcid(body + check.value))).toBe(true);
      expect(Option.isNone(decodeOrcid(mutateDigit(rng, body) + check.value))).toBe(true);
      return count + 1;
    });
    expect(generated).toBeGreaterThan(0);
  });
});
