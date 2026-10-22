/**
 * File-format parsers for bibliographic import — **BibTeX**, **CSL-JSON**
 * (the Zotero export shape), reading-list **CSV**, and **RIS** — each
 * emitting the CSL-aligned {@link BiblioRecord}.
 *
 * The parsers are the file-side analogue of the source-client normalisers:
 * where the lookup path resolves a single identifier against an upstream
 * API, this path lifts a whole exported library off disk. Every parser is
 * built on `effect` alone, except the BibTeX scanner, a grammar in
 * `@thomasfosterau/effect-parse` combinators, and they share these properties:
 *
 * - **pure, no network, no DB** — every function is unit-testable without
 *   a database or a fetch.
 * - **lenient, per-record, fail-soft** — a malformed entry is *skipped*
 *   with a typed reason, never throwing and never failing the whole batch.
 *   Each parser returns one {@link ParseOutcome} per source entry.
 * - **field-by-field validation** — titles / names run through
 *   `sanitiseText`, years through `sanitiseYear`, and identifiers through
 *   the checksum-validating decoders ({@link decodeIsbn},
 *   {@link decodeDoi}), which are the SSRF / path-injection guards, before
 *   anything is trusted. An ISBN must pass its checksum to parse.
 * - **full-fidelity BibTeX** — macros, LaTeX decoding, BibTeX name rules,
 *   `crossref` / `xdata` inheritance and the BibLaTeX field set (see
 *   {@link parseBibtex}); a field with no typed slot is kept in `extra`.
 * - **resource bounds** — total input length ({@link MAX_INPUT_LENGTH}),
 *   per-field length (`sanitiseText`), author count (`MAX_AUTHORS`), and
 *   record count ({@link MAX_RECORDS}) are all capped.
 *
 * A record needs a title **and** at least one dedup identifier (ISBN or
 * DOI) to parse; otherwise it is skipped (`no-title` / `no-identifier`),
 * so file imports share a dedup namespace with identifier lookups.
 * `provenance.source` records which format the record arrived through.
 *
 * @copyright Thomas Foster
 * @module biblio/parse
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as Match from "effect/Match";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as String from "effect/String";
import type * as Types from "effect/Types";
import {
  decodeDoi,
  decodeIsbn,
  decodeIssn,
  type Doi,
  type Isbn,
  type Issn,
} from "./identifiers.ts";
import {
  type BiblioRecord,
  type CslItemType,
  type CslName,
  dateFromYear,
  isCslItemType,
  MAX_AUTHORS,
  parsePersonName,
  type ProvenanceSource,
  readCslNameArray,
  type RecordIdentifiers,
  sanitiseText,
  sanitiseYear,
} from "./record.ts";
import type { RawFields } from "./raw-fields.ts";
import { mapBibtexEntries } from "./bibtex/fields.ts";
import { resolveInheritance } from "./bibtex/inherit.ts";
import { scanBibtex } from "./bibtex/scan.ts";

// ── Public surface ────────────────────────────────────────────────────

/**
 * The file formats this module can parse.
 *
 * @since 0.1.0
 */
export type ImportFormat = "bibtex" | "zotero-json" | "csv" | "ris";

/**
 * Why a source entry produced no importable record.
 *
 * @since 0.1.0
 */
export type SkipReason =
  /** The entry carried neither a usable ISBN nor a usable DOI to key on. */
  | "no-identifier"
  /** The entry had no usable title; a titleless entry is never parsed into a record. */
  | "no-title"
  /** The entry was structurally unparseable (e.g. a truncated BibTeX body). */
  | "malformed";

/**
 * A source entry that did not yield a record, with the reason it was dropped.
 *
 * @since 0.1.0
 */
export interface SkippedEntry {
  readonly outcome: "skipped";
  readonly reason: SkipReason;
}

/**
 * A source entry that parsed into an importable {@link BiblioRecord}.
 *
 * @since 0.1.0
 */
export interface ParsedEntry {
  readonly outcome: "parsed";
  readonly record: BiblioRecord;
}

