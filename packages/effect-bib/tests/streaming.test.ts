/**
 * Unit tests for the Effect and Stream front ends (`src/streaming.ts`):
 * `parseBibliographic` fails on a typed `InputTooLarge`, and
 * `parseBibliographicStream` yields the whole-file parse's outcomes and
 * positions however the input is cut into chunks.
 *
 * @module tests/unit/biblio-streaming
 */

import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";
import {
  type ImportFormat,
  InputTooLarge,
  parseBibliographic,
  parseBibliographicFile,
  parseBibliographicStream,
  type ParseOptions,
  type ParseOutcome,
} from "@thomasfosterau/effect-bib";

/** `text` cut into chunks of `size` characters. */
const chunked = (text: string, size: number): Stream.Stream<string> =>
  Stream.fromIterable(
    Arr.makeBy(Math.max(1, Math.ceil(text.length / size)), (index) =>
      text.slice(index * size, (index + 1) * size),
    ),
  );

/** The stream's outcomes for `text` cut into chunks of `size`. */
const streamed = (text: string, size: number, format: ImportFormat, options: ParseOptions = {}) =>
  Stream.runCollect(parseBibliographicStream(chunked(text, size), format, options));

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

/** `text` cut after each index in `cuts`, as a stream of chunks. */
const cutAt = (text: string, cuts: readonly number[]): Stream.Stream<string> => {
  const bounds = [0, ...Arr.sort(Arr.dedupe(cuts), Order.Number), text.length];
  return Stream.fromIterable(
    Arr.zipWith(bounds, bounds.slice(1), (from, to) => text.slice(from, to)),
  );
};

/** The indices between the CR and the LF of every CRLF. */
const insideCrlf = (text: string): number[] =>
  Arr.fromIterable(text.matchAll(/\r\n/g)).map((match) => match.index + 1);

/** A deterministic pseudo-random sequence of `count` cut points in `[1, length)`. */
const randomCuts = (length: number, count: number, seed: number): number[] =>
  Arr.unfold({ n: 0, state: seed }, ({ n, state }) => {
    const next = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    return n < count
      ? Option.some([1 + (next % (length - 1)), { n: n + 1, state: next }] as const)
      : Option.none();
  });

