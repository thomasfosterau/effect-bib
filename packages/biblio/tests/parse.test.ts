/**
 * Unit tests for the bibliographic file-format parsers (`src/parse.ts`).
 *
 * Drives representative BibTeX / CSL-JSON / CSV / RIS content through the
 * parsers and asserts the CSL-aligned {@link BiblioRecord} mapping, the
 * per-record fail-soft skip outcomes, the checksum-validated identifier
 * gate, and the untrusted-data clamps / resource bounds. The
 * **format-independence proof** — a BibTeX and an RIS fixture of the same
 * works project to equal CSL-JSON — pins that the record is genuinely
 * format-neutral. No network, no database.
 *
 * @module tests/unit/biblio-parse
 */

import * as Array from "effect/Array";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  MAX_AUTHORS,
  MAX_INPUT_LENGTH,
  MAX_RECORDS,
  parseBibliographicFile,
  parseBibtex,
  parseCsv,
  parseRis,
  parseZoteroJson,
  toCslJson,
  type ParseOutcome,
  yearOf,
} from "@thomasfosterau/biblio";

/** Encodes a fixture value to the JSON text a parser receives. */
const toJsonText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Narrows a `ParseOutcome` to its parsed record, failing the test otherwise. */
function expectParsed(outcome: ParseOutcome) {
  if (outcome.outcome !== "parsed") {
    expect.fail(`expected a parsed outcome, got skipped (${outcome.reason})`);
  }
  return outcome.record;
}

// ── BibTeX ────────────────────────────────────────────────────────────

