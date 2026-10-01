/**
 * File-format parsers for bibliographic import — **BibTeX**, **CSL-JSON**
 * (the Zotero export shape), reading-list **CSV**, and **RIS** — each
 * emitting the CSL-aligned {@link BiblioRecord} (#1069).
 *
 * The parsers are the file-side analogue of the source-client normalisers:
 * where the lookup path resolves a single identifier against an upstream
 * API, this path lifts a whole exported library off disk. The hand-rolled,
 * dependency-free scanner posture is deliberate and preserved:
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
import * as Match from "effect/Match";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as String from "effect/String";
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
  /** The entry had no usable title — we never ingest a titleless work. */
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
 * console.log(outcomes.map((outcome) => outcome.outcome))
 * // → ["parsed", "skipped"]
 * console.log(outcomes[0].outcome === "parsed" ? outcomes[0].record.identifiers.isbn : undefined)
 * // → "9780062316097"
 * console.log(outcomes[1].outcome === "skipped" ? outcomes[1].reason : undefined)
 * // → "no-title"
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

/**
 * A pre-assembly bag of the fields a parser pulls out of one source entry.
 * Names are already structured ({@link CslName}); identifier and free-text
 * values are still raw — {@link toOutcome} runs the decoders / sanitisers.
 */
interface RawFields {
  /** The CSL item type, or `Option.none()` to infer it from the identifier. */
  readonly type: Option.Option<CslItemType>;
  readonly title: unknown;
  readonly subtitle?: unknown;
  readonly year?: unknown;
  readonly publisher?: unknown;
  readonly containerTitle?: unknown;
  readonly volume?: unknown;
  readonly issue?: unknown;
  readonly page?: unknown;
  readonly isbn?: unknown;
  readonly issn?: unknown;
  readonly doi?: unknown;
  readonly names: readonly CslName[];
  readonly editors?: readonly CslName[];
}

/** Decodes a raw value through a branded-identifier decoder, or `None`. */
function decodeId<T>(decode: (raw: string) => Option.Option<T>, value: unknown): Option.Option<T> {
  return Predicate.isString(value) ? decode(value) : Option.none();
}

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
  const year = sanitiseYear(fields.year);

  const isbn = decodeId<Isbn>(decodeIsbn, fields.isbn);
  const doi = decodeId<Doi>(decodeDoi, fields.doi);
  const issn = decodeId<Issn>(decodeIssn, fields.issn);
  if (Option.isNone(isbn) && Option.isNone(doi)) {
    return { outcome: "skipped", reason: "no-identifier" };
  }

  const record: BiblioRecord = {
    type: Option.isSome(fields.type)
      ? fields.type.value
      : Option.isSome(isbn)
        ? "book"
        : "article-journal",
    title: title.value,
    ...collectStringVars(fields),
    ...collectContributors(fields),
    ...(Option.isNone(year) ? {} : { issued: dateFromYear(year.value) }),
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
  return {
    ...(Option.isSome(isbn) ? { isbn: isbn.value } : {}),
    ...(Option.isSome(doi) ? { doi: doi.value } : {}),
    ...(Option.isSome(issn) ? { issn: issn.value } : {}),
  };
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
  const editors = fields.editors ?? [];
  return {
    ...(Array.isReadonlyArrayNonEmpty(fields.names)
      ? { author: fields.names.slice(0, MAX_AUTHORS) }
      : {}),
    ...(Array.isReadonlyArrayNonEmpty(editors) ? { editor: editors.slice(0, MAX_AUTHORS) } : {}),
  };
}

/** Sets a sanitised CSL string variable on the accumulator when non-empty. */
function assignString(
  target: Partial<Record<ParserStringVar, string>>,
  key: ParserStringVar,
  value: unknown,
): void {
  const clean = sanitiseText(value);
  if (Option.isSome(clean)) target[key] = clean.value;
}

/**
 * Sanitises the title, folding a subtitle in the `Title: Subtitle` shape
 * the OpenLibrary normaliser uses so both import paths agree.
 * `Option.none()` when there is no usable title.
 */
