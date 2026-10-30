/**
 * Unit tests for the tagged-line readers in `src/parse.ts`: PubMed / MEDLINE
 * (`parseMedline`, PubMed's `.nbib` export) and Refer / EndNote tagged
 * (`parseRefer`), through the whole-file and the streaming front ends.
 *
 * @module tests/unit/biblio-tagged
 */

import * as Stream from "effect/Stream";
import { assert, describe, expect, it } from "vite-plus/test";
import {
  parseBibliographicFile,
  parseBibliographicStream,
  parseMedline,
  parseRefer,
  type ParseOutcome,
} from "@thomasfosterau/biblio";
import { runTest } from "./effect.ts";

/** Narrows the outcome at `index` to its parsed record, failing the test otherwise. */
function expectParsed(outcomes: readonly ParseOutcome[], index: number) {
  const outcome = outcomes[index];
  if (outcome?.outcome !== "parsed") assert.fail(`expected a parsed outcome at ${index}`);
  return outcome.record;
}

const MEDLINE = [
  "PMID- 31452104",
  "OWN - NLM",
  "TI  - A wrapped title that",
  "      continues here.",
  "FAU - Doe, John",
  "AU  - Doe J",
  "FAU - Smith, Ann B",
  "CN  - The Study Group",
  "FED - Editor, Ed",
  "JT  - Journal of Things",
  "TA  - J Things",
  "VI  - 12",
  "IP  - 3",
  "PG  - 123-45",
  "DP  - 2019 Aug 26",
  "IS  - 1234-5679 (Electronic)",
  "LID - S0000 [pii]",
  "AID - 10.1000/xyz123 [doi]",
  "PMC - PMC6710123",
  "",
  "PMID- 2",
  "TI  - A Chapter",
  "BTI - A Book",
  "ISBN- 9780062316097",
  "PB  - Harper",
  "DP  - 2015",
  "",
  "PMID- 3",
  "BTI - Only a Book",
  "AU  - Roe R",
  "ED  - Eddy E",
  "ISBN- 9780062316097",
  "",
  "PMID- 4",
  "TI  - Untyped",
].join("\n");

const REFER = [
  "%0 Journal Article",
  "%A Doe, John",
  "%A Ann Smith",
  "%E Editor, Ed",
  "%T A title",
  "that continues",
  "%J Journal of Things",
  "%V 12",
  "%N 3",
  "%P 123-145",
  "%D 2019",
  "%@ 1234-5679",
  "%R 10.1000/xyz123",
  "%F doe2019",
  "",
  "%0 Book",
  "%T Sapiens",
  "%@ 978-0-06-231609-7",
  "%I Harper",
  "%D 2015",
  "%L harari",
  "",
  "%T Classic refer, no type",
  "%B A Book",
  "",
  "%T A journal by inference",
  "%J J",
  "",
  "%0 Unknown Type",
  "%T Fallback",
  "%R 10.1000/fallback",
].join("\n");

