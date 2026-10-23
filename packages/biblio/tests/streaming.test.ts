/**
 * Unit tests for the Effect and Stream front ends (`src/streaming.ts`):
 * `parseBibliographic` fails on a typed `InputTooLarge`, and
 * `parseBibliographicStream` yields the whole-file parse's outcomes and
 * positions however the input is cut into chunks.
 *
 * @module tests/unit/biblio-streaming
 */

import * as Array from "effect/Array";
import * as Exit from "effect/Exit";
import * as Order from "effect/Order";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";
import { runTest, runTestExit } from "./effect.ts";
import {
  type ImportFormat,
  InputTooLarge,
  parseBibliographic,
  parseBibliographicFile,
  parseBibliographicStream,
  type ParseOptions,
} from "@thomasfosterau/biblio";

/** `text` cut into chunks of `size` characters. */
const chunked = (text: string, size: number): Stream.Stream<string> =>
  Stream.fromIterable(
    Array.makeBy(Math.max(1, Math.ceil(text.length / size)), (index) =>
      text.slice(index * size, (index + 1) * size),
    ),
  );

/** The stream's outcomes for `text` cut into chunks of `size`. */
const streamed = async (
  text: string,
  size: number,
  format: ImportFormat,
  options: ParseOptions = {},
) =>
  await runTest(Stream.runCollect(parseBibliographicStream(chunked(text, size), format, options)));

const BIBTEX = [
  "% A library export.",
  '@string{ups = "Oxford University Press"}',
  "@book{oxford, title = {The {Oxford} Handbook}, publisher = ups, date = {2015-03}, isbn = {9780199695836}}",
  "",
  "@article{kuhn,\r\n  title = {The Structure},\r\n  author = {Kuhn, Thomas},\r\n  doi = {10.1037/0003-066X.59.1.29}\r\n}",
  "Stray text between entries.",
  "@misc{untitled, author = {Nobody}}",
  '@string{later = "Defined Later"}',
  "@book{late, title = {Uses a Later Macro}, publisher = later, isbn = {9780062316097}}",
].join("\n");

const RIS = [
  "Provider: test",
  "",
  "TY  - BOOK",
  "TI  - Sapiens",
  "SN  - 9780062316097",
  "ER  - ",
  "TY  - JOUR",
  "TI  - No terminator, next record follows",
  "DO  - 10.1037/0003-066X.59.1.29",
  "TY  - BOOK",
  "AU  - Nobody",
  "ER  - ",
].join("\r\n");

const CSV = 'title,isbn\r\n"A\nB",9780062316097\r\n\r\nC,9780062316097\nD,not-an-isbn';