describe("parseBibtex", () => {
  it("maps a book entry with an ISBN to a CSL book record with structured names", () => {
    const outcomes = parseBibtex(`
      @book{harari2015,
        title = {Sapiens},
        subtitle = {A Brief History of Humankind},
        author = {Harari, Yuval Noah},
        year = {2015},
        publisher = {Harper},
        isbn = {978-0-06-231609-7},
      }
    `);
    expect(outcomes).toHaveLength(1);
    const record = expectParsed(outcomes[0]);
    expect(record).toMatchObject({
      type: "book",
      title: "Sapiens: A Brief History of Humankind",
      publisher: "Harper",
      author: [{ family: "Harari", given: "Yuval Noah" }],
      issued: { "date-parts": [[2015]] },
    });
    expect(record.identifiers.isbn).toBe("9780062316097");
    expect(record.provenance.source).toBe("bibtex");
  });

  it("maps a DOI-bearing @article to an article-journal record", () => {
    const record = expectParsed(
      parseBibtex(`
        @article{kuhn,
          title = {The Structure of Scientific Revolutions},
          author = {Kuhn, Thomas},
          journal = {Journal of Science},
          volume = {59},
          number = {1},
          pages = {29-40},
          doi = {10.1037/0003-066X.59.1.29},
        }`)[0],
    );
    expect(record.type).toBe("article-journal");
    expect(record.identifiers.doi).toBe("10.1037/0003-066x.59.1.29");
    expect(record["container-title"]).toBe("Journal of Science");
    expect(record.volume).toBe("59");
    expect(record.issue).toBe("1");
    expect(record.page).toBe("29-40");
  });

  it("splits multiple `and`-separated authors into structured names", () => {
    const record = expectParsed(
      parseBibtex(
        `@book{x, title={t}, isbn={9780062316097}, author={Doe, Jane and John Smith}}`,
      )[0],
    );
    expect(record.author).toEqual([
      { family: "Doe", given: "Jane" },
      { family: "Smith", given: "John" },
    ]);
  });

  it("rejects a checksum-invalid ISBN as no-identifier (B2 checksum gate)", () => {
    expect(parseBibtex(`@book{x, title={t}, isbn={9780140449137}}`)[0]).toMatchObject({
      outcome: "skipped",
      reason: "no-identifier",
    });
  });

  it("skips entries with no identifier / no title", () => {
    expect(parseBibtex(`@book{x, title={Untracked}, author={Nobody}}`)[0]).toMatchObject({
      outcome: "skipped",
      reason: "no-identifier",
    });
    expect(parseBibtex(`@book{x, isbn={9780062316097}}`)[0]).toMatchObject({
      outcome: "skipped",
      reason: "no-title",
    });
  });

  it("maps a @techreport / @phdthesis / @misc to their CSL item types", () => {
    const report = expectParsed(parseBibtex(`@techreport{r, title={R}, doi={10.1000/x}}`)[0]);
    expect(report.type).toBe("report");
    const thesis = expectParsed(parseBibtex(`@phdthesis{t, title={T}, doi={10.1000/y}}`)[0]);
    expect(thesis.type).toBe("thesis");
    const misc = expectParsed(parseBibtex(`@misc{m, title={M}, doi={10.1000/z}}`)[0]);
    expect(misc.type).toBe("document");
  });

  it("ignores @comment / @string / @preamble blocks", () => {
    const outcomes = parseBibtex(`
      @comment{ this is a note }
      @string{ pub = "Harper" }
      @book{x, title={Real}, isbn={9780062316097}}
    `);
    expect(outcomes).toHaveLength(1);
    expect(expectParsed(outcomes[0]).title).toBe("Real");
  });

  it("balances braces so a nested-brace title does not terminate the entry early", () => {
    const record = expectParsed(
      parseBibtex(`@book{x, title={A {Nested} Title}, isbn={9780062316097}}`)[0],
    );
    // The grouping braces are decoded away once the entry is read.
    expect(record.title).toBe("A Nested Title");
  });

  it("stops at an unbalanced / truncated tail without throwing", () => {
    expect(() => parseBibtex(`@book{x, title={Truncated`)).not.toThrow();
    expect(parseBibtex(`@book{x, title={Truncated`)).toEqual([]);
  });

  it("keeps parsing past a `}` the citation key left without an opener", () => {
    // The key swallows the `{`, so the title's `}` has no opener; the field
    // still parses, and the stray brace is decoded away like any other.
    const record = expectParsed(parseBibtex(`@book{{x, title=Stray}, isbn={9780062316097}}`)[0]);
    expect(record.title).toBe("Stray");
  });

  it("scans a non-entry block's body as text, so an entry inside it is found", () => {
    const outcomes = parseBibtex(`@comment{ @book{x, title={Inner}, isbn={9780062316097}} }`);
    expect(outcomes).toHaveLength(1);
    expect(expectParsed(outcomes[0]).title).toBe("Inner");
  });

  it("treats nesting deeper than the grammar's cap like an unbalanced tail", () => {
    const nested = (depth: number) =>
      `@book{x, title={${"{".repeat(depth - 2)}T${"}".repeat(depth - 2)}}, isbn={9780062316097}}`;
    expect(expectParsed(parseBibtex(nested(32))[0]).title).toBe("T");
    expect(parseBibtex(nested(33))).toEqual([]);
  });

  it("never throws on hostile nesting, however deep", () => {
    // A recursive brace grammar overflows the stack at a few thousand levels.
    const deep = `@book{x, title=${"{".repeat(100_000)}${"}".repeat(100_000)}}`;
    expect(() => parseBibtex(deep)).not.toThrow();
    expect(parseBibtex(deep)).toEqual([]);
  });

  it("clamps the author list to MAX_AUTHORS", () => {
    const many = Array.makeBy(MAX_AUTHORS + 10, (i) => `Given${i} Family${i}`).join(" and ");
    const record = expectParsed(
      parseBibtex(`@book{x, title={t}, isbn={9780062316097}, author={${many}}}`)[0],
    );
    expect(record.author).toHaveLength(MAX_AUTHORS);
  });
});

// ── Zotero / CSL-JSON ─────────────────────────────────────────────────

