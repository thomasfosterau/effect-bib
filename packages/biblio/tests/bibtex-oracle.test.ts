/**
 * The BibTeX / BibLaTeX oracle (#91): `parseBibtex` against Pandoc's own
 * BibLaTeX → CSL reading of three external corpora — biber's test `.bib`
 * files and Better BibTeX's import fixtures (both vendored, with their
 * licences, under `tests/fixtures/bibtex/`), and Pandoc's `biblatex-*`
 * test cases (GPL: read from the checkout `vp run oracles:fetch` makes,
 * never vendored). Pandoc's CSL-JSON for every file is committed under
 * `tests/fixtures/bibtex/oracle/` (`scripts/pandoc-oracle.sh` regenerates
 * it).
 *
 * Each entry is compared field by field after the normalisation the
 * documented differences call for (titles case-folded, since Pandoc
 * sentence-cases English titles; markup stripped; dashes in page ranges
 * unified). Every remaining difference is listed in
 * `tests/fixtures/bibtex/divergences.json`, and the test pins that list
 * exactly: a new divergence fails, and so does one that went away (shrink
 * the list; `ORACLE_BASELINE=write` rewrites it). The categories behind the
 * list are documented in `tests/fixtures/bibtex/README.md`.
 *
 * Every corpus file, with or without an oracle, must also read totally:
 * no throw, one outcome per entry.
 *
 * @module tests/unit/biblio-bibtex-oracle
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as Array from "effect/Array";
import * as Function from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { type CslJsonItem, decodeIsbn, parseBibtex, toCslJson } from "@thomasfosterau/biblio";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "bibtex");
const pandocCases = path.join(here, "..", ".oracles", "pandoc", "test", "command");

/** The fields compared, and how: titles case-folded, names and dates structurally. */
const TEXT_FIELDS = [
  "publisher",
  "publisher-place",
  "volume",
  "issue",
  "number",
  "edition",
  "language",
  "note",
  "version",
  "status",
  "URL",
  "ISSN",
  "collection-number",
  "number-of-pages",
  "number-of-volumes",
  "chapter-number",
] as const;
const TITLE_FIELDS = [
  "title",
  "title-short",
  "container-title",
  "collection-title",
  "event-title",
  "original-title",
] as const;
const NAME_FIELDS = ["author", "editor", "translator", "container-author"] as const;
const DATE_FIELDS = ["issued", "accessed", "event-date", "original-date"] as const;

/** Decodes the few entities Pandoc's CSL-JSON writes. */
const unescape = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** A text value as compared: markup stripped, whitespace collapsed, NFC. */
// oxlint-disable-next-line effect/no-unknown-parameters -- compares the untyped CSL-JSON values of two sources (ours and Pandoc's); any value reads as text or nothing
const plain = (value: unknown): string =>
  Predicate.isString(value) || Predicate.isNumber(value)
    ? unescape(globalThis.String(value).replace(/<[^>]*>/g, ""))
        // Pandoc applies smart punctuation to straight quotes; compare both as straight.
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, " ")
        .trim()
        .normalize("NFC")
    : "";

/** One CSL item's comparable projection: field → canonical text. */
function projection(item: CslJsonItem): Record<string, string> {
  const fields: Array<readonly [string, string]> = [
    ...TEXT_FIELDS.map((key) => [key, plain(item[key])] as const),
    // CSL requires a type; Pandoc leaves an entry type it does not map untyped.
    ["type", plain(item.type) === "" ? "document" : plain(item.type)],
    // Pandoc lower-cases a genre it writes from a BibLaTeX key ("research report").
    ["genre", plain(item.genre).toLowerCase()],
    ...TITLE_FIELDS.map((key) => [key, plain(item[key]).toLowerCase()] as const),
    ["page", plain(item.page).replace(/[–—-]+/g, "-")],
    ["DOI", plain(item.DOI).toLowerCase()],
    // Ours is the canonical ISBN-13 of the first valid ISBN; Pandoc keeps the text.
    ["ISBN", Option.getOrElse(decodeIsbn(plain(item.ISBN)), () => plain(item.ISBN))],
    ...NAME_FIELDS.map((key) => [key, names(item[key])] as const),
    ...DATE_FIELDS.map((key) => [key, date(item[key])] as const),
  ];
  return Record.fromEntries(fields.filter(([, value]) => value !== ""));
}