/**
 * The per-entry result of parsing one source entry.
 *
 * @since 0.1.0
 */
export type ParseOutcome = ParsedEntry | SkippedEntry;

/**
 * The most entries one input yields; parsing stops emitting at the cap and
 * ignores the tail, so a hostile file cannot force unbounded work.
 *
 * @since 0.1.0
 */
export const MAX_RECORDS = 5000;

/**
 * Hard cap on the raw input length, in UTF-16 code units. A longer input is
 * rejected whole (returns `[]`) before any per-entry parsing runs. ~8 MB
 * comfortably holds tens of thousands of entries.
 *
 * @since 0.1.0
 */
export const MAX_INPUT_LENGTH = 8_000_000;

/**
 * Parses raw file `content` of the given `format` into a list of
 * per-entry {@link ParseOutcome}s. Pure: no network, no database. Over the
 * input-length cap the whole input is dropped (returns `[]`); otherwise
 * every recognised entry yields exactly one outcome, up to
 * {@link MAX_RECORDS}.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { parseBibliographicFile } from "@thomasfosterau/biblio"
 *
 * // (Each entry on one line here only because a line-leading `@` would read
 * // as a JSDoc tag; a real file has the usual layout.)
 * const bibtex = [
 *   "@book{harari2015, title = {Sapiens: A Brief History of Humankind},",
 *   "  author = {Harari, Yuval Noah}, publisher = {Harper}, year = {2015},",
 *   "  isbn = {9780062316097}}",
 *   "@article{untitled, author = {Nobody}, year = {2020}}",
 * ].join("\n")
 *
 * const outcomes = parseBibliographicFile(bibtex, "bibtex")
 *
 * // One outcome per entry: the book parsed, the titleless article was
 * // skipped with a reason rather than failing the batch.
 * assert.deepStrictEqual(outcomes.map((outcome) => outcome.outcome), ["parsed", "skipped"])
 * assert.strictEqual(outcomes[0].outcome === "parsed" ? outcomes[0].record.identifiers.isbn : undefined, "9780062316097")
 * assert.strictEqual(outcomes[1].outcome === "skipped" ? outcomes[1].reason : undefined, "no-title")
 * ```
 *
 * @since 0.1.0
 */
export function parseBibliographicFile(content: string, format: ImportFormat): ParseOutcome[] {
  if (content.length > MAX_INPUT_LENGTH) return [];
  return Match.value(format).pipe(
    Match.when("bibtex", () => parseBibtex(content)),
    Match.when("zotero-json", () => parseZoteroJson(content)),
    Match.when("csv", () => parseCsv(content)),
    Match.when("ris", () => parseRis(content)),
    Match.exhaustive,
  );
}

// ── Shared record assembly ────────────────────────────────────────────

/** The subset of CSL string variables the parsers populate. */
type ParserStringVar = "publisher" | "container-title" | "volume" | "issue" | "page";

/**
 * Lifts a raw field bag into a single {@link ParseOutcome}, applying the
 * full untrusted-data discipline: sanitise the title (skip on `no-title`),
 * validate the identifiers by checksum, require a dedup key (ISBN or DOI,
 * else skip on `no-identifier`), and bound the optional fields. The item
 * type is taken verbatim when the format supplies one, else inferred from
 * the identifier (ISBN → book, DOI → article-journal).
 */
function toOutcome(fields: RawFields, source: ProvenanceSource): ParseOutcome {
  const title = sanitiseTitle(fields.title, fields.subtitle);
  if (Option.isNone(title)) return { outcome: "skipped", reason: "no-title" };
  const year = Option.flatMap(fields.year, sanitiseYear);

  const isbn = Option.flatMap(fields.isbn, decodeIsbn);
  const doi = Option.flatMap(fields.doi, decodeDoi);
  const issn = Option.flatMap(fields.issn, decodeIssn);
  if (Option.isNone(isbn) && Option.isNone(doi)) {
    return { outcome: "skipped", reason: "no-identifier" };
  }

  const issued: Types.Mutable<Pick<BiblioRecord, "issued">> = {};
  if (Option.isSome(year)) issued.issued = dateFromYear(year.value);
  const record: BiblioRecord = {
    type: Option.isSome(fields.type)
      ? fields.type.value
      : Option.isSome(isbn)
        ? "book"
        : "article-journal",
    title: title.value,
    ...collectStringVars(fields),
    ...collectContributors(fields),
    ...issued,
    identifiers: assembleIdentifiers(isbn, doi, issn),
    provenance: { source },
  };
  return { outcome: "parsed", record };
}

