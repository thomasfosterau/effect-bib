/**
 * Unit tests for the bibliographic file-format parsers
 * (`src/lib/server/biblio/parse.ts`).
 *
 * Drives representative BibTeX / Zotero-JSON / reading-list CSV content
 * through the parsers and asserts the neutral `IngestedRecord` mapping,
 * the per-record fail-soft skip outcomes, the identifier → source dedup
 * mapping, and the untrusted-data clamps / resource bounds. No network, no
 * database — the parsers are pure.
 *
 * @module tests/unit/biblio-parse
 */

import { describe, expect, it } from "vite-plus/test";
import {
  MAX_INPUT_LENGTH,
  MAX_RECORDS,
  parseBibliographicFile,
  parseBibtex,
  parseCsv,
  parseZoteroJson,
} from "@thomasfosterau/biblio/parse";
import { MAX_AUTHORS } from "@thomasfosterau/biblio/record";

/** Narrows a `ParseOutcome` to its `parsed` record, failing the test otherwise. */
function expectParsed(outcome: ReturnType<typeof parseBibtex>[number]) {
  expect(outcome.outcome).toBe("parsed");
  if (outcome.outcome !== "parsed") throw new Error("unreachable");
  return outcome.record;
}

describe("parseBibtex", () => {
  it("maps a book entry with an ISBN to an openlibrary-keyed Book record", () => {
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
      source: "openlibrary",
      authorityId: "9780062316097",
      kind: "book",
      title: "Sapiens: A Brief History of Humankind",
      publicationYear: 2015,
      publisher: "Harper",
      isbn13: "9780062316097",
      isbn10: null,
      doi: null,
      authors: [{ name: "Yuval Noah Harari" }],
    });
  });

  it("maps a DOI-bearing entry to a crossref-keyed article record", () => {
    const outcomes = parseBibtex(`
      @article{kuhn,
        title = {The Structure of Scientific Revolutions},
        author = {Kuhn, Thomas},
        doi = {10.1037/0003-066X.59.1.29},
      }
    `);
    const record = expectParsed(outcomes[0]);
    expect(record).toMatchObject({
      source: "crossref",
      authorityId: "10.1037/0003-066x.59.1.29",
      kind: "article",
      doi: "10.1037/0003-066x.59.1.29",
      isbn13: null,
    });
  });

  it("splits multiple `and`-separated authors and reorders Family, Given", () => {
    const record = expectParsed(
      parseBibtex(
        `@book{x, title={t}, isbn={9780062316097}, author={Doe, Jane and John Smith}}`,
      )[0],
    );
    expect(record.authors).toEqual([{ name: "Jane Doe" }, { name: "John Smith" }]);
  });

  it("skips an entry with no identifier (no-identifier)", () => {
    const outcomes = parseBibtex(`@book{x, title={Untracked}, author={Nobody}}`);
    expect(outcomes[0]).toEqual({ outcome: "skipped", reason: "no-identifier" });
  });

  it("skips an entry with no title (no-title)", () => {
    const outcomes = parseBibtex(`@book{x, isbn={9780062316097}}`);
    expect(outcomes[0]).toEqual({ outcome: "skipped", reason: "no-title" });
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
    const many = Array.from({ length: MAX_AUTHORS + 10 }, (_, i) => `Author${i}`).join(" and ");
    const record = expectParsed(
      parseBibtex(`@book{x, title={t}, isbn={9780062316097}, author={${many}}}`)[0],
    );
    expect(record.authors).toHaveLength(MAX_AUTHORS);
  });
});

describe("parseZoteroJson", () => {
  it("maps a top-level array of CSL items", () => {
    const outcomes = parseZoteroJson(
      JSON.stringify([
        {
          title: "Sapiens",
          author: [{ given: "Yuval Noah", family: "Harari" }],
          ISBN: "9780062316097",
          issued: { "date-parts": [[2015]] },
          publisher: "Harper",
        },
      ]),
    );
    expect(expectParsed(outcomes[0])).toMatchObject({
      source: "openlibrary",
      authorityId: "9780062316097",
      title: "Sapiens",
      publicationYear: 2015,
      authors: [{ name: "Yuval Noah Harari" }],
    });
  });

  it("accepts a { items: [...] } envelope and a `literal` creator", () => {
    const outcomes = parseZoteroJson(
      JSON.stringify({
        items: [
          { title: "Org Report", author: [{ literal: "World Bank" }], ISBN: "9780062316097" },
        ],
      }),
    );
    expect(expectParsed(outcomes[0]).authors).toEqual([{ name: "World Bank" }]);
  });

  it("picks the first valid ISBN out of a space-separated ISBN field", () => {
    const outcomes = parseZoteroJson(
      JSON.stringify([{ title: "t", ISBN: "garbage 9780062316097" }]),
    );
    expect(expectParsed(outcomes[0]).isbn13).toBe("9780062316097");
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

describe("parseCsv", () => {
  it("maps rows by aliased headers regardless of column order", () => {
    const outcomes = parseCsv(
      ["ISBN,Title,Author,Year", "9780062316097,Sapiens,Yuval Noah Harari,2015"].join("\n"),
    );
    expect(expectParsed(outcomes[0])).toMatchObject({
      source: "openlibrary",
      authorityId: "9780062316097",
      title: "Sapiens",
      publicationYear: 2015,
      authors: [{ name: "Yuval Noah Harari" }],
    });
  });

  it("splits a multi-author cell on `;` and ` and `", () => {
    const record = expectParsed(
      parseCsv(
        ["title,isbn,author", '"t",9780062316097,"Jane Doe; John Smith and Al Roe"'].join("\n"),
      )[0],
    );
    expect(record.authors).toEqual([
      { name: "Jane Doe" },
      { name: "John Smith" },
      { name: "Al Roe" },
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
    const outcomes = parseCsv(["title,author", "Untracked,Nobody"].join("\n"));
    expect(outcomes[0]).toEqual({ outcome: "skipped", reason: "no-identifier" });
  });
});

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

  it("dispatches on the format discriminator", () => {
    const csv = parseBibliographicFile("title,isbn\nt,9780062316097", "csv");
    expect(expectParsed(csv[0]).title).toBe("t");
  });
});