describe("parseZoteroJson", () => {
  it("maps a top-level array of CSL items", () => {
    const outcomes = parseZoteroJson(
      toJsonText([
        {
          type: "book",
          title: "Sapiens",
          author: [{ given: "Yuval Noah", family: "Harari" }],
          ISBN: "9780062316097",
          issued: { "date-parts": [[2015]] },
          publisher: "Harper",
        },
      ]),
    );
    const record = expectParsed(outcomes[0]);
    expect(record).toMatchObject({
      type: "book",
      title: "Sapiens",
      author: [{ family: "Harari", given: "Yuval Noah" }],
      issued: { "date-parts": [[2015]] },
    });
    expect(record.identifiers.isbn).toBe("9780062316097");
    expect(record.provenance.source).toBe("csl-json");
  });

  it("accepts a { items: [...] } envelope and a `literal` creator", () => {
    const outcomes = parseZoteroJson(
      toJsonText({
        items: [
          { title: "Org Report", author: [{ literal: "World Bank" }], ISBN: "9780062316097" },
        ],
      }),
    );
    expect(expectParsed(outcomes[0]).author).toEqual([{ literal: "World Bank" }]);
  });

  it("picks the first checksum-valid ISBN out of a space-separated ISBN field", () => {
    const outcomes = parseZoteroJson(toJsonText([{ title: "t", ISBN: "garbage 9780062316097" }]));
    expect(expectParsed(outcomes[0]).identifiers.isbn).toBe("9780062316097");
  });

  it("infers the item type from the identifier when `type` is absent", () => {
    const isbnItem = expectParsed(
      parseZoteroJson(toJsonText([{ title: "t", ISBN: "9780062316097" }]))[0],
    );
    expect(isbnItem.type).toBe("book");
    const doiItem = expectParsed(
      parseZoteroJson(toJsonText([{ title: "t", DOI: "10.1000/x" }]))[0],
    );
    expect(doiItem.type).toBe("article-journal");
  });

  it("returns a single malformed outcome for invalid JSON", () => {
    expect(parseZoteroJson("{not json")).toEqual([{ outcome: "skipped", reason: "malformed" }]);
  });

  it("skips a non-object item as malformed but keeps parsing the rest", () => {
    const outcomes = parseZoteroJson(toJsonText([42, { title: "Good", ISBN: "9780062316097" }]));
    expect(outcomes[0]).toEqual({ outcome: "skipped", reason: "malformed" });
    expect(expectParsed(outcomes[1]).title).toBe("Good");
  });

  it("reads an array item as an item with no fields (no-title), not as malformed", () => {
    expect(parseZoteroJson(toJsonText([[1, 2]]))).toEqual([
      { outcome: "skipped", reason: "no-title" },
    ]);
  });

  it("yields no outcomes for JSON that is neither an item array nor an items envelope", () => {
    expect(parseZoteroJson(toJsonText({ data: [] }))).toEqual([]);
    expect(parseZoteroJson(toJsonText("text"))).toEqual([]);
  });

  it("keeps an issued raw date as written (its year still reads)", () => {
    const outcomes = parseZoteroJson(
      toJsonText([{ title: "t", DOI: "10.1000/x", issued: { raw: "Spring 2015" } }]),
    );
    const issued = expectParsed(outcomes[0]).issued;
    expect(issued).toEqual({ raw: "Spring 2015" });
    expect(yearOf(issued)).toBe(2015);
  });

  it("reads an import-mode item in full, and the first valid ISBN of a list", () => {
    const [outcome] = parseZoteroJson(
      toJsonText([
        {
          title: "Sapiens",
          ISBN: "not-an-isbn 0-06-231609-5",
          issued: { "date-parts": [[2015, 3, 14]] },
          "publisher-place": "New York",
          translator: [{ family: "Purcell", given: "John" }],
        },
      ]),
    );
    expect(expectParsed(outcome)).toMatchObject({
      type: "book",
      issued: { "date-parts": [[2015, 3, 14]] },
      "publisher-place": "New York",
      translator: [{ family: "Purcell", given: "John" }],
      identifiers: { isbn: "9780062316097" },
    });
  });
});

// ── Reading-list CSV ──────────────────────────────────────────────────

describe("parseCsv", () => {
  it("maps rows by aliased headers regardless of column order", () => {
    const record = expectParsed(
      parseCsv(
        ["ISBN,Title,Author,Year", "9780062316097,Sapiens,Yuval Noah Harari,2015"].join("\n"),
      )[0],
    );
    expect(record).toMatchObject({
      type: "book",
      title: "Sapiens",
      issued: { "date-parts": [[2015]] },
    });
    expect(record.identifiers.isbn).toBe("9780062316097");
    expect(record.author).toEqual([{ family: "Harari", given: "Yuval Noah" }]);
    expect(record.provenance.source).toBe("csv");
  });

  it("splits a multi-author cell on `;` and ` and `", () => {
    const record = expectParsed(
      parseCsv(
        ["title,isbn,author", '"t",9780062316097,"Doe, Jane; John Smith and Al Roe"'].join("\n"),
      )[0],
    );
    expect(record.author).toEqual([
      { family: "Doe", given: "Jane" },
      { family: "Smith", given: "John" },
      { family: "Roe", given: "Al" },
    ]);
  });

  it("honours quoted cells containing commas and embedded newlines", () => {
    const record = expectParsed(
      parseCsv(
        ["title,isbn", '"A title, with a comma\nand a newline",9780062316097'].join("\n"),
      )[0],
    );
    expect(record.title).toBe("A title, with a comma and a newline");
  });

  it("returns a single malformed outcome when the header lacks a title column", () => {
    expect(parseCsv("isbn,year\n9780062316097,2015")).toEqual([
      { outcome: "skipped", reason: "malformed" },
    ]);
  });

  it("skips a row with no identifier", () => {
    expect(parseCsv(["title,author", "Untracked,Nobody"].join("\n"))[0]).toEqual({
      outcome: "skipped",
      reason: "no-identifier",
      position: { offset: 13, line: 2, column: 1 },
    });
  });
});