const decodeNames = Schema.decodeUnknownOption(
  Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeDate = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

/** A name list as compared: each name's parts, markup stripped. */
// oxlint-disable-next-line effect/no-unknown-parameters -- an untyped CSL-JSON name list, decoded here
const names = (value: unknown): string =>
  Option.match(decodeNames(value), {
    onNone: () => "",
    onSome: (list) =>
      list
        .map((name) =>
          ["literal", "family", "given", "dropping-particle", "non-dropping-particle", "suffix"]
            // Pandoc spaces run-together initials ("T.S." → "T. S.").
            .map((part) => `${part}=${plain(name[part]).replace(/\.\s+(?=\p{Lu}\.)/gu, ".")}`)
            .filter((part) => !part.endsWith("="))
            .join(";"),
        )
        .join(" | "),
  });

/** A date as compared: its `date-parts`, else its literal or raw text. */
// oxlint-disable-next-line effect/no-unknown-parameters -- an untyped CSL-JSON date, decoded here
const date = (value: unknown): string =>
  Option.match(decodeDate(value), {
    onNone: () => "",
    onSome: (fields) =>
      fields["date-parts"] !== undefined
        ? globalThis.JSON.stringify(fields["date-parts"])
        : plain(fields.literal ?? fields.raw),
  });

/** The fields on which two projections differ (a field one side lacks included). */
function differences(ours: Record<string, string>, theirs: Record<string, string>): string[] {
  const keys = Array.dedupe([...Record.keys(ours), ...Record.keys(theirs)]);
  return Array.sortWith(
    keys.filter((key) => ours[key] !== theirs[key]),
    Function.identity,
    Order.String,
  );
}

/** One corpus file: its name, its BibTeX source, and Pandoc's reading of it when there is one. */
interface CorpusFile {
  readonly name: string;
  readonly source: string;
  readonly oracle: Option.Option<readonly CslJsonItem[]>;
}

const decodeOracle = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
);

/** Pandoc's committed reading of a corpus file. */
const oracleFor = (corpus: string, base: string): Option.Option<readonly CslJsonItem[]> => {
  const file = path.join(fixtures, "oracle", corpus, `${base}.json`);
  return fs.existsSync(file) ? decodeOracle(fs.readFileSync(file, "utf8")) : Option.none();
};

/** The `.bib` files of a vendored corpus. */
function vendored(corpus: string): CorpusFile[] {
  const dir = path.join(fixtures, corpus);
  return Array.sortWith(
    fs.readdirSync(dir).filter((file) => file.endsWith(".bib")),
    Function.identity,
    Order.String,
  ).map((file) => ({
    name: `${corpus}/${file}`,
    source: fs.readFileSync(path.join(dir, file), "utf8"),
    oracle: oracleFor(corpus, file.slice(0, -4)),
  }));
}

/** Pandoc's `biblatex-*` / `bibtex-*` cases, from the fetched checkout: each case's input. */
function pandoc(): CorpusFile[] {
  return Array.sortWith(
    fs.readdirSync(pandocCases).filter((file) => /^(?:biblatex|bibtex)-.*\.md$/.test(file)),
    Function.identity,
    Order.String,
  ).map((file) => {
    const text = fs.readFileSync(path.join(pandocCases, file), "utf8");
    const lines = text.split("\n");
    const start = lines.findIndex((line) => line.startsWith("% pandoc")) + 1;
    const end = lines.findIndex((line) => line === "^D");
    return {
      name: `pandoc/${file.slice(0, -3)}`,
      source: lines.slice(start, end).join("\n"),
      oracle: oracleFor("pandoc", file.slice(0, -3)),
    };
  });
}