/** Assembles the validated identifier sub-record from the decoded values. */
function assembleIdentifiers(
  isbn: Option.Option<Isbn>,
  doi: Option.Option<Doi>,
  issn: Option.Option<Issn>,
): RecordIdentifiers {
  const identifiers: Types.Mutable<RecordIdentifiers> = {};
  if (Option.isSome(isbn)) identifiers.isbn = isbn.value;
  if (Option.isSome(doi)) identifiers.doi = doi.value;
  if (Option.isSome(issn)) identifiers.issn = issn.value;
  return identifiers;
}

/** Collects the sanitised CSL string variables a parser populated. */
function collectStringVars(fields: RawFields): Partial<Record<ParserStringVar, string>> {
  const strings: Partial<Record<ParserStringVar, string>> = {};
  assignString(strings, "publisher", fields.publisher);
  assignString(strings, "container-title", fields.containerTitle);
  assignString(strings, "volume", fields.volume);
  assignString(strings, "issue", fields.issue);
  assignString(strings, "page", fields.page);
  return strings;
}

/** Collects the bounded author / editor name lists. */
function collectContributors(fields: RawFields): Partial<Pick<BiblioRecord, "author" | "editor">> {
  const contributors: Types.Mutable<Partial<Pick<BiblioRecord, "author" | "editor">>> = {};
  if (Array.isReadonlyArrayNonEmpty(fields.names)) {
    contributors.author = fields.names.slice(0, MAX_AUTHORS);
  }
  if (Array.isReadonlyArrayNonEmpty(fields.editors)) {
    contributors.editor = fields.editors.slice(0, MAX_AUTHORS);
  }
  return contributors;
}

/** Sets a sanitised CSL string variable on the accumulator when non-empty. */
function assignString(
  target: Partial<Record<ParserStringVar, string>>,
  key: ParserStringVar,
  value: Option.Option<string>,
): void {
  const clean = Option.flatMap(value, sanitiseText);
  if (Option.isSome(clean)) target[key] = clean.value;
}

/**
 * Sanitises the title, folding a subtitle in the `Title: Subtitle` shape
 * the OpenLibrary normaliser uses so both import paths agree.
 * `Option.none()` when there is no usable title.
 */
function sanitiseTitle(
  rawTitle: Option.Option<string>,
  rawSubtitle: Option.Option<string>,
): Option.Option<string> {
  const base = Option.flatMap(rawTitle, sanitiseText);
  if (Option.isNone(base)) return Option.none();
  const subtitle = Option.flatMap(rawSubtitle, sanitiseText);
  return Option.isNone(subtitle) ? base : sanitiseText(`${base.value}: ${subtitle.value}`);
}

/** Structures a list of display-form names, bounded and empties dropped. */
function structuredNames(raw: readonly string[]): CslName[] {
  return Array.filterMap(raw, (value): Result.Result<CslName, void> => {
    const name = parsePersonName(value);
    return name === null ? Result.failVoid : Result.succeed(name);
  }).slice(0, MAX_AUTHORS);
}

// ── BibTeX ────────────────────────────────────────────────────────────