// ── RIS ───────────────────────────────────────────────────────────────

describe("parseRis", () => {
  it("maps a BOOK record with author, year, publisher and ISBN", () => {
    const record = expectParsed(
      parseRis(
        [
          "TY  - BOOK",
          "TI  - Sapiens",
          "AU  - Harari, Yuval Noah",
          "PY  - 2015",
          "PB  - Harper",
          "SN  - 9780062316097",
          "ER  - ",
        ].join("\n"),
      )[0],
    );
    expect(record).toMatchObject({
      type: "book",
      title: "Sapiens",
      publisher: "Harper",
      author: [{ family: "Harari", given: "Yuval Noah" }],
      issued: { "date-parts": [[2015]] },
    });
    expect(record.identifiers.isbn).toBe("9780062316097");
    expect(record.provenance.source).toBe("ris");
  });

  it("maps a JOUR record with a DOI, container title, volume/issue/pages and an ISSN", () => {
    const record = expectParsed(
      parseRis(
        [
          "TY  - JOUR",
          "TI  - The Structure of Scientific Revolutions",
          "AU  - Kuhn, Thomas",
          "AU  - Popper, Karl",
          "JO  - Journal of Science",
          "VL  - 59",
          "IS  - 1",
          "SP  - 29",
          "EP  - 40",
          "PY  - 1962/01/01/",
          "DO  - 10.1037/0003-066X.59.1.29",
          "SN  - 0378-5955",
          "ER  - ",
        ].join("\n"),
      )[0],
    );
    expect(record.type).toBe("article-journal");
    expect(record.identifiers.doi).toBe("10.1037/0003-066x.59.1.29");
    expect(record.identifiers.issn).toBe("0378-5955");
    expect(record["container-title"]).toBe("Journal of Science");
    expect(record.page).toBe("29-40");
    expect(record.issued).toEqual({ "date-parts": [[1962]] });
    expect(record.author).toHaveLength(2);
  });

  it("is fail-soft on an unterminated record and unknown types", () => {
    const outcomes = parseRis(["TY  - GEN", "TI  - No terminator", "DO  - 10.1000/x"].join("\n"));
    // A record missing its ER is still flushed at end of input.
    const record = expectParsed(outcomes[0]);
    expect(record.type).toBe("document");
  });

  it("skips a record with a title but no identifier", () => {
    expect(parseRis(["TY  - BOOK", "TI  - Untracked", "ER  - "].join("\n"))[0]).toEqual({
      outcome: "skipped",
      reason: "no-identifier",
      position: { offset: 0, line: 1, column: 1 },
    });
  });
});

// ── Lenient mode, citation keys and positions ─────────────────────────

