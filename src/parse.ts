/**
 * @copyright Thomas Foster
 *
 * File-format parsers for bibliographic import — **BibTeX**, **CSL-JSON**
 * (the Zotero export shape), reading-list **CSV**, and **RIS** — each
 * emitting the CSL-aligned {@link BiblioRecord} (biblio B2, issue #1069).
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
 *   the checksum-validating decoders ({@link module:biblio/identifiers}),
 *   which are the SSRF / path-injection guards, before anything is
 *   trusted. B2 upgrade: an ISBN must now pass its checksum to parse (the
 *   pre-B2 scanner was syntax-only).
 * - **resource bounds** — total input length ({@link MAX_INPUT_LENGTH}),
 *   per-field length (`sanitiseText`), author count (`MAX_AUTHORS`), and
 *   record count ({@link MAX_RECORDS}) are all capped.
 *
 * A record needs a title **and** at least one dedup identifier (ISBN or
 * DOI) to parse; otherwise it is skipped (`no-title` / `no-identifier`) —
 * the same gate as pre-B2, keeping the shared dedup namespace with the
 * identifier-lookup imports. `provenance.source` records which format the
 * record arrived through.
 *
 * @module biblio/parse
 */

import * as Option from "effect/Option";
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

/** The file formats this module can parse. */
export type ImportFormat = "bibtex" | "zotero-json" | "csv" | "ris";

/** Why a source entry produced no importable record. */
export type SkipReason =
  /** The entry carried neither a usable ISBN nor a usable DOI to key on. */
  | "no-identifier"
  /** The entry had no usable title — we never ingest a titleless work. */
  | "no-title"
  /** The entry was structurally unparseable (e.g. a truncated BibTeX body). */
  | "malformed";

/** A source entry that did not yield a record, with the reason it was dropped. */
export interface SkippedEntry {
  readonly outcome: "skipped";
  readonly reason: SkipReason;
}

/** A source entry that parsed into an importable {@link BiblioRecord}. */
export interface ParsedEntry {
  readonly outcome: "parsed";
  readonly record: BiblioRecord;
}

/** The per-entry result of parsing one source entry. */
export type ParseOutcome = ParsedEntry | SkippedEntry;

/**
 * Hard cap on how many entries a single uploaded file may yield. A larger
 * file has its tail ignored — the parser stops emitting once the cap is
 * hit, so a hostile file can't make the importer allocate unbounded work.
 */
export const MAX_RECORDS = 5000;

/**
 * Hard cap on the raw input length, in UTF-16 code units. A larger file is
 * rejected up front (the whole upload is dropped) before any per-entry
 * parsing runs. ~8 MB comfortably holds tens of thousands of entries.
 */
export const MAX_INPUT_LENGTH = 8_000_000;

/**
 * Parses raw uploaded file `content` of the given `format` into a list of
 * per-entry {@link ParseOutcome}s. Pure: no network, no database. Over the
 * input-length cap the whole upload is dropped (returns `[]`); otherwise
 * every recognised entry yields exactly one outcome, up to
 * {@link MAX_RECORDS}.
 */
export function parseBibliographicFile(content: string, format: ImportFormat): ParseOutcome[] {
  if (content.length > MAX_INPUT_LENGTH) return [];
  switch (format) {
    case "bibtex":
      return parseBibtex(content);
    case "zotero-json":
      return parseZoteroJson(content);
    case "csv":
      return parseCsv(content);
    case "ris":
      return parseRis(content);
  }
}

// ── Shared record assembly ────────────────────────────────────────────

/**
 * A pre-assembly bag of the fields a parser pulls out of one source entry.
 * Names are already structured ({@link CslName}); identifier and free-text
 * values are still raw — {@link toOutcome} runs the decoders / sanitisers.
 */
