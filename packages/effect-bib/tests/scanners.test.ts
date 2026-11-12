/**
 * Edge cases of the single-pass scanners (the CSV cell and row readers, the
 * streaming splitter's row and entry-delimiter scans, the YAML flow and block
 * readers), pinned to what the character-by-character loops they replaced
 * read: CRLF, `""` escapes, a quote at the end of the input, an unterminated
 * quote, an empty trailing row, nested flow collections and inputs long
 * enough that a recursion per item or an element per character would fail.
 *
 * @module tests/unit/scanners
 */

import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";
import {
  parseBibliographicStream,
  parseBibtex,
  parseCsv,
  parseCslYaml,
  type ParseOptions,
  type ParseOutcome,
} from "@thomasfosterau/effect-bib";
import { rowBreak } from "../src/csv-rows.ts";

/** Each outcome as `[title, publisher, line]`, or `[outcome, reason]` for a skipped one. */
const summary = (outcomes: readonly ParseOutcome[]) =>
  outcomes.map((outcome) =>
    outcome.outcome === "parsed"
      ? [outcome.record.title, outcome.record.publisher ?? null, outcome.position?.line ?? null]
      : [outcome.outcome, outcome.reason],
  );

/** A lenient CSV parse of `body` under a `title,publisher` header. */
const csv = (body: string, options: ParseOptions = {}) =>
  summary(parseCsv(`title,publisher${body}`, { mode: "lenient", ...options }));

describe("CSV cells", () => {
  it("reads a doubled quote inside a quoted cell as one quote", () => {
    expect(csv('\n"A ""quoted"" title",P')).toEqual([['A "quoted" title', "P", 2]]);
    expect(csv('\n"""a",P')).toEqual([['"a', "P", 2]]);
  });

  it("opens a quote in the middle of a cell", () => {
    expect(csv('\nab"c,d"e,P')).toEqual([["abc,de", "P", 2]]);
  });

  it("drops an unterminated quote's cell boundary and a quote at the end of the input", () => {
    expect(csv('\nA,"')).toEqual([["A", null, 2]]);
    expect(csv('\nA,P\n"B,Q\nC,R')).toEqual([
      ["A", "P", 2],
      ["B,Q C,R", null, 3],
    ]);
  });

  it("reads a hostile line of alternating quotes and text in the time of its length", () => {
    const line = '"a'.repeat(1_000_000);
    expect(parseCsv(`title,publisher\n${line}`, { mode: "lenient" })).toHaveLength(1);
    expect(parseCsv(`title,publisher\n${",".repeat(1_000_000)}`, { mode: "lenient" })).toHaveLength(
      1,
    );
  });
});

describe("CSV rows", () => {
  it("ends a row at CRLF, CR or LF and skips empty rows", () => {
    expect(csv("\r\nA,P\r\nB,Q\r\n\r\nC,R\r\n")).toEqual([
      ["A", "P", 2],
      ["B", "Q", 3],
      ["C", "R", 5],
    ]);
    expect(csv("\rA,P\rB,Q")).toEqual([
      ["A", "P", 2],
      ["B", "Q", 3],
    ]);
  });

  it("keeps a line break inside quotes in its row", () => {
    expect(csv('\n"A\nB",P\nC,Q')).toEqual([
      ["A B", "P", 2],
      ["C", "Q", 4],
    ]);
  });

  it("keeps a row that is open at the end of the input", () => {
    expect(csv('\nA,P\n"B')).toEqual([
      ["A", "P", 2],
      ["B", null, 3],
    ]);
  });

  it("keeps an empty-celled trailing row as a record only when it has a title", () => {
    expect(csv("\nA,P\n,\n")).toEqual([
      ["A", "P", 2],
      [undefined, null, 3],
    ]);
    expect(csv("\nA,\n")).toEqual([["A", null, 2]]);
  });

  it("stops past the record cap", () => {
    expect(csv("\nA,P\nB,Q\nC,R\nD,S\nE,T", { maxRecords: 2 })).toEqual([
      ["A", "P", 2],
      ["B", "Q", 3],
      ["skipped", "truncated"],
    ]);
  });

  it("finds the first break outside quotes, or none while a quote is open", () => {
    expect(Option.getOrUndefined(rowBreak('a,"b\nc",d\r\ne', 0))).toEqual([9, 11]);
    expect(Option.getOrUndefined(rowBreak('a,"b""\n"\nz', 0))).toEqual([8, 9]);
    expect(Option.getOrUndefined(rowBreak("a\rb", 0))).toEqual([1, 2]);
    expect(Option.getOrUndefined(rowBreak('a,"b\nc', 0))).toEqual(undefined);
    expect(Option.getOrUndefined(rowBreak("abc", 0))).toEqual(undefined);
    expect(Option.getOrUndefined(rowBreak("x\ny\nz", 2))).toEqual([3, 4]);
  });
});

