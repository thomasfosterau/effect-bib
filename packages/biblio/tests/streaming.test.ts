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
  type ParseOutcome,
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

describe("parseBibliographicStream's bounds", () => {
  /** The stream's outcomes for `parts`, one chunk each. */
  const fromParts = (parts: readonly string[], format: ImportFormat, options: ParseOptions) =>
    runTest(
      Stream.runCollect(parseBibliographicStream(Stream.fromIterable(parts), format, options)),
    );

  it("shares one macro-expansion budget across the stream, as the whole-file parse spends one", async () => {
    const macros = [
      `@string{a = "${"x".repeat(1000)}"}`,
      `@string{b = ${Array.makeBy(50, () => "a").join(" # ")}}`,
    ];
    const entries = Array.makeBy(200, (index) => `@misc{k${index}, title = b}`);
    const titled = (outcomes: readonly ParseOutcome[]) =>
      outcomes.filter(
        (outcome) => outcome.outcome === "parsed" && outcome.record.title !== undefined,
      ).length;
    const whole = parseBibliographicFile([...macros, ...entries].join("\n"), "bibtex", {
      mode: "lenient",
    });
    const streamedOutcomes = await fromParts(
      [`${macros.join("\n")}\n`, ...entries.map((entry) => `${entry}\n`)],
      "bibtex",
      { mode: "lenient" },
    );
    expect(streamedOutcomes).toHaveLength(200);
    // Each title expands 50 000 characters: the budget runs out part-way,
    // in the stream as in the whole file, rather than once per chunk. The
    // stream spends at least as much as the whole file (each batch re-reads
    // the macro definitions it uses), never a fresh budget per batch.
    expect(titled(whole)).toBeLessThan(200);
    expect(titled(streamedOutcomes)).toBeGreaterThan(0);
    expect(titled(streamedOutcomes)).toBeLessThanOrEqual(titled(whole));
  });

  it("fails a whole-read format as soon as it passes the cap, without reading on", async () => {
    const chunks = Stream.concat(
      Stream.fromIterable(Array.makeBy(10, () => "[".padEnd(50, " "))),
      Stream.fail("read past the cap" as const),
    );
    const exit = await runTestExit(
      Stream.runCollect(parseBibliographicStream(chunks, "zotero-json", { maxInputLength: 100 })),
    );
    expect(exit).toEqual(
      Exit.fail(
        new InputTooLarge({
          format: "zotero-json",
          maxInputLength: 100,
          message: "The zotero-json input is longer than 100 characters",
        }),
      ),
    );
  });

  it("evicts cross-reference parents by length, and never holds more than the cap", async () => {
    const big = (key: string) => `@book{${key}, title = {${key}}, note = {${"n".repeat(400)}}}`;
    const parts = [
      big("parent"),
      big("other1"),
      big("other2"),
      big("other3"),
      "@inbook{child, crossref = {parent}, title = {Child}}",
    ].map((part) => `${part}\n`);
    const outcomes = await fromParts(parts, "bibtex", { mode: "lenient", maxInputLength: 1000 });
    const child = outcomes.find(
      (outcome) => outcome.outcome === "parsed" && outcome.record.id === "child",
    );
    // The parent was pushed out of the 1000-character window by the entries after it.
    expect(
      child?.outcome === "parsed" ? child.record["container-title"] : "missing",
    ).toBeUndefined();
    expect(outcomes).toHaveLength(5);
  });

  it("reads children without their parent once the stream's context budget is spent", async () => {
    const parent = `@book{parent, title = {Parent}, note = {${"n".repeat(1400)}}}\n`;
    const children = Array.makeBy(
      40,
      (index) => `@inbook{c${index}, crossref = {parent}, title = {C}}\n`,
    );
    const outcomes = await fromParts([parent, ...children], "bibtex", {
      mode: "lenient",
      maxInputLength: 2000,
    });
    const inherited = outcomes.map((outcome) =>
      outcome.outcome === "parsed" && outcome.record.id !== "parent"
        ? outcome.record["container-title"] === "Parent"
        : undefined,
    );
    expect(inherited.filter((value) => value === true).length).toBeGreaterThan(0);
    expect(inherited[inherited.length - 1]).toBe(false);
  });

  /** Milliseconds `run` takes. */
  const elapsed = async (run: () => Promise<void>): Promise<number> => {
    const start = performance.now();
    await run();
    return performance.now() - start;
  };

  it("finds context by name, so many macros and many entries stay linear", async () => {
    const macros = Array.makeBy(60_000, (index) => `@string{m${index} = "Value ${index}"}`).join(
      "\n",
    );
    const entries = Array.makeBy(
      15_000,
      (index) => `@misc{k${index}, title = {T}, publisher = m${index % 7}}`,
    ).join("\n");
    const text = `${macros}\n${entries}\n`;
    let outcomes: readonly ParseOutcome[] = [];
    const ms = await elapsed(async () => {
      outcomes = await streamed(text, 65_536, "bibtex", { mode: "lenient", maxRecords: 100_000 });
    });
    // Before context was found by name this took about six minutes.
    expect(ms).toBeLessThan(20_000);
    expect(outcomes).toHaveLength(15_000);
    const last = outcomes[outcomes.length - 1];
    expect(last.outcome === "parsed" ? last.record.publisher : undefined).toBe("Value 5");
  });

  it("finds a large parent's context once per batch, not once per child", async () => {
    const parent = `@book{parent, title = {Parent}, note = {${"n word ".repeat(150_000)}}}\n`;
    const children = Array.makeBy(
      20_000,
      (index) => `@inbook{c${index}, crossref = {parent}, title = {C}}`,
    ).join("\n");
    let outcomes: readonly ParseOutcome[] = [];
    const ms = await elapsed(async () => {
      outcomes = await streamed(`${parent}${children}\n`, 65_536, "bibtex", {
        mode: "lenient",
        maxRecords: 100_000,
      });
    });
    expect(ms).toBeLessThan(20_000);
    expect(outcomes).toHaveLength(20_001);
  });

  it("uses a macro's latest definition, and keeps a key's latest parent when an older one leaves the window", async () => {
    // The window holds 1000 entries: the child and these push out the old `p` but not the new one.
    const fillers = Array.makeBy(998, (index) => `@misc{f${index}, title = {F}}`);
    const parts = [
      '@string{pub = "First"}',
      '@string{inner = "Inner"}',
      '@string{pub = inner # " Second"}',
      "@book{p, title = {Old Parent}}",
      "@book{p, title = {New Parent}}",
      ...fillers,
      "@inbook{child, crossref = {p}, publisher = pub, note = undefinedmacro}",
    ].map((part) => `${part}\n`);
    const outcomes = await fromParts(parts, "bibtex", { mode: "lenient" });
    const child = outcomes.find(
      (outcome) => outcome.outcome === "parsed" && outcome.record.id === "child",
    );
    expect(child?.outcome === "parsed" ? child.record.publisher : undefined).toBe("Inner Second");
    expect(child?.outcome === "parsed" ? child.record["container-title"] : undefined).toBe(
      "New Parent",
    );
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