/**
 * Parses a BibTeX or BibLaTeX document into per-entry {@link ParseOutcome}s.
 *
 * The whole document is read before any entry is mapped: `@string` macros
 * (and the predefined `jan` … `dec`) expand, with `#` concatenation, into
 * every value after their definition; `crossref` and `xdata` fill the fields
 * an entry lacks, with BibLaTeX's inheritance rules (a parent book's
 * `title` is an `@inbook`'s `booktitle`); `@xdata` and `@set` entries yield
 * no outcome. Each value is decoded from LaTeX to Unicode (`{\"o}` → `ö`,
 * `--` → `–`, `\emph{…}` → its text, grouping braces removed), names follow
 * BibTeX's rules (`von Last, Jr, First`, a braced corporate name as a
 * `literal`), and dates keep their month, day and range. Fields with a CSL
 * variable the record does not type (`shorttitle`, `keywords`, `type`, …)
 * land in `extra` under that CSL name, the rest under `tex.<field>`, and a
 * name list ending `and others` is recorded as `extra["tex.others"]`; only
 * `file` is dropped. The import policy is unchanged: an entry still needs a
 * title and an ISBN or DOI.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { parseBibtex } from "@thomasfosterau/biblio"
 *
 * // (Each entry on one line here only because a line-leading `@` would read
 * // as a JSDoc tag; a real file has the usual layout.)
 * const outcomes = parseBibtex([
 *   '@string{ups = "Oxford University Press"}',
 *   "@book{oxford, title = {The {Oxford} Handbook}, publisher = ups, location = {Oxford}, date = {2015-03}, isbn = {9780199695836}}",
 *   "@inbook{chapter, crossref = {oxford}, title = {Sch{\\\"o}n's Method}, author = {van der Berg, Anna and others}, pages = {1--20}, doi = {10.1093/oxfordhb/9780199695836.013.1}}",
 * ].join("\n"))
 *
 * const chapter = outcomes[1].outcome === "parsed" ? outcomes[1].record : undefined
 * assert.strictEqual(chapter?.title, "Schön's Method")
 * // Inherited from the crossref parent: its title as the container title.
 * assert.strictEqual(chapter?.["container-title"], "The Oxford Handbook")
 * assert.strictEqual(chapter?.publisher, "Oxford University Press")
 * assert.deepStrictEqual(chapter?.issued, { "date-parts": [[2015, 3]] })
 * assert.deepStrictEqual(chapter?.author, [{ family: "Berg", given: "Anna", "dropping-particle": "van der" }])
 * assert.deepStrictEqual(chapter?.extra, { "tex.others": ["author"] })
 * assert.strictEqual(chapter?.page, "1-20")
 * ```
 *
 * @since 0.1.0
 */
export function parseBibtex(content: string): ParseOutcome[] {
  return Array.map(
    mapBibtexEntries(resolveInheritance(scanBibtex(content))),
    ({ fields, additions }): ParseOutcome => {
      const outcome = toOutcome(fields, "bibtex");
      return outcome.outcome === "parsed"
        ? { outcome: "parsed", record: { ...outcome.record, ...additions } }
        : outcome;
    },
  );
}

// ── Zotero / CSL-JSON ─────────────────────────────────────────────────

const decodeString = Schema.decodeUnknownOption(Schema.String);

/** A CSL `issued` date object: structured `date-parts`, or a free-text `raw` date. */
const CslIssued = Schema.Struct({
  "date-parts": Schema.optional(Schema.Unknown),
  raw: Schema.optional(Schema.Unknown),
});
const decodeCslIssued = Schema.decodeUnknownOption(CslIssued);

/** A CSL `date-parts` value whose first part list is non-empty: `[[year, …], …]`. */
const decodeFirstDatePart = Schema.decodeUnknownOption(
  Schema.TupleWithRest(
    Schema.Tuple([Schema.TupleWithRest(Schema.Tuple([Schema.Unknown]), [Schema.Unknown])]),
    [Schema.Unknown],
  ),
);

/** A year candidate: a number, or text that may hold one. */
const decodeYearCandidate = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Number]),
);

/** Reads the year from a CSL `issued` date object (`date-parts` or `raw`). */
function cslYear(issued: typeof CslIssued.Type): Option.Option<string | number> {
  const parts = decodeFirstDatePart(issued["date-parts"]);
  if (Option.isSome(parts)) return decodeYearCandidate(parts.value[0][0]);
  return Option.flatMap(decodeString(issued.raw), (raw) => {
    const match = raw.match(/(\d{4})/);
    return match ? Option.some(match[1]) : Option.none();
  });
}