interface RawFields {
  /** The CSL item type, or `undefined` to infer it from the identifier. */
  readonly type?: CslItemType | undefined;
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

/** Decodes a raw value through a branded-identifier decoder, or `null`. */
function decodeId<T>(decode: (raw: string) => Option.Option<T>, value: unknown): T | null {
  return typeof value === "string" ? Option.getOrNull(decode(value)) : null;
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
  if (title === null) return { outcome: "skipped", reason: "no-title" };

  const isbn = decodeId<Isbn>(decodeIsbn, fields.isbn);
  const doi = decodeId<Doi>(decodeDoi, fields.doi);
  const issn = decodeId<Issn>(decodeIssn, fields.issn);
  if (isbn === null && doi === null) return { outcome: "skipped", reason: "no-identifier" };

  const record: BiblioRecord = {
    type: fields.type ?? (isbn !== null ? "book" : "article-journal"),
    title,
    ...collectStringVars(fields),
    ...collectContributors(fields),
    ...(sanitiseYear(fields.year) !== null
      ? { issued: dateFromYear(sanitiseYear(fields.year)!) }
      : {}),
    identifiers: assembleIdentifiers(isbn, doi, issn),
    provenance: { source },
  };
  return { outcome: "parsed", record };
}

/** Assembles the validated identifier sub-record from the decoded values. */
function assembleIdentifiers(
  isbn: Isbn | null,
  doi: Doi | null,
  issn: Issn | null,
): RecordIdentifiers {
  return {
    ...(isbn !== null ? { isbn } : {}),
    ...(doi !== null ? { doi } : {}),
    ...(issn !== null ? { issn } : {}),
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
    ...(fields.names.length > 0 ? { author: fields.names.slice(0, MAX_AUTHORS) } : {}),
    ...(editors.length > 0 ? { editor: editors.slice(0, MAX_AUTHORS) } : {}),
  };
}

/** Sets a sanitised CSL string variable on the accumulator when non-empty. */
function assignString(
  target: Partial<Record<ParserStringVar, string>>,
  key: ParserStringVar,
  value: unknown,
): void {
  const clean = sanitiseText(value);
  if (clean !== null) target[key] = clean;
}

/**
 * Sanitises the title, folding a subtitle in the `Title: Subtitle` shape
 * the OpenLibrary normaliser uses so both import paths agree. Returns
 * `null` when there is no usable title.
 */
function sanitiseTitle(rawTitle: unknown, rawSubtitle: unknown): string | null {
  const base = sanitiseText(rawTitle);
  if (base === null) return null;
  const subtitle = sanitiseText(rawSubtitle);
  return subtitle === null ? base : sanitiseText(`${base}: ${subtitle}`);
}

/** Structures a list of display-form names, bounded and empties dropped. */
function structuredNames(raw: readonly string[]): CslName[] {
  const names: CslName[] = [];
  for (const value of raw) {
    if (names.length >= MAX_AUTHORS) break;
    const name = parsePersonName(value);
    if (name !== null) names.push(name);
  }
  return names;
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
function parseBibtexFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  const firstComma = body.indexOf(",");
  if (firstComma === -1) return fields;
  let i = firstComma + 1;
  const n = body.length;
  while (i < n) {
    const eq = body.indexOf("=", i);
    if (eq === -1) break;
    const key = body.slice(i, eq).trim().toLowerCase();
    let j = eq + 1;
    let depth = 0;
    let inQuote = false;
    while (j < n) {
      const c = body[j];
      if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      else if (c === '"' && depth === 0) inQuote = !inQuote;
      else if (c === "," && depth === 0 && !inQuote) break;
      j++;
    }
    const value = body.slice(eq + 1, j);
    if (key.length > 0) fields.set(key, unwrapBibtexValue(value));
    i = j + 1;
  }
  return fields;
}

/** Splits a BibTeX name field on the ` and ` separator into display names. */
function splitBibtexNames(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw.split(/\s+and\s+/i);
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

/** Parses a BibTeX document into per-entry {@link ParseOutcome}s. */
export function parseBibtex(content: string): ParseOutcome[] {
  const outcomes: ParseOutcome[] = [];
  for (const entry of splitBibtexEntries(content)) {
    if (outcomes.length >= MAX_RECORDS) break;
    const fields = parseBibtexFields(entry.body);
    outcomes.push(
      toOutcome(
        {
          type: bibtexType(entry.kind),
          title: fields.get("title"),
          subtitle: fields.get("subtitle"),
          year: fields.get("year") ?? fields.get("date"),
          publisher: fields.get("publisher"),
          containerTitle: fields.get("journal") ?? fields.get("booktitle"),
          volume: fields.get("volume"),
          issue: fields.get("number"),
          page: fields.get("pages"),
          isbn: fields.get("isbn"),
          issn: fields.get("issn"),
          doi: fields.get("doi"),
          names: structuredNames(splitBibtexNames(fields.get("author"))),
          editors: structuredNames(splitBibtexNames(fields.get("editor"))),
        },
        "bibtex",
      ),
    );
  }
  return outcomes;
}

// ── Zotero / CSL-JSON ─────────────────────────────────────────────────

/** Reads the year from a CSL `issued` date object (`date-parts` or `raw`). */
function cslYear(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null) return undefined;
  const obj = entry as { "date-parts"?: unknown; raw?: unknown };
  const parts = obj["date-parts"];
  if (Array.isArray(parts) && Array.isArray(parts[0]) && parts[0].length > 0) return parts[0][0];
  if (typeof obj.raw === "string") {
    const match = obj.raw.match(/(\d{4})/);
    return match ? match[1] : undefined;
  }
  return undefined;
}

/**
 * Reads the first checksum-valid ISBN from a CSL `ISBN` field, which
 * Zotero emits as either a single string or a space / comma separated
 * list. Returns the raw token so {@link toOutcome} decodes it canonically.
 */
function cslFirstIsbn(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  for (const candidate of value.split(/[\s,;]+/)) {
    if (Option.isSome(decodeIsbn(candidate))) return candidate;
  }
  return undefined;
}

/** Reads the first CSL item type present, or `undefined` to infer it. */
function cslType(value: unknown): CslItemType | undefined {
  return typeof value === "string" && isCslItemType(value) ? value : undefined;
}

/**
 * Parses a Zotero / CSL-JSON export into per-entry {@link ParseOutcome}s.
 * Accepts a top-level array of item objects or a `{ items: [...] }`
 * envelope. Invalid JSON yields a single `malformed` outcome; a non-object
 * item is skipped as `malformed`.
 */
export function parseZoteroJson(content: string): ParseOutcome[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [{ outcome: "skipped", reason: "malformed" }];
  }
  const outcomes: ParseOutcome[] = [];
  for (const item of cslItems(data)) {
    if (outcomes.length >= MAX_RECORDS) break;
    outcomes.push(cslItemOutcome(item));
  }
  return outcomes;
}