describe("streaming splits", () => {
  /** The outcomes of streaming `text` in chunks of `size` characters. */
  const streamed = (text: string, size: number, format: "bibtex" | "csv") =>
    Effect.map(
      Stream.runCollect(
        parseBibliographicStream(
          Stream.fromIterable(
            Arr.makeBy(Math.ceil(text.length / size), (index) =>
              text.slice(index * size, (index + 1) * size),
            ),
          ),
          format,
          { mode: "lenient" },
        ),
      ),
      summary,
    );

  it.effect("closes a parenthesised entry at its parenthesis and a braced one at its brace", () =>
    Effect.gen(function* () {
      const text =
        "@book(a, title = {One (1)}, isbn = {9780199695836})\n@book{b, title = {Two {x}}, isbn = {9780062316097}}\n";
      const whole = summary(parseBibtex(text, { mode: "lenient" }));
      expect(whole).toHaveLength(2);
      expect(
        yield* Effect.forEach([1, 3, 7, 1000], (size) => streamed(text, size, "bibtex"), {
          concurrency: "unbounded",
        }),
      ).toEqual([whole, whole, whole, whole]);
    }),
  );

  it.effect("holds an entry back until its closing delimiter arrives", () =>
    Effect.gen(function* () {
      const text = "@book{a, title = {One {nested}}, isbn = {9780199695836}}";
      expect(yield* streamed(text, 5, "bibtex")).toEqual(
        summary(parseBibtex(text, { mode: "lenient" })),
      );
    }),
  );

  it.effect("reads CSV rows with quoted line breaks however the input is cut", () =>
    Effect.gen(function* () {
      const text = 'title,publisher\n"A\r\nB",P\r\nC,"Q ""x"""\n';
      const whole = summary(parseCsv(text, { mode: "lenient" }));
      expect(whole).toHaveLength(2);
      expect(
        yield* Effect.forEach([1, 2, 1000], (size) => streamed(text, size, "csv"), {
          concurrency: "unbounded",
        }),
      ).toEqual([whole, whole, whole]);
    }),
  );
});

describe("YAML collections", () => {
  /** A lenient parse of `source`: each outcome's title, authors and issued date, or its skip reason. */
  const yaml = (source: string) =>
    parseCslYaml(source, { mode: "lenient" }).map((outcome) =>
      outcome.outcome === "parsed"
        ? [outcome.record.title, outcome.record.author ?? null, outcome.record.issued ?? null]
        : [outcome.outcome, outcome.reason],
    );

  it("reads nested flow collections and quoted items with commas", () => {
    expect(
      yaml(
        '- id: a\n  title: T\n  author: [{family: Doe, given: J}, {family: "Ro, e"}]\n  issued: {date-parts: [[2015, 3], [2016]]}\n',
      ),
    ).toEqual([
      [
        "T",
        [{ family: "Doe", given: "J" }, { family: "Ro, e" }],
        { "date-parts": [[2015, 3], [2016]] },
      ],
    ]);
  });

  it("rejects an unterminated flow collection and a missing separator", () => {
    expect(yaml("- id: a\n  title: T\n  author: [{family: Doe, given: [x\n")).toEqual([
      ["skipped", "malformed"],
    ]);
    expect(yaml("- id: a\n  title: T\n  author: [{family: Doe} {family: X}]\n")).toEqual([
      ["skipped", "malformed"],
    ]);
  });

  it("reads a block sequence of sequences and several entries", () => {
    expect(
      yaml(
        "references:\n- id: a\n  title: T\n  issued:\n    date-parts:\n    - - 2015\n      - 3\n- id: b\n  title: U\n",
      ),
    ).toEqual([
      ["T", null, { "date-parts": [[2015, 3]] }],
      ["U", null, null],
    ]);
  });

  it("reads a long flow list and a long block sequence without recursing per item", () => {
    const flow = `- id: a\n  title: T\n  keyword: [${Arr.makeBy(50_000, (n) => `k${n}`).join(", ")}]\n`;
    const block = Arr.makeBy(2000, (n) => `- id: b${n}\n  title: U${n}`).join("\n");
    expect(parseCslYaml(flow, { mode: "lenient" })).toHaveLength(1);
    expect(parseCslYaml(block, { mode: "lenient" })).toHaveLength(2000);
  });
  it("reads a long block sequence in linear time", () => {
    /** The fastest of three runs, in milliseconds, of a parse of `count` short entries. */
    const best = (count: number): number => {
      const source = Arr.makeBy(count, (n) => `- e${n}`).join("\n");
      return Math.min(
        ...Arr.makeBy(3, () => {
          const start = performance.now();
          parseCslYaml(source, { mode: "lenient" });
          return performance.now() - start;
        }),
      );
    };
    best(1000);
    const small = best(5000);
    const large = best(50_000);
    // Ten times the entries costs about ten times as long; a slice per entry
    // would cost about a hundred times. The bound is far from both.
    expect(large / Math.max(small, 1)).toBeLessThan(40);
  });
});
