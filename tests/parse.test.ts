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
} from "@thomasfosterau/biblio";

/** Narrows a `ParseOutcome` to its parsed record, failing the test otherwise. */
function expectParsed(outcome: ParseOutcome) {
  expect(outcome.outcome).toBe("parsed");
  if (outcome.outcome !== "parsed") throw new Error("unreachable");
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
    expect(parseBibtex(`@book{x, title={t}, isbn={9780140449137}}`)[0]).toEqual({
      outcome: "skipped",
      reason: "no-identifier",
    });
  });

  it("skips entries with no identifier / no title", () => {
    expect(parseBibtex(`@book{x, title={Untracked}, author={Nobody}}`)[0]).toEqual({
      outcome: "skipped",
      reason: "no-identifier",
    });
    expect(parseBibtex(`@book{x, isbn={9780062316097}}`)[0]).toEqual({
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
    expect(record.title).toBe("A {Nested} Title");
  });

  it("stops at an unbalanced / truncated tail without throwing", () => {
    expect(() => parseBibtex(`@book{x, title={Truncated`)).not.toThrow();
    expect(parseBibtex(`@book{x, title={Truncated`)).toEqual([]);
  });

  it("clamps the author list to MAX_AUTHORS", () => {
    const many = Array.from({ length: MAX_AUTHORS + 10 }, (_, i) => `Given${i} Family${i}`).join(
      " and ",
    );
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
      JSON.stringify([
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
      JSON.stringify({
        items: [
          { title: "Org Report", author: [{ literal: "World Bank" }], ISBN: "9780062316097" },
        ],
      }),
    );
    expect(expectParsed(outcomes[0]).author).toEqual([{ literal: "World Bank" }]);
  });

  it("picks the first checksum-valid ISBN out of a space-separated ISBN field", () => {
    const outcomes = parseZoteroJson(
      JSON.stringify([{ title: "t", ISBN: "garbage 9780062316097" }]),
    );
    expect(expectParsed(outcomes[0]).identifiers.isbn).toBe("9780062316097");
  });

  it("infers the item type from the identifier when `type` is absent", () => {
    const isbnItem = expectParsed(
      parseZoteroJson(JSON.stringify([{ title: "t", ISBN: "9780062316097" }]))[0],
    );
    expect(isbnItem.type).toBe("book");
    const doiItem = expectParsed(
      parseZoteroJson(JSON.stringify([{ title: "t", DOI: "10.1000/x" }]))[0],
    );
    expect(doiItem.type).toBe("article-journal");
  });

  it("returns a single malformed outcome for invalid JSON", () => {
    expect(parseZoteroJson("{not json")).toEqual([{ outcome: "skipped", reason: "malformed" }]);
  });

  it("skips a non-object item as malformed but keeps parsing the rest", () => {
    const outcomes = parseZoteroJson(
      JSON.stringify([42, { title: "Good", ISBN: "9780062316097" }]),
    );
    expect(outcomes[0]).toEqual({ outcome: "skipped", reason: "malformed" });
    expect(expectParsed(outcomes[1]).title).toBe("Good");
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
      "TI  - Sapiens",
      "AU  - Harari, Yuval Noah",
      "PY  - 2015",
      "PB  - Harper",
      "SN  - 9780062316097",
      "ER  - ",
      "TY  - JOUR",
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
    for (let i = 0; i < 2; i++) {
      expect(toCslJson(fromBibtex[i])).toEqual(toCslJson(fromRis[i]));
    }
  });
});

// ── Resource bounds / dispatch ────────────────────────────────────────

describe("parseBibliographicFile resource bounds", () => {
  it("drops the whole upload over the input-length cap", () => {
    const huge = `@book{x, title={t}, isbn={9780062316097}}`.padEnd(MAX_INPUT_LENGTH + 1, " ");
    expect(parseBibliographicFile(huge, "bibtex")).toEqual([]);
  });

  it("caps the number of emitted records at MAX_RECORDS", () => {
    const entries = Array.from(
      { length: MAX_RECORDS + 50 },
      (_, i) => `{ "title": "t${i}", "ISBN": "9780062316097" }`,
    ).join(",");
    const outcomes = parseBibliographicFile(`[${entries}]`, "zotero-json");
    expect(outcomes.length).toBeLessThanOrEqual(MAX_RECORDS);
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