describe("parseMedline", () => {
  it("reads a journal article, wrapped values and every mapped tag", () => {
    const record = expectParsed(parseMedline(MEDLINE), 0);
    expect(record).toMatchObject({
      type: "article-journal",
      id: "31452104",
      title: "A wrapped title that continues here.",
      "container-title": "Journal of Things",
      volume: "12",
      issue: "3",
      page: "123-45",
      issued: { "date-parts": [[2019]] },
      author: [
        { family: "Doe", given: "John" },
        { family: "Smith", given: "Ann B" },
        { literal: "The Study Group" },
      ],
      editor: [{ family: "Editor", given: "Ed" }],
      identifiers: {
        doi: "10.1000/xyz123",
        issn: "1234-5679",
        pmid: "31452104",
        pmcid: "PMC6710123",
      },
      provenance: { source: "medline" },
    });
  });

  it("reads book chapters and books, and positions each record", () => {
    const outcomes = parseMedline(MEDLINE, { mode: "lenient" });
    expect(outcomes.map((outcome) => outcome.position?.line)).toEqual([1, 21, 28, 34]);
    expect(expectParsed(outcomes, 1)).toMatchObject({
      type: "chapter",
      title: "A Chapter",
      "container-title": "A Book",
      publisher: "Harper",
      identifiers: { isbn: "9780062316097" },
    });
    expect(expectParsed(outcomes, 2)).toMatchObject({
      type: "book",
      title: "Only a Book",
      author: [{ family: "Roe", given: "R" }],
      editor: [{ family: "Eddy", given: "E" }],
    });
    expect(expectParsed(outcomes, 3).type).toBe("document");
  });

  it("applies the import policy, the record cap and the input cap", () => {
    expect(parseMedline(MEDLINE).map((outcome) => outcome.outcome)).toEqual([
      "parsed",
      "parsed",
      "parsed",
      "skipped",
    ]);
    expect(parseMedline(MEDLINE, { mode: "lenient", maxRecords: 1 }).at(-1)).toEqual({
      outcome: "skipped",
      reason: "truncated",
    });
    expect(parseMedline(MEDLINE, { maxInputLength: 10 })).toEqual([
      { outcome: "skipped", reason: "too-large" },
    ]);
  });

  it("drops names that are empty", () => {
    const outcomes = parseMedline(
      "PMID- 5\nTI  - T\nFAU - \nCN  - \n\nPMID- 6\nTI  - U\nAU  - \n",
      {
        mode: "lenient",
      },
    );
    expect(expectParsed(outcomes, 0).author).toBeUndefined();
    expect(expectParsed(outcomes, 1).author).toBeUndefined();
  });

  it("reads CRLF line breaks and ignores blank paragraphs", () => {
    const outcomes = parseMedline("\r\n\r\nPMID- 9\r\nTI  - T\r\n      more\r\n\r\n\r\n", {
      mode: "lenient",
    });
    expect(outcomes).toHaveLength(1);
    expect(expectParsed(outcomes, 0).title).toBe("T more");
  });
});

describe("parseRefer", () => {
  it("reads an EndNote journal article and a book", () => {
    const outcomes = parseRefer(REFER, { mode: "lenient" });
    expect(expectParsed(outcomes, 0)).toMatchObject({
      type: "article-journal",
      id: "doe2019",
      "citation-key": "doe2019",
      title: "A title that continues",
      "container-title": "Journal of Things",
      volume: "12",
      issue: "3",
      page: "123-145",
      issued: { "date-parts": [[2019]] },
      author: [
        { family: "Doe", given: "John" },
        { family: "Smith", given: "Ann" },
      ],
      editor: [{ family: "Editor", given: "Ed" }],
      identifiers: { doi: "10.1000/xyz123", issn: "1234-5679" },
      provenance: { source: "refer" },
    });
    expect(expectParsed(outcomes, 1)).toMatchObject({
      type: "book",
      id: "harari",
      publisher: "Harper",
      identifiers: { isbn: "9780062316097" },
    });
  });

  it("infers a type without %0 and falls back for an unknown one", () => {
    const outcomes = parseRefer(REFER, { mode: "lenient" });
    expect(outcomes.map((outcome) => outcome.position?.line)).toEqual([1, 16, 23, 26, 29]);
    expect(expectParsed(outcomes, 2)).toMatchObject({
      type: "chapter",
      "container-title": "A Book",
    });
    expect(expectParsed(outcomes, 3).type).toBe("article-journal");
    expect(expectParsed(outcomes, 4).type).toBe("article-journal");
  });

  it("skips a paragraph with no tag line", () => {
    expect(parseRefer("just text\nno tags", { mode: "lenient" })).toEqual([]);
  });
});

describe("parseBibliographicFile and the stream", () => {
  const chunked = (text: string, size: number): Stream.Stream<string> =>
    Stream.fromIterable(
      globalThis.Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
        text.slice(index * size, (index + 1) * size),
      ),
    );

  it.each([
    ["medline", MEDLINE],
    ["refer", REFER],
    ["medline", MEDLINE.replaceAll("\n", "\r\n")],
  ] as const)(
    "streams %s with the whole-file outcomes for every chunk size",
    async (format, text) => {
      const whole = parseBibliographicFile(text, format, { mode: "lenient" });
      expect(whole.length).toBeGreaterThan(3);
      const sizes = [1, 3, 17, text.length];
      const results = await Promise.all(
        sizes.map((size) =>
          runTest(
            Stream.runCollect(
              parseBibliographicStream(chunked(text, size), format, { mode: "lenient" }),
            ),
          ),
        ),
      );
      results.forEach((streamed, index) => {
        expect(streamed, `chunks of ${sizes[index]}`).toEqual(whole);
      });
    },
  );
});