describe("parseBibliographicStream", () => {
  it.effect.each([
    ["bibtex", BIBTEX],
    ["ris", RIS],
    ["csv", CSV],
  ] as const)(
    "yields the whole-file %s outcomes, positions included, for every chunk size",
    ([format, text]) =>
      Effect.gen(function* () {
        const whole = parseBibliographicFile(text, format, { mode: "lenient" });
        const sizes = [1, 2, 7, 64, text.length];
        const results = yield* Effect.forEach(
          sizes,
          (size) => streamed(text, size, format, { mode: "lenient" }),
          { concurrency: "unbounded" },
        );
        Arr.forEach(results, (result, index) => {
          expect(result, `chunks of ${sizes[index]}`).toEqual(whole);
        });
      }),
  );

  describe("a CRLF split across chunks", () => {
    it.effect.each([
      [
        "csv",
        [
          "title,isbn",
          "A,9780062316097",
          '"B\r\nC",9780062316097',
          "",
          "D,9780199695836",
          "E,not-an-isbn",
          "F,9780062316097",
        ].join("\r\n"),
      ],
      ["ris", RIS],
      ["bibtex", BIBTEX.replaceAll("\n", "\r\n")],
    ] as const)("keeps %s positions and outcomes those of the whole-file parse", ([format, text]) =>
      Effect.gen(function* () {
        const whole = parseBibliographicFile(text, format, { mode: "lenient" });
        const run = (cuts: readonly number[]) =>
          Stream.runCollect(
            parseBibliographicStream(cutAt(text, cuts), format, { mode: "lenient" }),
          );
        // Every CRLF cut between its CR and its LF, at once and one at a time.
        const breaks = insideCrlf(text);
        expect(breaks.length).toBeGreaterThan(3);
        expect(yield* run(breaks)).toEqual(whole);
        const single = yield* Effect.forEach(breaks, (cut) => run([cut]), {
          concurrency: "unbounded",
        });
        Arr.forEach(single, (result) => expect(result).toEqual(whole));
        // And at random points, some of which fall between a CR and its LF.
        const random = yield* Effect.forEach(
          Arr.makeBy(20, (seed) => seed + 1),
          (seed) => run(randomCuts(text.length, 12, seed)),
          { concurrency: "unbounded" },
        );
        Arr.forEach(random, (result) => expect(result).toEqual(whole));
      }),
    );
  });

  it.effect("yields the whole-file outcomes for parenthesised entries, for every chunk size", () =>
    Effect.gen(function* () {
      const text = [
        '@string(ups = "Oxford University Press")',
        "@book(oxford, title = {The (Oxford) Handbook}, publisher = ups, isbn = {9780199695836})",
        "@comment(an aside)",
        "@article{kuhn, title = {The Structure}, doi = {10.1037/0003-066X.59.1.29}}",
      ].join("\n");
      const whole = parseBibliographicFile(text, "bibtex", { mode: "lenient" });
      expect(whole.map((outcome) => outcome.outcome)).toEqual(["parsed", "parsed"]);
      const sizes = [1, 2, 7, 64, text.length];
      const results = yield* Effect.forEach(
        sizes,
        (size) => streamed(text, size, "bibtex", { mode: "lenient" }),
        { concurrency: "unbounded" },
      );
      Arr.forEach(results, (result, index) => {
        expect(result, `chunks of ${sizes[index]}`).toEqual(whole);
      });
    }),
  );

  it.effect("reads a child with a parent that came before, and one whose parent comes after", () =>
    Effect.gen(function* () {
      const bibtex = [
        "@book{parent, title = {The Book}, publisher = {Pub}, isbn = {9780199695836}}",
        "@inbook{before, crossref = {parent}, title = {Early}, doi = {10.1000/xyz123}}",
        "@inbook{after, crossref = {laterparent}, title = {Late}, doi = {10.1000/xyz124}}",
        "@book{laterparent, title = {Later Book}, publisher = {Pub2}, isbn = {9780062316097}}",
      ].join("\n");
      const outcomes = yield* streamed(bibtex, 10, "bibtex");
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
    }),
  );

  it.effect(
    "reads a child whose parent never comes at the end, and resolves a parent's own parent",
    () =>
      Effect.gen(function* () {
        const bibtex = [
          "@inbook{orphan, crossref = {nowhere}, title = {Orphan}}",
          "@mvbook{set, title = {The Set}, publisher = {Pub}}",
          "@book{volume, crossref = {set}, title = {Volume One}}",
          "@inbook{chapter, crossref = {volume}, title = {Chapter}}",
        ].join("\n");
        const outcomes = yield* streamed(bibtex, 9, "bibtex", { mode: "lenient" });
        // The orphan waits for its parent until the end of the input, so it comes last.
        expect(outcomes.map((outcome) => outcome.position?.line)).toEqual([2, 3, 4, 1]);
        const byLine = Arr.sortWith(
          outcomes,
          (outcome) => outcome.position?.offset ?? 0,
          Order.Number,
        );
        expect(byLine).toEqual(parseBibliographicFile(bibtex, "bibtex", { mode: "lenient" }));
      }),
  );

  it.effect("ends with one truncated outcome at the record cap", () =>
    Effect.gen(function* () {
      expect(
        (yield* streamed(BIBTEX, 16, "bibtex", { mode: "lenient", maxRecords: 2 })).map((outcome) =>
          outcome.outcome === "skipped" ? outcome.reason : outcome.outcome,
        ),
      ).toEqual(["parsed", "parsed", "truncated"]);
    }),
  );

  it.effect("fails with InputTooLarge when one entry outgrows the input cap", () =>
    Effect.gen(function* () {
      const huge = `@book{k, title = {${"x".repeat(200)}}}`;
      const exit = yield* Effect.exit(
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
      const whole = yield* Effect.exit(
        Stream.runCollect(
          parseBibliographicStream(chunked(huge, 1000), "bibtex", { maxInputLength: 100 }),
        ),
      );
      expect(Exit.isFailure(whole)).toBe(true);
      // A long stream of small entries is not too large.
      const many = Arr.makeBy(50, (index) => `@misc{k${index}, title = {T}}`).join("\n");
      expect(
        yield* streamed(many, 7, "bibtex", { mode: "lenient", maxInputLength: 100 }),
      ).toHaveLength(50);
    }),
  );

  it.effect("reads a CSV header without a title column as one malformed outcome", () =>
    Effect.gen(function* () {
      expect(yield* streamed("author,year\nA,2000\n", 3, "csv")).toEqual([
        { outcome: "skipped", reason: "malformed" },
      ]);
      expect(yield* streamed("", 3, "csv")).toEqual([]);
    }),
  );

  it.effect("reads CSL-JSON and CSL YAML whole, within the cap", () =>
    Effect.gen(function* () {
      const json = '[{"type": "book", "title": "T", "ISBN": "9780062316097"}]';
      expect(yield* streamed(json, 5, "zotero-json")).toEqual(
        parseBibliographicFile(json, "zotero-json"),
      );
      const yaml = "references:\n- type: book\n  title: T\n  ISBN: '9780062316097'\n";
      expect(yield* streamed(yaml, 5, "csl-yaml")).toEqual(
        parseBibliographicFile(yaml, "csl-yaml"),
      );
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            Stream.runCollect(
              parseBibliographicStream(chunked(json, 5), "zotero-json", { maxInputLength: 10 }),
            ),
          ),
        ),
      ).toBe(true);
    }),
  );

  it.effect("passes the source stream's own failure through", () =>
    Effect.gen(function* () {
      const failing = Stream.concat(
        Stream.make("@misc{a, title = {T}}\n"),
        Stream.fail("read error" as const),
      );
      const exit = yield* Effect.exit(
        Stream.runCollect(parseBibliographicStream(failing, "bibtex", { mode: "lenient" })),
      );
      expect(exit).toEqual(Exit.fail("read error"));
    }),
  );
});