/**
 * Reads the first checksum-valid ISBN from a CSL `ISBN` field, which
 * Zotero emits as either a single string or a space / comma separated
 * list. Yields the raw token so {@link toOutcome} decodes it canonically.
 */
function cslFirstIsbn(value: string): Option.Option<string> {
  return Array.findFirst(value.split(/[\s,;]+/), (candidate) =>
    Option.isSome(decodeIsbn(candidate)),
  );
}

/**
 * Parses a Zotero / CSL-JSON export into per-entry {@link ParseOutcome}s.
 * Accepts a top-level array of item objects or a `{ items: [...] }`
 * envelope. Invalid JSON yields a single `malformed` outcome; a non-object
 * item is skipped as `malformed`.
 *
 * @since 0.1.0
 */
export function parseZoteroJson(content: string): ParseOutcome[] {
  const data = decodeJsonBody(content);
  if (Option.isNone(data)) return [{ outcome: "skipped", reason: "malformed" }];
  const items = Option.getOrElse(
    Option.orElse(decodeCslItemArray(data.value), () =>
      Option.map(decodeCslEnvelope(data.value), (envelope) => envelope.items),
    ),
    (): readonly unknown[] => [],
  );
  return Array.map(items.slice(0, MAX_RECORDS), (item) =>
    // An array item reads as an item with no fields (→ `no-title`); only a
    // non-object is `malformed`.
    Option.match(
      Option.orElse(decodeCslItem(item), () => Option.as(decodeCslItemArray(item), CSL_EMPTY_ITEM)),
      {
        onNone: (): ParseOutcome => ({ outcome: "skipped", reason: "malformed" }),
        onSome: cslItemOutcome,
      },
    ),
  );
}

/** Decodes an untrusted JSON document body; `None` when the text is not JSON. */
const decodeJsonBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** A parsed CSL body that is a bare array of items. */
const decodeCslItemArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

/** A parsed CSL body that is a `{ items: [...] }` envelope. */
const decodeCslEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({ items: Schema.Array(Schema.Unknown) }),
);

/** One CSL item object, read as far as the fields the parser consumes. */
const CslItem = Schema.Struct({
  type: Schema.optional(Schema.Unknown),
  title: Schema.optional(Schema.Unknown),
  issued: Schema.optional(Schema.Unknown),
  publisher: Schema.optional(Schema.Unknown),
  "container-title": Schema.optional(Schema.Unknown),
  volume: Schema.optional(Schema.Unknown),
  issue: Schema.optional(Schema.Unknown),
  page: Schema.optional(Schema.Unknown),
  ISBN: Schema.optional(Schema.Unknown),
  ISSN: Schema.optional(Schema.Unknown),
  DOI: Schema.optional(Schema.Unknown),
  author: Schema.optional(Schema.Unknown),
  editor: Schema.optional(Schema.Unknown),
});
const decodeCslItem = Schema.decodeUnknownOption(CslItem);
const CSL_EMPTY_ITEM: typeof CslItem.Type = {};

/** Maps one CSL item object to a {@link ParseOutcome}. */
function cslItemOutcome(item: typeof CslItem.Type): ParseOutcome {
  return toOutcome(
    {
      type: Option.filter(decodeString(item.type), isCslItemType),
      title: decodeString(item.title),
      subtitle: Option.none(),
      year: Option.flatMap(decodeCslIssued(item.issued), cslYear),
      publisher: decodeString(item.publisher),
      containerTitle: decodeString(item["container-title"]),
      volume: decodeString(item.volume),
      issue: decodeString(item.issue),
      page: decodeString(item.page),
      isbn: Option.flatMap(decodeString(item.ISBN), cslFirstIsbn),
      issn: decodeString(item.ISSN),
      doi: decodeString(item.DOI),
      names: readCslNameArray(item.author),
      editors: readCslNameArray(item.editor),
    },
    "csl-json",
  );
}

