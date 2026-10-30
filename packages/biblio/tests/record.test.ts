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

import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  BiblioRecord as BiblioRecordSchema,
  cslNameDisplay,
  dateFromYear,
  endYearOf,
  decodeDoi,
  decodeIssn,
  fromCslJson,
  isCslItemType,
  makeCslName,
  MAX_AUTHORS,
  MAX_TEXT_FIELD_LENGTH,
  parsePersonName,
  readCslNameArray,
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

  it("reads a range's start year, a raw date's year, and ignores a season", () => {
    expect(yearOf({ "date-parts": [[2001, 5], [2003]] })).toBe(2001);
    expect(yearOf({ raw: "Spring 2004" })).toBe(2004);
    expect(yearOf({ raw: "no year" })).toBeNull();
    expect(yearOf({ "date-parts": [[2010, 21]], season: "Spring" })).toBe(2010);
    expect(yearOf({ "date-parts": [[9999]], raw: "2001" })).toBeNull();
  });

  it("reads a range's end year only when it differs from its start", () => {
    expect(endYearOf({ "date-parts": [[2001], [2003]] })).toStrictEqual(Option.some(2003));
    expect(
      endYearOf({
        "date-parts": [
          [2001, 5],
          [2001, 6],
        ],
      }),
    ).toStrictEqual(Option.none());
    expect(endYearOf(dateFromYear(2001))).toStrictEqual(Option.none());
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
    const decoded = fromCslJson({ type: "book", title: "t", ISBN: "9780140449137" });
    expect(decoded.identifiers.isbn).toBeUndefined();
    expect(decoded.title).toBe("t");
  });

  it("decodes a non-object item to a thin document record, never throwing", () => {
    expect(fromCslJson(42).type).toBe("document");
    expect(fromCslJson(null).identifiers).toEqual({});
  });

  it("drops a non-array date-parts entry and keeps the usable ones", () => {
    const decoded = fromCslJson({
      type: "book",
      title: "t",
      issued: { "date-parts": [2015, [2016, 3]] },
    });
    expect(decoded.issued).toEqual({ "date-parts": [[2016, 3]] });
  });

  it("falls back to the document type for an unknown CSL type", () => {
    expect(fromCslJson({ type: "holo-novel", title: "t", DOI: "10.1000/x" }).type).toBe("document");
  });
});