describe("parseBibliographicStream", () => {
  it.each([
    ["bibtex", BIBTEX],
    ["ris", RIS],
    ["csv", CSV],
  ] as const)(
    "yields the whole-file %s outcomes, positions included, for every chunk size",
    async (format, text) => {
      const whole = parseBibliographicFile(text, format, { mode: "lenient" });
      const sizes = [1, 2, 7, 64, text.length];
      const results = await Promise.all(
        sizes.map((size) => streamed(text, size, format, { mode: "lenient" })),
      );
      Array.forEach(results, (result, index) => {
        expect(result, `chunks of ${sizes[index]}`).toEqual(whole);
      });
    },
  );

  it("reads a child with a parent that came before, and one whose parent comes after", async () => {
    const bibtex = [
      "@book{parent, title = {The Book}, publisher = {Pub}, isbn = {9780199695836}}",
      "@inbook{before, crossref = {parent}, title = {Early}, doi = {10.1000/xyz123}}",
      "@inbook{after, crossref = {laterparent}, title = {Late}, doi = {10.1000/xyz124}}",
      "@book{laterparent, title = {Later Book}, publisher = {Pub2}, isbn = {9780062316097}}",
    ].join("\n");
    const outcomes = await streamed(bibtex, 10, "bibtex");
    const records = outcomes.flatMap((outcome) =>
      outcome.outcome === "parsed" ? [outcome.record] : [],
    );
    expect(records.map((record) => [record.id, record["container-title"]])).toEqual([
      ["parent", undefined],
      ["before", "The Book"],
      // A child waiting for its parent is emitted once the parent has come.
      ["after", "Later Book"],
      ["laterparent", undefined],
    ]);
    // Its position is still its own, as the whole-file parse gives it.
    expect(outcomes[2].position).toEqual(parseBibliographicFile(bibtex, "bibtex")[2].position);
    expect(outcomes[2].position).toEqual({ offset: 155, line: 3, column: 1 });
  });

  it("reads a child whose parent never comes at the end, and resolves a parent's own parent", async () => {
    const bibtex = [
      "@inbook{orphan, crossref = {nowhere}, title = {Orphan}}",
      "@mvbook{set, title = {The Set}, publisher = {Pub}}",
      "@book{volume, crossref = {set}, title = {Volume One}}",
      "@inbook{chapter, crossref = {volume}, title = {Chapter}}",
    ].join("\n");
    const outcomes = await streamed(bibtex, 9, "bibtex", { mode: "lenient" });
    // The orphan waits for its parent until the end of the input, so it comes last.
    expect(outcomes.map((outcome) => outcome.position?.line)).toEqual([2, 3, 4, 1]);
    const byLine = Array.sortWith(
      outcomes,
      (outcome) => outcome.position?.offset ?? 0,
      Order.Number,
    );
    expect(byLine).toEqual(parseBibliographicFile(bibtex, "bibtex", { mode: "lenient" }));
  });

  it("ends with one truncated outcome at the record cap", async () => {
    expect(
      (await streamed(BIBTEX, 16, "bibtex", { mode: "lenient", maxRecords: 2 })).map((outcome) =>
        outcome.outcome === "skipped" ? outcome.reason : outcome.outcome,
      ),
    ).toEqual(["parsed", "parsed", "truncated"]);
  });

  it("fails with InputTooLarge when one entry outgrows the input cap", async () => {
    const huge = `@book{k, title = {${"x".repeat(200)}}}`;
    const exit = await runTestExit(
      Stream.runCollect(
        parseBibliographicStream(chunked(huge, 10), "bibtex", { maxInputLength: 100 }),
      ),
    );
    expect(exit).toEqual(
      Exit.fail(
        new InputTooLarge({
          format: "bibtex",
          maxInputLength: 100,
          message: "The bibtex input is longer than 100 characters",
        }),
      ),
    );
    const whole = await runTestExit(
      Stream.runCollect(
        parseBibliographicStream(chunked(huge, 1000), "bibtex", { maxInputLength: 100 }),
      ),
    );
    expect(Exit.isFailure(whole)).toBe(true);
    // A long stream of small entries is not too large.
    const many = Array.makeBy(50, (index) => `@misc{k${index}, title = {T}}`).join("\n");
    expect(
      await streamed(many, 7, "bibtex", { mode: "lenient", maxInputLength: 100 }),
    ).toHaveLength(50);
  });

  it("reads a CSV header without a title column as one malformed outcome", async () => {
    expect(await streamed("author,year\nA,2000\n", 3, "csv")).toEqual([
      { outcome: "skipped", reason: "malformed" },
    ]);
    expect(await streamed("", 3, "csv")).toEqual([]);
  });

  it("reads CSL-JSON and CSL YAML whole, within the cap", async () => {
    const json = '[{"type": "book", "title": "T", "ISBN": "9780062316097"}]';
    expect(await streamed(json, 5, "zotero-json")).toEqual(
      parseBibliographicFile(json, "zotero-json"),
    );
    const yaml = "references:\n- type: book\n  title: T\n  ISBN: '9780062316097'\n";
    expect(await streamed(yaml, 5, "csl-yaml")).toEqual(parseBibliographicFile(yaml, "csl-yaml"));
    expect(
      Exit.isFailure(
        await runTestExit(
          Stream.runCollect(
            parseBibliographicStream(chunked(json, 5), "zotero-json", { maxInputLength: 10 }),
          ),
        ),
      ),
    ).toBe(true);
  });

  it("passes the source stream's own failure through", async () => {
    const failing = Stream.concat(
      Stream.make("@misc{a, title = {T}}\n"),
      Stream.fail("read error" as const),
    );
    const exit = await runTestExit(
      Stream.runCollect(parseBibliographicStream(failing, "bibtex", { mode: "lenient" })),
    );
    expect(exit).toEqual(Exit.fail("read error"));
  });
});

describe("parseBibliographic", () => {
  it("returns the outcomes of an input within the cap", async () => {
    expect(await runTest(parseBibliographic(RIS, "ris"))).toEqual(
      parseBibliographicFile(RIS, "ris"),
    );
  });

  it("fails with InputTooLarge over the cap, instead of a too-large outcome", async () => {
    const exit = await runTestExit(parseBibliographic(RIS, "ris", { maxInputLength: 10 }));
    expect(exit).toEqual(
      Exit.fail(
        new InputTooLarge({
          format: "ris",
          maxInputLength: 10,
          message: "The ris input is longer than 10 characters",
        }),
      ),
    );
  });
});