describe("lenient mode and citation keys", () => {
  it("keeps CSV rows, RIS records and CSL-JSON items without an identifier", () => {
    const csv = parseCsv("key,title,author\ndoe2020,On Things,Jane Doe\n,,", { mode: "lenient" });
    expect(expectParsed(csv[0])).toEqual({
      type: "document",
      id: "doe2020",
      "citation-key": "doe2020",
      title: "On Things",
      author: [{ family: "Doe", given: "Jane" }],
      identifiers: {},
      provenance: { source: "csv" },
    });
    expect(expectParsed(csv[1])).toEqual({
      type: "document",
      identifiers: {},
      provenance: { source: "csv" },
    });
    const ris = parseRis("TY  - RPRT\nID  - lab7\nTI  - Report\nER  - ", { mode: "lenient" });
    expect(expectParsed(ris[0])).toMatchObject({
      type: "report",
      "citation-key": "lab7",
      id: "lab7",
    });
  });

  it("reads CSL-JSON items in full in lenient mode, and their keys in either mode", () => {
    const item = {
      id: 7,
      "citation-key": "doe2020",
      type: "thesis",
      title: "On Things",
      genre: "PhD thesis",
      PMID: 15371539,
    };
    const lenient = expectParsed(parseZoteroJson(toJsonText([item]), { mode: "lenient" })[0]);
    expect(lenient).toMatchObject({
      id: 7,
      "citation-key": "doe2020",
      genre: "PhD thesis",
      identifiers: { pmid: "15371539" },
    });
    expect(parseZoteroJson(toJsonText([item]))[0]).toEqual({
      outcome: "skipped",
      reason: "no-identifier",
    });
    const imported = expectParsed(parseZoteroJson(toJsonText([{ ...item, DOI: "10.1000/x" }]))[0]);
    expect(imported).toMatchObject({
      id: 7,
      "citation-key": "doe2020",
      identifiers: { pmid: "15371539" },
    });
    // Read in full, as in lenient mode (#82).
    expect(imported.genre).toBe("PhD thesis");
    expect(parseZoteroJson(toJsonText([1]), { mode: "lenient" })).toEqual([
      { outcome: "skipped", reason: "malformed" },
    ]);
  });

  it("positions CSV rows, quoted line breaks included, and RIS records after CRLF lines", () => {
    const csv = parseCsv('title,isbn\r\n"A\nB",9780062316097\r\nC,9780062316097');
    expect(csv.map((outcome) => outcome.position)).toEqual([
      { offset: 12, line: 2, column: 1 },
      { offset: 33, line: 4, column: 1 },
    ]);
    const ris = parseRis("junk\r\nTY  - BOOK\r\nER  - \r\n\r\n  \r\nTY  - BOOK\r\nER  - ", {
      mode: "lenient",
    });
    expect(ris.map((outcome) => outcome.position)).toEqual([
      { offset: 6, line: 2, column: 1 },
      { offset: 32, line: 6, column: 1 },
    ]);
  });

  it("falls back to the default for a bound that is not a positive integer", () => {
    const authors = Array.makeBy(MAX_AUTHORS + 5, (i) => `Author${i}, A.`).join(" and ");
    const entry = `@book{k, title = {T}, author = {${authors}}}`;
    Array.forEach([0, -1, 1.5, Number.NaN], (maxAuthors) => {
      expect(
        expectParsed(parseBibtex(entry, { mode: "lenient", maxAuthors })[0]).author,
      ).toHaveLength(MAX_AUTHORS);
    });
  });
});

// ── Format independence (the B2 proof) ────────────────────────────────

describe("format independence", () => {
  it("a BibTeX and an RIS fixture of the same works project to equal CSL-JSON", () => {
    const bibtex = `
      @book{book1, title={Sapiens}, author={Harari, Yuval Noah}, year={2015}, publisher={Harper}, isbn={9780062316097}}
      @article{art1, title={The Structure of Scientific Revolutions}, author={Kuhn, Thomas and Popper, Karl}, journal={Journal of Science}, volume={59}, number={1}, pages={29-40}, year={1962}, doi={10.1037/0003-066X.59.1.29}, issn={0378-5955}}
    `;
    const ris = [
      "TY  - BOOK",
      "ID  - book1",
      "TI  - Sapiens",
      "AU  - Harari, Yuval Noah",
      "PY  - 2015",
      "PB  - Harper",
      "SN  - 9780062316097",
      "ER  - ",
      "TY  - JOUR",
      "ID  - art1",
      "TI  - The Structure of Scientific Revolutions",
      "AU  - Kuhn, Thomas",
      "AU  - Popper, Karl",
      "JO  - Journal of Science",
      "VL  - 59",
      "IS  - 1",
      "SP  - 29",
      "EP  - 40",
      "PY  - 1962",
      "DO  - 10.1037/0003-066X.59.1.29",
      "SN  - 0378-5955",
      "ER  - ",
    ].join("\n");

    const fromBibtex = parseBibliographicFile(bibtex, "bibtex").map(expectParsed);
    const fromRis = parseBibliographicFile(ris, "ris").map(expectParsed);
    expect(fromBibtex).toHaveLength(2);
    expect(fromRis).toHaveLength(2);
    // The provenance envelope differs by construction (bibtex vs ris); the CSL
    // projection drops it, so equal CSL-JSON *is* the format-independence proof.
    Array.forEach(Array.zip(fromBibtex, fromRis), ([bibtexRecord, risRecord]) => {
      expect(toCslJson(bibtexRecord)).toEqual(toCslJson(risRecord));
    });
  });
});