describe("the full CSL 1.0.2 variable set", () => {
  const item = {
    id: "doe2020",
    "citation-key": "doe2020",
    categories: ["one", " ", 3, "two"],
    type: "motion_picture",
    title: "A <i>Film</i>",
    "title-short": "Film",
    genre: "Documentary",
    medium: "DVD",
    "number-of-pages": 120,
    archive: "BFI",
    archive_location: "Box 3",
    "call-number": "PN1997",
    jurisdiction: "UK",
    "volume-title": "Part One",
    director: [{ family: "Doe", given: "Jane" }],
    "executive-producer": [{ literal: "Studio" }],
    "series-creator": [{ family: "Roe" }],
    "available-date": { "date-parts": [[2021, 2, 3]] },
    PMID: "15371539",
    PMCID: "PMC3159421",
    number: "arXiv:2101.01234",
    "year-suffix": "a",
    custom: { mine: true },
  };

  it("types every standard, name and date variable, the id and the categories", () => {
    const record = fromCslJson(item);
    expect(record).toMatchObject({
      id: "doe2020",
      "citation-key": "doe2020",
      categories: ["one", "two"],
      type: "motion_picture",
      title: "A <i>Film</i>",
      "title-short": "Film",
      genre: "Documentary",
      medium: "DVD",
      "number-of-pages": "120",
      archive: "BFI",
      archive_location: "Box 3",
      "call-number": "PN1997",
      jurisdiction: "UK",
      "volume-title": "Part One",
      director: [{ family: "Doe", given: "Jane" }],
      "executive-producer": [{ literal: "Studio" }],
      "series-creator": [{ family: "Roe" }],
      "available-date": { "date-parts": [[2021, 2, 3]] },
      identifiers: { pmid: "15371539", pmcid: "PMC3159421", arxiv: "2101.01234" },
    });
    // The citation-time variables and CSL's `custom` object stay passthrough.
    expect(record.extra).toEqual({ "year-suffix": "a", custom: { mine: true } });
    expect(Schema.is(BiblioRecordSchema)(record)).toBe(true);
  });

  it("round-trips the whole item through toCslJson", () => {
    const csl = toCslJson(fromCslJson(item));
    expect(csl).toEqual({
      ...item,
      categories: ["one", "two"],
      "number-of-pages": "120",
    });
    expect(fromCslJson(csl)).toEqual(fromCslJson(item));
  });

  it("keeps a numeric id as a number", () => {
    expect(fromCslJson({ id: 7, type: "book" }).id).toBe(7);
    expect(toCslJson(fromCslJson({ id: 7, type: "book" })).id).toBe(7);
    expect(fromCslJson({ id: { nested: 1 }, type: "book" }).id).toBeUndefined();
  });

  it("reads the legacy aliases into their variable, and keeps an alias the variable outranks", () => {
    const aliased = fromCslJson({
      type: "speech",
      event: "Conf",
      journalAbbreviation: "J.",
      shortTitle: "S",
    });
    expect(aliased).toMatchObject({
      "event-title": "Conf",
      "container-title-short": "J.",
      "title-short": "S",
    });
    expect(aliased.extra).toBeUndefined();
    const both = fromCslJson({ type: "speech", event: "Old", "event-title": "New" });
    expect(both["event-title"]).toBe("New");
    expect(both.extra).toEqual({ event: "Old" });
  });

  it("writes an arXiv id back as the number only when the record has none", () => {
    const fromUrl = fromCslJson({ type: "article", URL: "https://arxiv.org/abs/hep-th/9901001" });
    expect(fromUrl.identifiers.arxiv).toBe("hep-th/9901001");
    expect(toCslJson(fromUrl).number).toBe("arXiv:hep-th/9901001");
    const numbered = fromCslJson({
      type: "report",
      number: "TR-7",
      URL: "https://arxiv.org/abs/2101.01234",
    });
    expect(toCslJson(numbered).number).toBe("TR-7");
    expect(fromCslJson({ type: "report", number: "2101.01234" }).identifiers.arxiv).toBeUndefined();
  });

  it("lifts a record that kept CSL variables in extra into their slots", () => {
    // A record whose `extra` carries variables an earlier version did not type.
    const old: BiblioRecord = {
      type: "thesis",
      title: "T",
      identifiers: {},
      provenance: { source: "bibtex" },
      extra: { genre: "PhD thesis", PMID: "15371539", "tex.custom": "x" },
    };
    expect(fromCslJson(toCslJson(old))).toMatchObject({
      genre: "PhD thesis",
      identifiers: { pmid: "15371539" },
      extra: { "tex.custom": "x" },
    });
  });

  it("drops an invalid PubMed id, and accepts a numeric PMID", () => {
    expect(fromCslJson({ type: "book", PMID: "PMC1", PMCID: "1" }).identifiers).toEqual({});
    expect(fromCslJson({ type: "book", PMID: 15371539 }).identifiers).toEqual({ pmid: "15371539" });
  });

  it("raises the field-length and name-list bounds on request", () => {
    const abstract = "a".repeat(MAX_TEXT_FIELD_LENGTH + 10);
    const author = Array.makeBy(MAX_AUTHORS + 10, (i) => ({ family: `F${i}` }));
    const clamped = fromCslJson({ type: "book", abstract, author });
    expect(clamped.abstract).toHaveLength(MAX_TEXT_FIELD_LENGTH);
    expect(clamped.author).toHaveLength(MAX_AUTHORS);
    const raised = fromCslJson(
      { type: "book", abstract, author },
      { maxFieldLength: 5000, maxAuthors: 500 },
    );
    expect(raised.abstract).toBe(abstract);
    expect(raised.author).toHaveLength(MAX_AUTHORS + 10);
    expect(readCslNameArray(author, 3)).toHaveLength(3);
    expect(sanitiseText("abcdef", 3)).toStrictEqual(Option.some("abc"));
    expect(sanitiseText("abcdef", 0)).toStrictEqual(Option.some("abcdef"));
  });

  it("still decodes a record persisted before 1.0.0", () => {
    const persisted = {
      type: "book",
      title: "Sapiens",
      identifiers: { isbn: "9780062316097" },
      provenance: { source: "openlibrary", retrievedAt: "2025-01-01T00:00:00Z" },
      extra: { subject: ["History"], "title-short": "Sapiens" },
    };
    expect(Schema.decodeUnknownSync(BiblioRecordSchema)(persisted)).toEqual(persisted);
  });
});