function sanitiseTitle(rawTitle: unknown, rawSubtitle: unknown): Option.Option<string> {
  const base = sanitiseText(rawTitle);
  if (Option.isNone(base)) return Option.none();
  const subtitle = sanitiseText(rawSubtitle);
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

/** One raw BibTeX entry: its `@type` and its `{ ... }` body. */
interface BibtexEntry {
  readonly kind: string;
  readonly body: string;
}

/**
 * Splits a BibTeX document into raw `@type{ ... }` entries. Hand rolled
 * over the common subset (no dependency): finds each `@` entry head, then
 * balances braces to the matching close so a `title = {a {nested} brace}`
 * field doesn't terminate the entry early. A truncated / unbalanced tail
 * stops the scan — it never throws.
 */
// reason: an irreducible single-pass brace-balancing scanner; its branches
// ARE the parse grammar (entry head / skip directive / depth tracking) and
// splitting them would scatter the shared cursor + depth state.
// fallow-ignore-next-line complexity
function splitBibtexEntries(content: string): BibtexEntry[] {
  const entries: BibtexEntry[] = [];
  let i = 0;
  const n = content.length;
  // oxlint-disable-next-line effect/imperative-loops -- character-position scanner: an `Arr.*` form needs `content.split("")`, one array element per UTF-16 unit of an input bounded only by MAX_INPUT_LENGTH (8 MB), so the rewrite is a memory-DoS regression on the exact hostile input this scanner is bounded against.
  while (i < n && entries.length < MAX_RECORDS) {
    const at = content.indexOf("@", i);
    if (at === -1) break;
    const open = content.indexOf("{", at);
    if (open === -1) break;
    const kind = content
      .slice(at + 1, open)
      .trim()
      .toLowerCase();
    // A `@comment`, `@string`, or `@preamble` is not a reference entry.
    if (kind === "comment" || kind === "string" || kind === "preamble" || kind === "") {
      i = open + 1;
      continue;
    }
    let depth = 0;
    let j = open;
    // oxlint-disable-next-line effect/imperative-loops -- brace-depth balancer over character positions; materialising the (MAX_INPUT_LENGTH = 8 MB) body as a character array to fold over is a memory-DoS regression, and the loop must stop at the matching `}` rather than traverse to the end.
    for (; j < n; j++) {
      const c = content[j];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break; // unbalanced tail — stop, don't throw
    entries.push({ kind, body: content.slice(open + 1, j) });
    i = j + 1;
  }
  return entries;
}

/** Strips one layer of wrapping `{…}` or `"…"` from a BibTeX field value. */
function unwrapBibtexValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed.slice(1, -1);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Pulls the `key = value` fields out of one BibTeX entry body into a map.
 * Brace-balances each value so a `,` inside `{…}` doesn't split a field.
 * Unknown / duplicate keys are last-wins.
 */
// reason: an irreducible single-pass field scanner; the depth / quote / comma
// branches are the BibTeX value grammar and share a running cursor.
// fallow-ignore-next-line complexity
function parseBibtexFields(body: string): MutableHashMap.MutableHashMap<string, string> {
  const fields = MutableHashMap.empty<string, string>();
  const firstComma = body.indexOf(",");
  if (firstComma === -1) return fields;
  let i = firstComma + 1;
  const n = body.length;
  // oxlint-disable-next-line effect/imperative-loops -- field scanner driven by a character cursor; an `Arr.*` form needs `body.split("")`, one array element per UTF-16 unit of an entry body bounded only by MAX_INPUT_LENGTH (8 MB), so the rewrite is a memory-DoS regression.
  while (i < n) {
    const eq = body.indexOf("=", i);
    if (eq === -1) break;
    const key = body.slice(i, eq).trim().toLowerCase();
    let j = eq + 1;
    let depth = 0;
    let inQuote = false;
    // oxlint-disable-next-line effect/imperative-loops -- brace/quote-depth scan over character positions; folding needs the whole (MAX_INPUT_LENGTH = 8 MB) body as a character array, and the scan must stop at the field-terminating comma rather than traverse to the end.
    while (j < n) {
      const c = body[j];
      if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      else if (c === '"' && depth === 0) inQuote = !inQuote;
      else if (c === "," && depth === 0 && !inQuote) break;
      j++;
    }
    const value = body.slice(eq + 1, j);
    if (String.isNonEmpty(key)) MutableHashMap.set(fields, key, unwrapBibtexValue(value));
    i = j + 1;
  }
  return fields;
}

/** Splits a BibTeX name field on the ` and ` separator into display names. */
function splitBibtexNames(raw: Option.Option<string>): string[] {
  if (Option.isNone(raw)) return [];
  return raw.value.split(/\s+and\s+/i);
}

/** BibTeX `@type` → CSL item type; unlisted types fall back to `document`. */
const BIBTEX_TYPES: Readonly<Record<string, CslItemType>> = {
  book: "book",
  booklet: "book",
  article: "article-journal",
  inbook: "chapter",
  incollection: "chapter",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  techreport: "report",
};

/** Maps a BibTeX `@type` to a CSL item type, defaulting to `document`. */
function bibtexType(kind: string): CslItemType {
  return BIBTEX_TYPES[kind] ?? "document";
}

/**
 * Parses a BibTeX document into per-entry {@link ParseOutcome}s.
 *
 * @since 0.1.0
 */
export function parseBibtex(content: string): ParseOutcome[] {
  return Array.map(splitBibtexEntries(content).slice(0, MAX_RECORDS), (entry) => {
    const fields = parseBibtexFields(entry.body);
    const field = (key: string): Option.Option<string> => MutableHashMap.get(fields, key);
    // `RawFields` carries still-untrusted values the sanitisers run over, so
    // the `Option`s unwrap to plain values at that seam.
    const raw = (key: string): unknown => Option.getOrUndefined(field(key));
    return toOutcome(
      {
        type: Option.some(bibtexType(entry.kind)),
        title: raw("title"),
        subtitle: raw("subtitle"),
        year: raw("year") ?? raw("date"),
        publisher: raw("publisher"),
        containerTitle: raw("journal") ?? raw("booktitle"),
        volume: raw("volume"),
        issue: raw("number"),
        page: raw("pages"),
        isbn: raw("isbn"),
        issn: raw("issn"),
        doi: raw("doi"),
        names: structuredNames(splitBibtexNames(field("author"))),
        editors: structuredNames(splitBibtexNames(field("editor"))),
      },
      "bibtex",
    );
  });
}

// ── Zotero / CSL-JSON ─────────────────────────────────────────────────

/** Reads the year from a CSL `issued` date object (`date-parts` or `raw`). */
function cslYear(entry: unknown): unknown {
  if (!Predicate.isObjectOrArray(entry)) return undefined;
  const obj = entry as { "date-parts"?: unknown; raw?: unknown };
  const parts = obj["date-parts"];
  if (Array.isArray(parts) && Array.isArray(parts[0]) && Array.isArrayNonEmpty(parts[0])) {
    return parts[0][0];
  }
  if (Predicate.isString(obj.raw)) {
    const match = obj.raw.match(/(\d{4})/);
    return match ? match[1] : undefined;
  }
  return undefined;
}

/**
 * Reads the first checksum-valid ISBN from a CSL `ISBN` field, which
 * Zotero emits as either a single string or a space / comma separated
 * list. Yields the raw token so {@link toOutcome} decodes it canonically.
 */
function cslFirstIsbn(value: unknown): Option.Option<string> {
  if (!Predicate.isString(value)) return Option.none();
  return Array.findFirst(value.split(/[\s,;]+/), (candidate) =>
    Option.isSome(decodeIsbn(candidate)),
  );
}

/** Reads the first CSL item type present, or `None` to infer it. */
function cslType(value: unknown): Option.Option<CslItemType> {
  return Predicate.isString(value) && isCslItemType(value) ? Option.some(value) : Option.none();
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
  return Array.map(cslItems(data.value).slice(0, MAX_RECORDS), cslItemOutcome);
}

/** Decodes an untrusted JSON document body; `None` when the text is not JSON. */
const decodeJsonBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** Resolves the item list from a parsed CSL body — array or `{ items }` envelope. */
function cslItems(data: unknown): readonly unknown[] {
  if (Array.isArray(data)) return data;
  if (Predicate.isObjectOrArray(data)) {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

/** Maps one CSL item object to a {@link ParseOutcome} (non-object → malformed). */
function cslItemOutcome(item: unknown): ParseOutcome {
  if (!Predicate.isObjectOrArray(item)) {
    return { outcome: "skipped", reason: "malformed" };
  }
  const obj = item as Record<string, unknown>;
  return toOutcome(
    {
      type: cslType(obj.type),
      title: obj.title,
      year: cslYear(obj.issued),
      publisher: obj.publisher,
      containerTitle: obj["container-title"],
      volume: obj.volume,
      issue: obj.issue,
      page: obj.page,
      isbn: Option.getOrUndefined(cslFirstIsbn(obj.ISBN)),
      issn: Predicate.isString(obj.ISSN) ? obj.ISSN : undefined,
      doi: Predicate.isString(obj.DOI) ? obj.DOI : undefined,
      names: readCslNameArray(obj.author),
      editors: readCslNameArray(obj.editor),
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

  const cell = (cells: readonly string[], key: CsvColumn): unknown => {
    const at = index[key];
    return at === undefined ? undefined : cells[at];
  };

  return Array.map(rows.slice(1, MAX_RECORDS + 1), (row) => {
    const cells = parseCsvLine(row);
    const authorCell = cell(cells, "author");
    const authorNames = Predicate.isString(authorCell)
      ? authorCell.split(/\s*(?:;|\sand\s)\s*/i).filter((s) => String.isNonEmpty(s.trim()))
      : [];
    return toOutcome(
      {
        type: Option.none(),
        title: cell(cells, "title"),
        year: cell(cells, "year"),
        publisher: cell(cells, "publisher"),
        isbn: cell(cells, "isbn"),
        issn: cell(cells, "issn"),
        doi: cell(cells, "doi"),
        names: structuredNames(authorNames),
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
  const trailing = Array.reduce(
    content.split(/\r?\n/),
    { current: Option.none(), done: false } as {
      readonly current: Option.Option<RisRecord>;
      readonly done: boolean;
    },
    (state, line) => {
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
    },
  );
  if (Option.isSome(trailing.current) && records.length < MAX_RECORDS) {
    records.push(trailing.current.value);
  }
  return records;
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
const RIS_TYPES: Readonly<Record<string, CslItemType>> = {
  BOOK: "book",
  EBOOK: "book",
  JOUR: "article-journal",
  MGZN: "article-magazine",
  NEWS: "article-newspaper",
  CHAP: "chapter",
  CONF: "paper-conference",
  CPAPER: "paper-conference",
  THES: "thesis",
  RPRT: "report",
  ELEC: "webpage",
  WEB: "webpage",
  DATA: "dataset",
  ENCYC: "entry-encyclopedia",
  DICT: "entry-dictionary",
};

/** Maps an RIS `TY` type to a CSL item type, defaulting to `document`. */
function risType(ty: Option.Option<string>): CslItemType {
  return RIS_TYPES[Option.isNone(ty) ? "" : ty.value] ?? "document";
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

/** Picks the first RIS `SN` value that is a valid ISBN / ISSN respectively. */
function risSerials(record: RisRecord): { isbn?: string; issn?: string } {
  const values = risValues(record, "SN");
  const isbn = Array.findFirst(values, (value) => Option.isSome(decodeIsbn(value)));
  const issn = Array.findFirst(values, (value) => Option.isSome(decodeIssn(value)));
  return {
    ...(Option.isSome(isbn) ? { isbn: isbn.value } : {}),
    ...(Option.isSome(issn) ? { issn: issn.value } : {}),
  };
}

/** Maps one RIS record multimap to a {@link ParseOutcome}. */
function risRecordOutcome(record: RisRecord): ParseOutcome {
  const serials = risSerials(record);
  return toOutcome(
    {
      type: Option.some(risType(risFirst(record, "TY"))),
      title: Option.getOrUndefined(
        Option.firstSomeOf([
          risFirst(record, "TI"),
          risFirst(record, "T1"),
          risFirst(record, "BT"),
        ]),
      ),
      year: Option.getOrUndefined(
        risYear(
          Option.firstSomeOf([
            risFirst(record, "PY"),
            risFirst(record, "Y1"),
            risFirst(record, "DA"),
          ]),
        ),
      ),
      publisher: Option.getOrUndefined(risFirst(record, "PB")),
      containerTitle: Option.getOrUndefined(
        Option.firstSomeOf([
          risFirst(record, "JO"),
          risFirst(record, "JF"),
          risFirst(record, "T2"),
          risFirst(record, "J2"),
        ]),
      ),
      volume: Option.getOrUndefined(risFirst(record, "VL")),
      issue: Option.getOrUndefined(risFirst(record, "IS")),
      page: Option.getOrUndefined(risPages(risFirst(record, "SP"), risFirst(record, "EP"))),
      isbn: serials.isbn,
      issn: serials.issn,
      doi: Option.getOrUndefined(
        Option.firstSomeOf([risFirst(record, "DO"), risFirst(record, "DOI")]),
      ),
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