// ── Resource bounds / dispatch ────────────────────────────────────────

describe("parseBibliographicFile resource bounds", () => {
  it("reports an upload over the input-length cap as one too-large outcome", () => {
    const huge = `@book{x, title={t}, isbn={9780062316097}}`.padEnd(MAX_INPUT_LENGTH + 1, " ");
    Array.forEach(["bibtex", "zotero-json", "csv", "ris"] as const, (format) => {
      expect(parseBibliographicFile(huge, format)).toEqual([
        { outcome: "skipped", reason: "too-large" },
      ]);
    });
  });

  it("parses hostile BibTeX at the input-length cap without throwing or unbounded memory", () => {
    const n = MAX_INPUT_LENGTH;
    const hostile = [
      `@x${"{".repeat(n - 2)}`,
      "@x{".repeat(Math.floor(n / 3)),
      "@comment{".repeat(Math.floor(n / 9)),
      `@x{k,${"a=b,".repeat(Math.floor((n - 6) / 4))}}`,
      `@x{k,t=${"{}".repeat(Math.floor((n - 8) / 2))}}`,
      `@x{k,t="${"a".repeat(n - 9)}}`,
    ];
    Array.forEach(hostile, (content) => {
      expect(content.length).toBeLessThanOrEqual(n);
      const before = process.memoryUsage().heapUsed;
      expect(() => parseBibliographicFile(content, "bibtex")).not.toThrow();
      // A per-character array of an 8 MB input alone is over 64 MB.
      expect(process.memoryUsage().heapUsed - before).toBeLessThan(48_000_000);
    });
  });

  it("caps the number of emitted records at MAX_RECORDS", () => {
    const entries = Array.makeBy(
      MAX_RECORDS + 50,
      (i) => `{ "title": "t${i}", "ISBN": "9780062316097" }`,
    ).join(",");
    const outcomes = parseBibliographicFile(`[${entries}]`, "zotero-json");
    expect(outcomes).toHaveLength(MAX_RECORDS + 1);
    expect(outcomes[MAX_RECORDS]).toEqual({ outcome: "skipped", reason: "truncated" });
  });

  it("caps every format at the caller's record cap, with a truncated outcome only past it", () => {
    const options = { maxRecords: 2 };
    const bibtex = (n: number) =>
      Array.makeBy(n, (i) => `@book{k${i}, title={T}, isbn={9780062316097}}`).join("\n");
    const json = (n: number) =>
      `[${Array.makeBy(n, () => `{ "title": "T", "ISBN": "9780062316097" }`).join(",")}]`;
    const csv = (n: number) =>
      ["title,isbn", ...Array.makeBy(n, () => "T,9780062316097")].join("\n");
    const ris = (n: number) =>
      Array.makeBy(n, () => "TY  - BOOK\nTI  - T\nSN  - 9780062316097\nER  - ").join("\n");
    const reasons = (outcomes: readonly ParseOutcome[]) =>
      outcomes.map((outcome) => (outcome.outcome === "skipped" ? outcome.reason : "parsed"));
    Array.forEach(
      [
        [bibtex, "bibtex"],
        [json, "zotero-json"],
        [csv, "csv"],
        [ris, "ris"],
      ] as const,
      ([make, format]) => {
        expect(reasons(parseBibliographicFile(make(2), format, options))).toEqual([
          "parsed",
          "parsed",
        ]);
        expect(reasons(parseBibliographicFile(make(3), format, options))).toEqual([
          "parsed",
          "parsed",
          "truncated",
        ]);
      },
    );
  });

  it("dispatches on the format discriminator, including RIS", () => {
    expect(
      expectParsed(parseBibliographicFile("title,isbn\nt,9780062316097", "csv")[0]).title,
    ).toBe("t");
    const ris = parseBibliographicFile(
      ["TY  - BOOK", "TI  - R", "SN  - 9780062316097", "ER  - "].join("\n"),
      "ris",
    );
    expect(expectParsed(ris[0]).title).toBe("R");
  });
});