// ── Reading-list CSV ──────────────────────────────────────────────────

/**
 * Parses one CSV line into its cells, honouring `"…"` quoting and the
 * `""` escaped-quote convention. Pure character scan — no regex
 * backtracking, so a hostile line can't blow up CPU.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuote = false;
  // oxlint-disable-next-line effect/imperative-loops -- RFC-4180 cell scanner: it needs to skip the second character of a `""` escape (`i++`), which a fold cannot express, and `line.split("")` would allocate one array element per UTF-16 unit of a line bounded only by MAX_INPUT_LENGTH (8 MB) — a memory-DoS regression on a hostile single-line file.
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = false;
      } else cur += c;
    } else if (c === '"') inQuote = true;
    else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

/**
 * Splits CSV content into logical rows. A quoted cell may span physical
 * lines (an embedded newline), so we track quote state across the join.
 * Bounded by {@link MAX_RECORDS}.
 */
// reason: an irreducible single-pass row scanner — the quote-state + CRLF +
// cap branches are RFC-4180 row splitting and share a running buffer.
// fallow-ignore-next-line complexity
function splitCsvRows(content: string): string[] {
  const rows: string[] = [];
  let cur = "";
  let inQuote = false;
  // oxlint-disable-next-line effect/imperative-loops -- RFC-4180 row scanner: it needs to skip the `\n` of a CRLF pair (`i++`), which a fold cannot express, and `content.split("")` would allocate one array element per UTF-16 unit of an input bounded only by MAX_INPUT_LENGTH (8 MB) — a memory-DoS regression.
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') inQuote = !inQuote;
    if ((c === "\n" || c === "\r") && !inQuote) {
      if (c === "\r" && content[i + 1] === "\n") i++; // CRLF
      if (String.isNonEmpty(cur)) rows.push(cur);
      cur = "";
      if (rows.length > MAX_RECORDS) break;
    } else cur += c;
  }
  if (String.isNonEmpty(cur)) rows.push(cur);
  return rows;
}

/** Header aliases we accept for each logical column (lower-cased, trimmed). */
const CSV_COLUMNS = {
  title: ["title", "name"],
  author: ["author", "authors", "creator", "creators"],
  year: ["year", "date", "published", "publication year", "publicationyear"],
  publisher: ["publisher"],
  isbn: ["isbn", "isbn13", "isbn-13", "isbn10", "isbn-10"],
  issn: ["issn"],
  doi: ["doi"],
} as const;

/** A logical CSV column name. */
type CsvColumn = keyof typeof CSV_COLUMNS;

/** Builds a logical-column → cell-index map from a header row. */
function csvHeaderIndex(header: readonly string[]): Partial<Record<CsvColumn, number>> {
  const normalised = header.map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
  return Record.fromEntries(
    Array.filterMap(
      Record.keys(CSV_COLUMNS),
      (key): Result.Result<readonly [CsvColumn, number], void> => {
        const aliases: readonly string[] = CSV_COLUMNS[key];
        const at = normalised.findIndex((h) => aliases.includes(h));
        return at === -1 ? Result.failVoid : Result.succeed([key, at] as const);
      },
    ),
  );
}

/**
 * Parses a reading-list CSV into per-entry {@link ParseOutcome}s. The first
 * row is a header; logical columns are matched by alias so column order is
 * irrelevant. Authors in a single cell may be separated by `;` or ` and `.
 * A file with no header, or a header lacking a `title` column, yields a
 * single `malformed` outcome. The item type is inferred from the identifier.
 *
 * @since 0.1.0
 */
