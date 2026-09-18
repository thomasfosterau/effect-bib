/**
 * Unit tests for the CSL-aligned record core (`src/record.ts`).
 *
 * Covers the surviving untrusted-text / year sanitisers, the CSL name /
 * date construction helpers, and the `toCslJson` / `fromCslJson` interop
 * (including the "typed superset" round-trip invariant). Identifier
 * checksums live in `identifiers.test.ts`. No network, no database.
 *
 * @module tests/unit/biblio-record
 */

import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import {
  cslNameDisplay,
  dateFromYear,
  decodeDoi,
  decodeIssn,
  fromCslJson,
  isCslItemType,
  makeCslName,
  MAX_TEXT_FIELD_LENGTH,
  parsePersonName,
  sanitiseText,
  sanitiseYear,
  toCslJson,
  yearOf,
  type BiblioRecord,
} from "@thomasfosterau/biblio";
import { expectSome } from "./assert.ts";

const doiOf = (raw: string) => expectSome(decodeDoi(raw), "a DOI");
const issnOf = (raw: string) => expectSome(decodeIssn(raw), "an ISSN");

// ── Surviving sanitisers ──────────────────────────────────────────────

describe("sanitiseText", () => {
  it("trims and collapses internal whitespace", () => {
    expect(sanitiseText("  hello   world \n")).toStrictEqual(Option.some("hello world"));
  });

  it("returns None for whitespace-only or non-string input", () => {
    expect(sanitiseText("   ")).toStrictEqual(Option.none());
    expect(sanitiseText(undefined)).toStrictEqual(Option.none());
    expect(sanitiseText(42)).toStrictEqual(Option.none());
  });

  it("clamps an over-long value to the max field length", () => {
    const result = expectSome(sanitiseText("x".repeat(MAX_TEXT_FIELD_LENGTH + 500)));
    expect(result.length).toBe(MAX_TEXT_FIELD_LENGTH);
  });
});