/** Resolves the item list from a parsed CSL body — array or `{ items }` envelope. */
function cslItems(data: unknown): readonly unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

/** Maps one CSL item object to a {@link ParseOutcome} (non-object → malformed). */
function cslItemOutcome(item: unknown): ParseOutcome {
  if (typeof item !== "object" || item === null) {
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
      isbn: cslFirstIsbn(obj.ISBN),
      issn: typeof obj.ISSN === "string" ? obj.ISSN : undefined,
      doi: typeof obj.DOI === "string" ? obj.DOI : undefined,
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
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') inQuote = !inQuote;
    if ((c === "\n" || c === "\r") && !inQuote) {
      if (c === "\r" && content[i + 1] === "\n") i++; // CRLF
      if (cur.length > 0) rows.push(cur);
      cur = "";
      if (rows.length > MAX_RECORDS) break;
    } else cur += c;
  }
  if (cur.length > 0) rows.push(cur);
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

/** Builds a logical-column → cell-index map from a header row. */
function csvHeaderIndex(header: readonly string[]): Map<keyof typeof CSV_COLUMNS, number> {
  const normalised = header.map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
  const index = new Map<keyof typeof CSV_COLUMNS, number>();
  for (const key of Object.keys(CSV_COLUMNS) as (keyof typeof CSV_COLUMNS)[]) {
    const aliases = CSV_COLUMNS[key];
    const at = normalised.findIndex((h) => (aliases as readonly string[]).includes(h));
    if (at !== -1) index.set(key, at);
  }
  return index;
}

/**
 * Parses a reading-list CSV into per-entry {@link ParseOutcome}s. The first
 * row is a header; logical columns are matched by alias so column order is
 * irrelevant. Authors in a single cell may be separated by `;` or ` and `.
 * A file with no header, or a header lacking a `title` column, yields a
 * single `malformed` outcome. The item type is inferred from the identifier.
 */
export function parseCsv(content: string): ParseOutcome[] {
  const rows = splitCsvRows(content);
  if (rows.length === 0) return [];
  const header = parseCsvLine(rows[0]);
  const index = csvHeaderIndex(header);
  if (!index.has("title")) return [{ outcome: "skipped", reason: "malformed" }];

  const cell = (cells: readonly string[], key: keyof typeof CSV_COLUMNS): unknown => {
    const at = index.get(key);
    return at === undefined ? undefined : cells[at];
  };

  const outcomes: ParseOutcome[] = [];
  for (let r = 1; r < rows.length; r++) {
    if (outcomes.length >= MAX_RECORDS) break;
    const cells = parseCsvLine(rows[r]);
    const authorCell = cell(cells, "author");
    const authorNames =
      typeof authorCell === "string"
        ? authorCell.split(/\s*(?:;|\sand\s)\s*/i).filter((s) => s.trim().length > 0)
        : [];
    outcomes.push(
      toOutcome(
        {
          title: cell(cells, "title"),
          year: cell(cells, "year"),
          publisher: cell(cells, "publisher"),
          isbn: cell(cells, "isbn"),
          issn: cell(cells, "issn"),
          doi: cell(cells, "doi"),
          names: structuredNames(authorNames),
        },
        "csv",
      ),
    );
  }
  return outcomes;
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
function splitRisRecords(content: string): Map<string, string[]>[] {
  const records: Map<string, string[]>[] = [];
  let current: Map<string, string[]> | null = null;
  const push = (record: Map<string, string[]>): boolean => {
    records.push(record);
    return records.length < MAX_RECORDS;
  };
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (match === null) continue;
    const tag = match[1];
    const value = match[2].trim();
    if (tag === "TY") {
      if (current !== null && !push(current)) return records;
      current = new Map<string, string[]>();
      addRisTag(current, tag, value);
    } else if (tag === "ER") {
      if (current !== null) {
        const flushed = current;
        current = null;
        if (!push(flushed)) return records;
      }
    } else if (current !== null) {
      addRisTag(current, tag, value);
    }
  }
  if (current !== null && records.length < MAX_RECORDS) records.push(current);
  return records;
}

/** Appends a tag value to an RIS record's multimap. */
function addRisTag(record: Map<string, string[]>, tag: string, value: string): void {
  const existing = record.get(tag);
  if (existing === undefined) record.set(tag, [value]);
  else existing.push(value);
}

/** The first value of an RIS tag, or `undefined`. */
function risFirst(record: Map<string, string[]>, tag: string): string | undefined {
  return record.get(tag)?.[0];
}

/** All values across a set of RIS tags, in order. */
function risAll(record: Map<string, string[]>, tags: readonly string[]): string[] {
  const values: string[] = [];
  for (const tag of tags) for (const value of record.get(tag) ?? []) values.push(value);
  return values;
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
function risType(ty: string | undefined): CslItemType {
  return RIS_TYPES[ty ?? ""] ?? "document";
}

/** Extracts a 4-digit year from an RIS date value (`2015`, `2015/01/01/`, …). */
function risYear(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = value.match(/(\d{4})/);
  return match ? match[1] : undefined;
}

/** Builds a CSL `page` range from RIS `SP` / `EP` tags. */
function risPages(sp: string | undefined, ep: string | undefined): string | undefined {
  if (sp === undefined) return ep;
  return ep === undefined ? sp : `${sp}-${ep}`;
}

/** Picks the first RIS `SN` value that is a valid ISBN / ISSN respectively. */
function risSerials(record: Map<string, string[]>): { isbn?: string; issn?: string } {
  const result: { isbn?: string; issn?: string } = {};
  for (const value of record.get("SN") ?? []) {
    if (result.isbn === undefined && Option.isSome(decodeIsbn(value))) result.isbn = value;
    if (result.issn === undefined && Option.isSome(decodeIssn(value))) result.issn = value;
  }
  return result;
}

/** Maps one RIS record multimap to a {@link ParseOutcome}. */
function risRecordOutcome(record: Map<string, string[]>): ParseOutcome {
  const serials = risSerials(record);
  return toOutcome(
    {
      type: risType(risFirst(record, "TY")),
      title: risFirst(record, "TI") ?? risFirst(record, "T1") ?? risFirst(record, "BT"),
      year: risYear(risFirst(record, "PY") ?? risFirst(record, "Y1") ?? risFirst(record, "DA")),
      publisher: risFirst(record, "PB"),
      containerTitle:
        risFirst(record, "JO") ??
        risFirst(record, "JF") ??
        risFirst(record, "T2") ??
        risFirst(record, "J2"),
      volume: risFirst(record, "VL"),
      issue: risFirst(record, "IS"),
      page: risPages(risFirst(record, "SP"), risFirst(record, "EP")),
      isbn: serials.isbn,
      issn: serials.issn,
      doi: risFirst(record, "DO") ?? risFirst(record, "DOI"),
      names: structuredNames(risAll(record, ["AU", "A1"])),
      editors: structuredNames(risAll(record, ["ED", "A2"])),
    },
    "ris",
  );
}

/** Parses an RIS document into per-entry {@link ParseOutcome}s. */
export function parseRis(content: string): ParseOutcome[] {
  const outcomes: ParseOutcome[] = [];
  for (const record of splitRisRecords(content)) {
    if (outcomes.length >= MAX_RECORDS) break;
    outcomes.push(risRecordOutcome(record));
  }
  return outcomes;
}