export function parseCsv(content: string): ParseOutcome[] {
  const rows = splitCsvRows(content);
  if (Array.isArrayEmpty(rows)) return [];
  const header = parseCsvLine(rows[0]);
  const index = csvHeaderIndex(header);
  if (index.title === undefined) return [{ outcome: "skipped", reason: "malformed" }];

  const cell = (cells: readonly string[], key: CsvColumn): Option.Option<string> =>
    Option.flatMap(Option.fromUndefinedOr(index[key]), (at) => Array.get(cells, at));

  return Array.map(rows.slice(1, MAX_RECORDS + 1), (row) => {
    const cells = parseCsvLine(row);
    const authorNames = Option.match(cell(cells, "author"), {
      onNone: (): string[] => [],
      onSome: (authorCell) =>
        authorCell.split(/\s*(?:;|\sand\s)\s*/i).filter((s) => String.isNonEmpty(s.trim())),
    });
    return toOutcome(
      {
        type: Option.none(),
        title: cell(cells, "title"),
        subtitle: Option.none(),
        year: cell(cells, "year"),
        publisher: cell(cells, "publisher"),
        containerTitle: Option.none(),
        volume: Option.none(),
        issue: Option.none(),
        page: Option.none(),
        isbn: cell(cells, "isbn"),
        issn: cell(cells, "issn"),
        doi: cell(cells, "doi"),
        names: structuredNames(authorNames),
        editors: [],
      },
      "csv",
    );
  });
}

// ── RIS ───────────────────────────────────────────────────────────────

/**
 * Splits an RIS document into per-record tag multimaps. An RIS record runs
 * from a `TY  - <type>` line to its `ER  - ` terminator; each line is a
 * two-character tag, two spaces, a dash, and a value. Non-tag lines (and
 * tags before the first `TY`) are ignored, and a record missing its `ER`
 * is still flushed on the next `TY` or at end of input — fail-soft.
 */
// reason: an irreducible single-pass record scanner; the TY/ER/other-tag
// branches are the RIS record grammar and share the running record buffer.
// fallow-ignore-next-line complexity
function splitRisRecords(content: string): RisRecord[] {
  const records: RisRecord[] = [];
  /** Appends a finished record; `false` once the record cap is reached. */
  const push = (record: RisRecord): boolean => {
    records.push(record);
    return records.length < MAX_RECORDS;
  };
  const initial: RisScan = { current: Option.none(), done: false };
  const trailing = Array.reduce(content.split(/\r?\n/), initial, (state, line): RisScan => {
    if (state.done) return state;
    const match = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (match === null) return state;
    const tag = match[1];
    const value = match[2].trim();
    if (tag === "TY") {
      if (Option.isSome(state.current) && !push(state.current.value)) {
        return { current: Option.none(), done: true };
      }
      const started: RisRecord = MutableHashMap.empty();
      addRisTag(started, tag, value);
      return { current: Option.some(started), done: false };
    }
    if (tag === "ER") {
      if (Option.isNone(state.current)) return state;
      return { current: Option.none(), done: !push(state.current.value) };
    }
    if (Option.isSome(state.current)) addRisTag(state.current.value, tag, value);
    return state;
  });
  if (Option.isSome(trailing.current) && records.length < MAX_RECORDS) {
    records.push(trailing.current.value);
  }
  return records;
}

/** The RIS scanner's running state: the record being read, and whether the record cap was hit. */
interface RisScan {
  readonly current: Option.Option<RisRecord>;
  readonly done: boolean;
}

/** One RIS record: each two-character tag mapped to its values, in order. */
type RisRecord = MutableHashMap.MutableHashMap<string, string[]>;

/** Appends a tag value to an RIS record's multimap. */
function addRisTag(record: RisRecord, tag: string, value: string): void {
  const existing = MutableHashMap.get(record, tag);
  if (Option.isNone(existing)) MutableHashMap.set(record, tag, [value]);
  else existing.value.push(value);
}

/** The first value of an RIS tag, or `None`. */
function risFirst(record: RisRecord, tag: string): Option.Option<string> {
  return Option.flatMap(MutableHashMap.get(record, tag), Array.head);
}

/** All values across a set of RIS tags, in order. */
function risAll(record: RisRecord, tags: readonly string[]): string[] {
  return Array.flatMap(tags, (tag) => risValues(record, tag));
}