/** Lenient parsing with bounds raised for test data, as a document's bibliography would read it. */
const read = (source: string) =>
  parseBibtex(source, { mode: "lenient", maxFieldLength: 64_000, maxAuthors: 1000 });

/** Every divergence of one file from its oracle: `file#id` → fields. */
function divergences(file: CorpusFile): Array<readonly [string, string[]]> {
  if (Option.isNone(file.oracle)) return [];
  const ours = Record.fromEntries(
    read(file.source).flatMap((outcome) =>
      outcome.outcome === "parsed"
        ? [[globalThis.String(outcome.record.id), projection(toCslJson(outcome.record))] as const]
        : [],
    ),
  );
  const theirs = Record.fromEntries(
    file.oracle.value.map((item) => [globalThis.String(item.id), projection(item)] as const),
  );
  const ids = Array.sortWith(
    Array.dedupe([...Record.keys(ours), ...Record.keys(theirs)]),
    Function.identity,
    Order.String,
  );
  return ids.flatMap((id) => {
    const mine = Record.get(ours, id).pipe(Option.getOrUndefined);
    const pandocs = Record.get(theirs, id).pipe(Option.getOrUndefined);
    const fields =
      mine === undefined
        ? ["(missing)"]
        : pandocs === undefined
          ? ["(extra)"]
          : differences(mine, pandocs);
    if (process.env.ORACLE_REPORT !== undefined && Array.isArrayNonEmpty(fields)) {
      fs.appendFileSync(
        process.env.ORACLE_REPORT,
        `${globalThis.JSON.stringify({ entry: `${file.name}#${id}`, fields, ours: mine, pandoc: pandocs })}\n`,
      );
    }
    return Array.isArrayNonEmpty(fields) ? [[`${file.name}#${id}`, fields] as const] : [];
  });
}

const baselineFile = path.join(fixtures, "divergences.json");
const decodeBaseline = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Array(Schema.String))),
);

/** The corpora: the vendored two always, Pandoc's cases when fetched (always under CI). */
function corpora(): CorpusFile[] {
  const fetched = fs.existsSync(pandocCases);
  if (!fetched && process.env.CI !== undefined) {
    expect.fail("Pandoc's test cases are missing: run `vp run oracles:fetch` first");
  }
  return [...vendored("biber"), ...vendored("better-bibtex"), ...(fetched ? pandoc() : [])];
}

describe("the BibTeX oracle corpus", () => {
  const files = corpora();

  it("reads every corpus file totally: one outcome per entry, no throw", () => {
    Array.forEach(files, (file) => {
      const outcomes = read(file.source);
      // An `@` that opens an entry (not `@string`, `@preamble` or `@comment`)
      // yields at most one outcome; nothing is lost silently beyond that.
      const entries = file.source.match(/@(?!string|preamble|comment)\w+\s*[{(]/gi) ?? [];
      expect(outcomes.length, file.name).toBeLessThanOrEqual(entries.length);
    });
  });

  it("agrees with Pandoc on every entry, except the recorded divergences", () => {
    const actual = Record.fromEntries(files.flatMap(divergences));
    const recorded = Option.getOrElse(
      decodeBaseline(fs.readFileSync(baselineFile, "utf8")),
      (): Record<string, readonly string[]> => ({}),
    );
    // Pandoc's cases are only compared when they were fetched.
    const expected = fs.existsSync(pandocCases)
      ? recorded
      : Record.filter(recorded, (_, key) => !key.startsWith("pandoc/"));
    if (process.env.ORACLE_BASELINE === "write") {
      fs.writeFileSync(baselineFile, `${globalThis.JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(expected);
  });

  it("compares a meaningful share of the entries", () => {
    const compared = files.flatMap((file) =>
      Option.match(file.oracle, { onNone: () => [], onSome: (items) => items }),
    ).length;
    expect(compared).toBeGreaterThan(300);
  });
});