/** The stream's outcomes for `parts`, one chunk each. */
const fromParts = (parts: readonly string[], format: ImportFormat, options: ParseOptions) =>
  Stream.runCollect(parseBibliographicStream(Stream.fromIterable(parts), format, options));

/** How many outcomes parsed with a title. */
const titled = (outcomes: readonly ParseOutcome[]) =>
  outcomes.filter((outcome) => outcome.outcome === "parsed" && outcome.record.title !== undefined)
    .length;

/** A BibTeX book entry padded so a few of them exceed a chunk. */
const big = (key: string) => `@book{${key}, title = {${key}}, note = {${"n".repeat(400)}}}`;

/** `effect`'s result and the milliseconds it took (real time: run it under `it.live`). */
const timed = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.timed(effect), ([duration, outcomes]) => ({
    ms: Duration.toMillis(duration),
    outcomes,
  }));

/** A CSV document with `rows` data rows. */
const csv = (rows: number): string =>
  ["title,isbn", ...Arr.makeBy(rows, (index) => `Title ${index},9780062316097`)].join("\n");

describe("parseBibliographicStream's bounds", () => {
  it.effect(
    "shares one macro-expansion budget across the stream, as the whole-file parse spends one",
    () =>
      Effect.gen(function* () {
        const macros = [
          `@string{a = "${"x".repeat(1000)}"}`,
          `@string{b = ${Arr.makeBy(50, () => "a").join(" # ")}}`,
        ];
        const entries = Arr.makeBy(200, (index) => `@misc{k${index}, title = b}`);
        const whole = parseBibliographicFile([...macros, ...entries].join("\n"), "bibtex", {
          mode: "lenient",
        });
        const streamedOutcomes = yield* fromParts(
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
      }),
  );

  it.effect("fails a whole-read format as soon as it passes the cap, without reading on", () =>
    Effect.gen(function* () {
      const chunks = Stream.concat(
        Stream.fromIterable(Arr.makeBy(10, () => "[".padEnd(50, " "))),
        Stream.fail("read past the cap" as const),
      );
      const exit = yield* Effect.exit(
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
    }),
  );

  it.effect("evicts cross-reference parents by length, and never holds more than the cap", () =>
    Effect.gen(function* () {
      const parts = [
        big("parent"),
        big("other1"),
        big("other2"),
        big("other3"),
        "@inbook{child, crossref = {parent}, title = {Child}}",
      ].map((part) => `${part}\n`);
      const outcomes = yield* fromParts(parts, "bibtex", { mode: "lenient", maxInputLength: 1000 });
      const child = outcomes.find(
        (outcome) => outcome.outcome === "parsed" && outcome.record.id === "child",
      );
      // The parent was pushed out of the 1000-character window by the entries after it.
      expect(
        child?.outcome === "parsed" ? child.record["container-title"] : "missing",
      ).toBeUndefined();
      expect(outcomes).toHaveLength(5);
    }),
  );

  it.effect("reads children without their parent once the stream's context budget is spent", () =>
    Effect.gen(function* () {
      const parent = `@book{parent, title = {Parent}, note = {${"n".repeat(1400)}}}\n`;
      const children = Arr.makeBy(
        40,
        (index) => `@inbook{c${index}, crossref = {parent}, title = {C}}\n`,
      );
      const outcomes = yield* fromParts([parent, ...children], "bibtex", {
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
    }),
  );

  it.live("finds each outcome's start in linear time, however many entries one chunk holds", () =>
    Effect.gen(function* () {
      const options = {
        mode: "lenient",
        maxRecords: 1_000_000,
        maxInputLength: 10_000_000,
      } as const;
      const run = (rows: number) =>
        Effect.gen(function* () {
          const text = csv(rows);
          // One chunk: the whole text is a single batch of `rows` entries.
          const { ms, outcomes } = yield* timed(streamed(text, text.length, "csv", options));
          expect(outcomes).toHaveLength(rows);
          return ms;
        });
      yield* run(5000);
      const small = yield* run(20_000);
      const large = yield* run(200_000);
      // Ten times the entries costs about ten times as long when each lookup is
      // constant, about a hundred times when it scans the batch. The floor keeps
      // a fast small run from inflating the ratio on a noisy runner.
      expect(large / Math.max(small, 50)).toBeLessThan(40);
    }),
  );

  it.live("finds context by name, so many macros and many entries stay linear", () =>
    Effect.gen(function* () {
      const macros = Arr.makeBy(60_000, (index) => `@string{m${index} = "Value ${index}"}`).join(
        "\n",
      );
      const entries = Arr.makeBy(
        15_000,
        (index) => `@misc{k${index}, title = {T}, publisher = m${index % 7}}`,
      ).join("\n");
      const text = `${macros}\n${entries}\n`;
      const { ms, outcomes } = yield* timed(
        streamed(text, 65_536, "bibtex", { mode: "lenient", maxRecords: 100_000 }),
      );
      // Before context was found by name this took about six minutes.
      expect(ms).toBeLessThan(20_000);
      expect(outcomes).toHaveLength(15_000);
      const last = outcomes[outcomes.length - 1];
      expect(last.outcome === "parsed" ? last.record.publisher : undefined).toBe("Value 5");
    }),
  );

  it.live("finds a large parent's context once per batch, not once per child", () =>
    Effect.gen(function* () {
      const parent = `@book{parent, title = {Parent}, note = {${"n word ".repeat(150_000)}}}\n`;
      const children = Arr.makeBy(
        20_000,
        (index) => `@inbook{c${index}, crossref = {parent}, title = {C}}`,
      ).join("\n");
      const { ms, outcomes } = yield* timed(
        streamed(`${parent}${children}\n`, 65_536, "bibtex", {
          mode: "lenient",
          maxRecords: 100_000,
        }),
      );
      expect(ms).toBeLessThan(20_000);
      expect(outcomes).toHaveLength(20_001);
    }),
  );

  it.effect(
    "reads the first of two parents with one key, as the whole-file parse does, for every chunk size",
    () =>
      Effect.gen(function* () {
        const text = [
          "@book{p, title = {Old Parent}}",
          "@book{p, title = {New Parent}}",
          "@inbook{child, crossref = {p}}",
        ].join("\n");
        const whole = parseBibliographicFile(text, "bibtex", { mode: "lenient" });
        const child = whole.find(
          (outcome) => outcome.outcome === "parsed" && outcome.record.id === "child",
        );
        expect(child?.outcome === "parsed" ? child.record["container-title"] : undefined).toBe(
          "Old Parent",
        );
        const sizes = [1, 2, 7, 64, text.length];
        const results = yield* Effect.forEach(
          sizes,
          (size) => streamed(text, size, "bibtex", { mode: "lenient" }),
          { concurrency: "unbounded" },
        );
        Arr.forEach(results, (result, index) => {
          expect(result, `chunks of ${sizes[index]}`).toEqual(whole);
        });
      }),
  );

  it.effect(
    "falls back to a key's next parent in the window when the first leaves it, then forgets the key",
    () =>
      Effect.gen(function* () {
        // A window of 1000: `p` (Old) is pushed out by the entries after it; `p` (New) is still in.
        const fillers = Arr.makeBy(997, (index) => `@misc{f${index}, title = {F}}`);
        const parts = [
          "@book{p, title = {Old Parent}}",
          "@book{p, title = {New Parent}}",
          ...fillers,
          "@misc{g, title = {G}}",
          "@inbook{child, crossref = {p}}",
          ...Arr.makeBy(1000, (index) => `@misc{h${index}, title = {H}}`),
          "@inbook{orphan, crossref = {p}}",
        ].map((part) => `${part}\n`);
        const outcomes = yield* fromParts(parts, "bibtex", { mode: "lenient" });
        const container = (id: string) => {
          const found = outcomes.find(
            (outcome) => outcome.outcome === "parsed" && outcome.record.id === id,
          );
          return found?.outcome === "parsed" ? found.record["container-title"] : "missing";
        };
        expect(container("child")).toBe("New Parent");
        expect(container("orphan")).toBeUndefined();
      }),
  );

  it.effect(
    "uses a macro's latest definition, and a key's newer parent once the older one leaves the window",
    () =>
      Effect.gen(function* () {
        // The window holds 1000 entries: the child and these push out the old `p` but not the new one.
        const fillers = Arr.makeBy(998, (index) => `@misc{f${index}, title = {F}}`);
        const parts = [
          '@string{pub = "First"}',
          '@string{inner = "Inner"}',
          '@string{pub = inner # " Second"}',
          "@book{p, title = {Old Parent}}",
          "@book{p, title = {New Parent}}",
          ...fillers,
          "@inbook{child, crossref = {p}, publisher = pub, note = undefinedmacro}",
        ].map((part) => `${part}\n`);
        const outcomes = yield* fromParts(parts, "bibtex", { mode: "lenient" });
        const child = outcomes.find(
          (outcome) => outcome.outcome === "parsed" && outcome.record.id === "child",
        );
        expect(child?.outcome === "parsed" ? child.record.publisher : undefined).toBe(
          "Inner Second",
        );
        expect(child?.outcome === "parsed" ? child.record["container-title"] : undefined).toBe(
          "New Parent",
        );
      }),
  );
});

describe("parseBibliographic", () => {
  it.effect("returns the outcomes of an input within the cap", () =>
    Effect.gen(function* () {
      expect(yield* parseBibliographic(RIS, "ris")).toEqual(parseBibliographicFile(RIS, "ris"));
    }),
  );

  it.effect("fails with InputTooLarge over the cap, instead of a too-large outcome", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseBibliographic(RIS, "ris", { maxInputLength: 10 }));
      expect(exit).toEqual(
        Exit.fail(
          new InputTooLarge({
            format: "ris",
            maxInputLength: 10,
            message: "The ris input is longer than 10 characters",
          }),
        ),
      );
    }),
  );
});