/** All values recorded for one RIS tag, in order. */
function risValues(record: RisRecord, tag: string): readonly string[] {
  return Option.getOrElse(MutableHashMap.get(record, tag), (): string[] => []);
}

/** RIS `TY` → CSL item type; unlisted types fall back to `document`. */
const RIS_TYPES = HashMap.fromIterable<string, CslItemType>([
  ["BOOK", "book"],
  ["EBOOK", "book"],
  ["JOUR", "article-journal"],
  ["MGZN", "article-magazine"],
  ["NEWS", "article-newspaper"],
  ["CHAP", "chapter"],
  ["CONF", "paper-conference"],
  ["CPAPER", "paper-conference"],
  ["THES", "thesis"],
  ["RPRT", "report"],
  ["ELEC", "webpage"],
  ["WEB", "webpage"],
  ["DATA", "dataset"],
  ["ENCYC", "entry-encyclopedia"],
  ["DICT", "entry-dictionary"],
]);

/** Maps an RIS `TY` type to a CSL item type, defaulting to `document`. */
function risType(ty: Option.Option<string>): CslItemType {
  return Option.getOrElse(
    Option.flatMap(ty, (type) => HashMap.get(RIS_TYPES, type)),
    (): CslItemType => "document",
  );
}

/** Extracts a 4-digit year from an RIS date value (`2015`, `2015/01/01/`, …). */
function risYear(value: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(value)) return Option.none();
  const match = value.value.match(/(\d{4})/);
  return match ? Option.some(match[1]) : Option.none();
}

/** Builds a CSL `page` range from RIS `SP` / `EP` tags. */
function risPages(sp: Option.Option<string>, ep: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(sp)) return ep;
  return Option.isNone(ep) ? sp : Option.some(`${sp.value}-${ep.value}`);
}

/** The first RIS `SN` values that hold a valid ISBN and ISSN. */
interface RisSerials {
  readonly isbn: Option.Option<string>;
  readonly issn: Option.Option<string>;
}

/** Picks the first RIS `SN` value that is a valid ISBN / ISSN respectively. */
function risSerials(record: RisRecord): RisSerials {
  const values = risValues(record, "SN");
  return {
    isbn: Array.findFirst(values, (value) => Option.isSome(decodeIsbn(value))),
    issn: Array.findFirst(values, (value) => Option.isSome(decodeIssn(value))),
  };
}

/** Maps one RIS record multimap to a {@link ParseOutcome}. */
function risRecordOutcome(record: RisRecord): ParseOutcome {
  const serials = risSerials(record);
  return toOutcome(
    {
      type: Option.some(risType(risFirst(record, "TY"))),
      title: Option.firstSomeOf([
        risFirst(record, "TI"),
        risFirst(record, "T1"),
        risFirst(record, "BT"),
      ]),
      subtitle: Option.none(),
      year: risYear(
        Option.firstSomeOf([
          risFirst(record, "PY"),
          risFirst(record, "Y1"),
          risFirst(record, "DA"),
        ]),
      ),
      publisher: risFirst(record, "PB"),
      containerTitle: Option.firstSomeOf([
        risFirst(record, "JO"),
        risFirst(record, "JF"),
        risFirst(record, "T2"),
        risFirst(record, "J2"),
      ]),
      volume: risFirst(record, "VL"),
      issue: risFirst(record, "IS"),
      page: risPages(risFirst(record, "SP"), risFirst(record, "EP")),
      isbn: serials.isbn,
      issn: serials.issn,
      doi: Option.firstSomeOf([risFirst(record, "DO"), risFirst(record, "DOI")]),
      names: structuredNames(risAll(record, ["AU", "A1"])),
      editors: structuredNames(risAll(record, ["ED", "A2"])),
    },
    "ris",
  );
}

/**
 * Parses an RIS document into per-entry {@link ParseOutcome}s.
 *
 * @since 0.1.0
 */
export function parseRis(content: string): ParseOutcome[] {
  return Array.map(splitRisRecords(content).slice(0, MAX_RECORDS), risRecordOutcome);
}