describe("sanitiseYear", () => {
  it("accepts a plausible integer year as a number or string", () => {
    expect(sanitiseYear(2003)).toStrictEqual(Option.some(2003));
    expect(sanitiseYear("1998")).toStrictEqual(Option.some(1998));
  });

  it.each([
    ["a non-integer", 2003.5],
    ["a year past the upper bound", 3000],
    ["a year below the lower bound", 0],
    ["non-numeric text", "not a year"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(sanitiseYear(value)).toStrictEqual(Option.none());
  });
});

// ── CSL name / date helpers ───────────────────────────────────────────

describe("parsePersonName", () => {
  it("splits a 'Family, Given' form", () => {
    expect(parsePersonName("Harari, Yuval Noah")).toEqual({
      family: "Harari",
      given: "Yuval Noah",
    });
  });

  it("splits a 'Given Family' form on the last token", () => {
    expect(parsePersonName("John Ronald Reuel Tolkien")).toEqual({
      family: "Tolkien",
      given: "John Ronald Reuel",
    });
  });

  it("treats a single token as a bare family name", () => {
    expect(parsePersonName("Aristotle")).toEqual({ family: "Aristotle" });
  });

  it("returns null for an empty name", () => {
    expect(parsePersonName("   ")).toBeNull();
  });
});

describe("makeCslName", () => {
  it("keeps a checksum-valid ORCID and drops empty parts", () => {
    expect(makeCslName({ family: "Curie", orcid: "0000-0002-1825-0097" })).toEqual({
      family: "Curie",
      orcid: "0000-0002-1825-0097",
    });
  });

  it("drops an invalid ORCID but keeps the name", () => {
    expect(makeCslName({ family: "Curie", orcid: "bogus" })).toEqual({ family: "Curie" });
  });

  it("returns null when nothing usable remains", () => {
    expect(makeCslName({})).toBeNull();
    expect(makeCslName({ family: "  " })).toBeNull();
  });
});

describe("cslNameDisplay", () => {
  it("prefers a literal, then 'Given Family', then family, then given", () => {
    expect(cslNameDisplay({ literal: "World Bank" })).toBe("World Bank");
    expect(cslNameDisplay({ family: "Harari", given: "Yuval" })).toBe("Yuval Harari");
    expect(cslNameDisplay({ family: "Plato" })).toBe("Plato");
    expect(cslNameDisplay({ given: "Cher" })).toBe("Cher");
    expect(cslNameDisplay({})).toBeNull();
  });
});

describe("yearOf / dateFromYear / isCslItemType", () => {
  it("extracts the year from a date-parts date", () => {
    expect(yearOf(dateFromYear(1962))).toBe(1962);
  });

  it("returns null for a missing or partless date", () => {
    expect(yearOf(undefined)).toBeNull();
    expect(yearOf({ literal: "in press" })).toBeNull();
  });

  it("narrows known CSL item types", () => {
    expect(isCslItemType("article-journal")).toBe(true);
    expect(isCslItemType("not-a-type")).toBe(false);
  });
});

// ── CSL-JSON interop ──────────────────────────────────────────────────

describe("toCslJson / fromCslJson", () => {
  const record: BiblioRecord = {
    type: "article-journal",
    title: "The Structure of Scientific Revolutions",
    "container-title": "Journal of Science",
    volume: "59",
    issue: "1",
    page: "29-40",
    author: [{ family: "Kuhn", given: "Thomas" }],
    issued: dateFromYear(1962),
    identifiers: {
      doi: doiOf("10.1037/0003-066X.59.1.29"),
      issn: issnOf("0378-5955"),
    },
    provenance: { source: "bibtex" },
  };

  it("projects a record to schema-valid CSL-JSON, dropping provenance", () => {
    const csl = toCslJson(record);
    expect(csl.provenance).toBeUndefined();
    expect(csl.type).toBe("article-journal");
    expect(csl.DOI).toBe("10.1037/0003-066x.59.1.29");
    expect(csl.ISSN).toBe("0378-5955");
    expect(csl["container-title"]).toBe("Journal of Science");
    expect(csl.issued).toEqual({ "date-parts": [[1962]] });
  });

  it("round-trips the CSL core and re-validates identifiers (typed-superset invariant)", () => {
    const back = fromCslJson(toCslJson(record));
    expect(back.title).toBe(record.title);
    expect(back.identifiers.doi).toBe(record.identifiers.doi);
    expect(back.identifiers.issn).toBe(record.identifiers.issn);
    expect(back.author).toEqual(record.author);
    expect(back.issued).toEqual(record.issued);
    // fromCslJson stamps its own provenance — the envelope is not CSL.
    expect(back.provenance.source).toBe("csl-json");
  });

  it("preserves unknown CSL keys through a round-trip (lossless forward-compat)", () => {
    const external = {
      type: "book",
      title: "Sapiens",
      ISBN: "9780062316097",
      author: [{ family: "Harari", given: "Yuval Noah" }],
      "custom-x": "keepme",
    };
    const decoded = fromCslJson(external);
    expect(decoded.extra?.["custom-x"]).toBe("keepme");
    expect(decoded.identifiers.isbn).toBe("9780062316097");
    const reencoded = toCslJson(decoded);
    expect(reencoded.title).toBe("Sapiens");
    expect(reencoded.ISBN).toBe("9780062316097");
    expect(reencoded["custom-x"]).toBe("keepme");
  });

  it("coerces a numeric CSL string variable (e.g. volume)", () => {
    expect(
      fromCslJson({ type: "article-journal", title: "t", DOI: "10.1000/x", volume: 12 }).volume,
    ).toBe("12");
  });

  it("drops a checksum-invalid identifier rather than the record", () => {
    const record = fromCslJson({ type: "book", title: "t", ISBN: "9780140449137" });
    expect(record.identifiers.isbn).toBeUndefined();
    expect(record.title).toBe("t");
  });

  it("decodes a non-object item to a thin document record, never throwing", () => {
    expect(fromCslJson(42).type).toBe("document");
    expect(fromCslJson(null).identifiers).toEqual({});
  });

  it("falls back to the document type for an unknown CSL type", () => {
    expect(fromCslJson({ type: "holo-novel", title: "t", DOI: "10.1000/x" }).type).toBe("document");
  });
});
