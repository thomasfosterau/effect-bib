/**
 * @copyright Thomas Foster
 *
 * File-format parsers for bibliographic import (KB-010, issue #609).
 *
 * Turns an uploaded reference-manager export — **BibTeX**, **Zotero
 * JSON** (the CSL-JSON / Zotero "Better BibTeX JSON" shape), or a
 * reading-list **CSV** — into the provider-neutral {@link IngestedRecord}
 * shape the ingest operation already knows how to materialise
 * ({@link module:lib/server/biblio/ingest}). The parsers are the file-side
 * analogue of the identifier-lookup normalisers
 * ({@link module:lib/server/biblio/normalise}): the lookup path resolves a
 * single identifier against an upstream API, this path lifts a whole
 * exported library off disk.
 *
 * Untrusted-data discipline (the file content is fully attacker-controlled):
 * - **pure, no network, no DB** — every function here is unit-testable
 *   without a database or a fetch, exactly like the normalisers.
 * - **lenient, per-record, fail-soft** — a malformed entry is *skipped*
 *   with a typed reason, never throwing and never failing the whole batch.
 *   Each parser returns a list of {@link ParseOutcome}s, one per source
 *   entry, so the caller can report "imported 8, skipped 2 (no
 *   identifier)" rather than rejecting the upload wholesale.
 * - **field-by-field sanitisation** — titles / authors run through
 *   `sanitiseText`, years through `sanitiseYear`, and identifiers through
 *   `normaliseIsbn` / `normaliseDoi` (the SSRF / path-injection guards)
 *   before they ever reach a persisted column. Nothing from the file is
 *   trusted verbatim.
 * - **resource bounds** — the total input length, the per-record field
 *   length (via `sanitiseText`'s clamp), the author count
 *   (`MAX_AUTHORS`), and the number of records ({@link MAX_RECORDS}) are
 *   all capped so a hostile multi-megabyte file can't exhaust CPU or
 *   memory or push an unbounded blob into the database.
 *
 * Identifier → source mapping. An {@link IngestedRecord} is keyed by an
 * external `(source, authorityId)` pair, and file imports deliberately
 * **share that dedup namespace** with the identifier-lookup imports (#600):
 * a record carrying an ISBN is emitted as `source: "openlibrary"` keyed by
 * the normalised ISBN, and one carrying a DOI as `source: "crossref"`
 * keyed by the normalised DOI — so re-importing a work already ingested by
 * its identifier dedups against the same `entity_external_identifier`
 * `(authority, external_id)` unique index rather than forking. The trade-off: the `source` literal
 * names the *authority* the identifier belongs to, not the *channel* the
 * record arrived through (a BibTeX entry with an ISBN reads as
 * "openlibrary"). That is intentional — dedup keys on the authority, and
 * the channel is irrelevant to identity. A record with **no** recognised
 * identifier has nothing to key on, so it is skipped with
 * {@link SkipReason} `"no-identifier"` and left to the fuzzy-dedup
 * follow-up (#610).
 *
 * @module lib/server/biblio/parse
 */

import {
  type IngestedAuthor,
  type IngestedRecord,
  MAX_AUTHORS,
  normaliseDoi,
  normaliseIsbn,
  sanitiseText,
  sanitiseYear,
} from "./record";

// ── Public surface ────────────────────────────────────────────────────

/** The file formats this module can parse. */
export type ImportFormat = "bibtex" | "zotero-json" | "csv";

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

/** A source entry that parsed into an importable neutral record. */
export interface ParsedEntry {
  readonly outcome: "parsed";
  readonly record: IngestedRecord;
}

/** The per-entry result of parsing one source entry. */
export type ParseOutcome = ParsedEntry | SkippedEntry;

/**
 * Hard cap on how many entries a single uploaded file may yield. A larger
 * file simply has its tail ignored — the parser stops emitting once the
 * cap is hit, so a hostile file can't make the importer allocate or write
 * an unbounded number of records. (The import operation additionally
 * commits per-record, so the cap bounds the transaction work too.)
 */
export const MAX_RECORDS = 5000;

/**
 * Hard cap on the raw input length, in UTF-16 code units. A file larger
 * than this is rejected up front (the whole upload is dropped) before any
 * per-entry parsing runs, so the regex / split work below is always over a
 * bounded string. ~8 MB of text comfortably holds tens of thousands of
 * reference entries; anything larger is treated as abuse.
 */
export const MAX_INPUT_LENGTH = 8_000_000;

/**
 * Parses raw uploaded file `content` of the given `format` into a list of
 * per-entry {@link ParseOutcome}s. Pure: no network, no database. Over the
 * input length cap ({@link MAX_INPUT_LENGTH}) the whole upload is dropped
 * (returns `[]`); otherwise every recognised entry yields exactly one
 * outcome — a {@link ParsedEntry} or a {@link SkippedEntry} — up to
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
  }
}

// ── Shared record assembly ────────────────────────────────────────────

/**
 * A pre-sanitisation bag of the fields a parser pulls out of one source
 * entry. Every value is still raw / untrusted at this point;
 * {@link toOutcome} runs the sanitisers and identifier normalisers.
 */
interface RawFields {
  readonly title: unknown;
  readonly subtitle?: unknown;
  readonly year?: unknown;
  readonly publisher?: unknown;
  readonly isbn?: unknown;
  readonly doi?: unknown;
  /** Author display names, each still raw. */
  readonly authors: readonly unknown[];
}

/**
 * Lifts a raw field bag into a single {@link ParseOutcome}, applying the
 * full untrusted-data discipline: sanitise the title (skip on `no-title`),
 * pick the dedup identifier (ISBN → `openlibrary`, else DOI → `crossref`,
 * else skip on `no-identifier`), and bound the author list. The
 * identifier choice is what fixes the `(source, authorityId)` dedup key.
 */
function toOutcome(fields: RawFields): ParseOutcome {
  const title = sanitiseTitle(fields.title, fields.subtitle);
  if (title === null) return { outcome: "skipped", reason: "no-title" };

  const id = selectIdentifier(fields.isbn, fields.doi);
  if (id === null) return { outcome: "skipped", reason: "no-identifier" };

  const record: IngestedRecord = {
    source: id.source,
    authorityId: id.authorityId,
    kind: id.kind,
    title,
    publicationYear: sanitiseYear(fields.year),
    publisher: sanitiseText(fields.publisher),
    isbn10: id.isbn !== null && id.isbn.length === 10 ? id.isbn : null,
    isbn13: id.isbn !== null && id.isbn.length === 13 ? id.isbn : null,
    doi: id.doi,
    authors: boundedAuthors(fields.authors),
  };
  return { outcome: "parsed", record };
}

/**
 * Sanitises the title, folding a subtitle in the same `Title: Subtitle`
 * shape the OpenLibrary normaliser uses so both import paths agree.
 * Returns `null` when there is no usable title.
 */
function sanitiseTitle(rawTitle: unknown, rawSubtitle: unknown): string | null {
  const base = sanitiseText(rawTitle);
  if (base === null) return null;
  const subtitle = sanitiseText(rawSubtitle);
  return subtitle === null ? base : sanitiseText(`${base}: ${subtitle}`);
}

/** The dedup identity a record is keyed by, once an identifier is chosen. */
interface RecordIdentity {
  readonly source: IngestedRecord["source"];
  readonly authorityId: string;
  readonly kind: IngestedRecord["kind"];
  readonly isbn: string | null;
  readonly doi: string | null;
}

/**
 * Picks the dedup identifier: an ISBN keys to the OpenLibrary authority and
 * a Book, else a DOI keys to Crossref and an Article. ISBN wins when both
 * are present — books are the slice with a working create-graph today.
 * Returns `null` when neither normalises (the record has nothing to key on).
 */
function selectIdentifier(rawIsbn: unknown, rawDoi: unknown): RecordIdentity | null {
  const isbn = typeof rawIsbn === "string" ? normaliseIsbn(rawIsbn) : null;
  if (isbn !== null) {
    return { source: "openlibrary", authorityId: isbn, kind: "book", isbn, doi: null };
  }
  const doi = typeof rawDoi === "string" ? normaliseDoi(rawDoi) : null;
  if (doi !== null) {
    return { source: "crossref", authorityId: doi, kind: "article", isbn: null, doi };
  }
  return null;
}

/** Sanitises and length-bounds (`MAX_AUTHORS`) a raw author-name list. */
function boundedAuthors(raw: readonly unknown[]): IngestedAuthor[] {
  const authors: IngestedAuthor[] = [];
  for (const value of raw) {
    if (authors.length >= MAX_AUTHORS) break;
    const name = sanitiseText(value);
    if (name !== null) authors.push({ name });
  }
  return authors;
}

// ── BibTeX ────────────────────────────────────────────────────────────

/**
 * Splits a BibTeX document into raw `@type{ ... }` entry bodies. Hand
 * rolled over the common subset (no heavy dependency): finds each `@`
 * entry head, then balances braces to the matching close so a `title = {a
 * {nested} brace}` field doesn't terminate the entry early. A truncated /
 * unbalanced tail simply stops the scan — it never throws.
 */
// reason: an irreducible single-pass brace-balancing scanner; its branches
// ARE the parse grammar (entry head / skip directive / depth tracking) and
// splitting them would scatter the shared cursor + depth state. The CRAP
// score is fallow's zero-coverage estimate — the paths are exercised by
// tests/unit/biblio-parse.test.ts (nested braces, directives, truncation).
// fallow-ignore-next-line complexity
function splitBibtexEntries(content: string): string[] {
  const entries: string[] = [];
  let i = 0;
  const n = content.length;
  while (i < n && entries.length < MAX_RECORDS) {
    // Seek the next entry head: `@word{`.
    const at = content.indexOf("@", i);
    if (at === -1) break;
    const open = content.indexOf("{", at);
    if (open === -1) break;
    const head = content.slice(at + 1, open);
    // A `@comment`, `@string`, or `@preamble` is not a reference entry.
    const type = head.trim().toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble" || type === "") {
      i = open + 1;
      continue;
    }
    // Balance braces from `open` to find the matching close.
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
    entries.push(content.slice(open + 1, j));
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
 * Unknown / duplicate keys are last-wins; we only read the ones we map.
 */
// reason: an irreducible single-pass field scanner; the depth / quote / comma
// branches are the BibTeX value grammar and share a running cursor, so
// extracting them would only relocate the same state. Covered by
// tests/unit/biblio-parse.test.ts (nested-brace values, multi-author fields).
// fallow-ignore-next-line complexity
function parseBibtexFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  // Drop the leading citation key (`@book{KEY, ...}` → everything after the
  // first comma). If there's no comma the entry has no fields.
  const firstComma = body.indexOf(",");
  if (firstComma === -1) return fields;
  let i = firstComma + 1;
  const n = body.length;
  while (i < n) {
    const eq = body.indexOf("=", i);
    if (eq === -1) break;
    const key = body.slice(i, eq).trim().toLowerCase();
    // Walk the value, brace-balancing, until a top-level comma or the end.
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

/**
 * Splits a BibTeX `author` field on the ` and ` separator, normalising
 * each name from "Family, Given" to "Given Family". Bounded by
 * {@link MAX_AUTHORS} at the assembly seam.
 */
function parseBibtexAuthors(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw.split(/\s+and\s+/i).map((name) => {
    const comma = name.indexOf(",");
    if (comma === -1) return name.trim();
    const family = name.slice(0, comma).trim();
    const given = name.slice(comma + 1).trim();
    return given.length > 0 ? `${given} ${family}` : family;
  });
}

/** Parses a BibTeX document into per-entry {@link ParseOutcome}s. */
export function parseBibtex(content: string): ParseOutcome[] {
  const outcomes: ParseOutcome[] = [];
  for (const body of splitBibtexEntries(content)) {
    if (outcomes.length >= MAX_RECORDS) break;
    const fields = parseBibtexFields(body);
    outcomes.push(
      toOutcome({
        title: fields.get("title"),
        subtitle: fields.get("subtitle"),
        year: fields.get("year") ?? fields.get("date"),
        publisher: fields.get("publisher"),
        isbn: fields.get("isbn"),
        doi: fields.get("doi"),
        authors: parseBibtexAuthors(fields.get("author") ?? fields.get("editor")),
      }),
    );
  }
  return outcomes;
}

// ── Zotero / CSL-JSON ─────────────────────────────────────────────────

/** Reads a CSL-JSON author entry (`{ given, family }` or `{ literal }`). */
function cslAuthorName(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const obj = entry as { given?: unknown; family?: unknown; literal?: unknown; name?: unknown };
  const family = sanitiseText(obj.family);
  const given = sanitiseText(obj.given);
  if (family !== null) return given !== null ? `${given} ${family}` : family;
  // Organisations / Zotero "single-field" creators use `literal` (or `name`).
  return sanitiseText(obj.literal) ?? sanitiseText(obj.name);
}

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
 * Reads the first usable ISBN from a CSL `ISBN` field, which Zotero emits
 * as either a single string or a space / comma separated list.
 */
function cslIsbn(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  for (const candidate of value.split(/[\s,;]+/)) {
    if (normaliseIsbn(candidate) !== null) return candidate;
  }
  return undefined;
}

/**
 * Parses a Zotero / CSL-JSON export into per-entry {@link ParseOutcome}s.
 * Accepts either a top-level array of item objects or a `{ items: [...] }`
 * envelope. A body that isn't valid JSON, or whose items aren't objects,
 * is fail-soft: invalid JSON yields a single `malformed` outcome and a
 * non-object item is skipped as `malformed`.
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

/**
 * Resolves the item list from a parsed CSL/Zotero body — a top-level array
 * or a `{ items: [...] }` envelope, else empty (nothing importable).
 */
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
  const authors = Array.isArray(obj.author) ? obj.author.map(cslAuthorName) : [];
  return toOutcome({
    title: obj.title,
    // CSL container/publisher live under `publisher`; year under `issued`.
    year: cslYear(obj.issued),
    publisher: obj.publisher,
    isbn: cslIsbn(obj.ISBN),
    doi: typeof obj.DOI === "string" ? obj.DOI : undefined,
    // `cslAuthorName` may yield null; `boundedAuthors` (via toOutcome's
    // sanitiseText) drops those, so a null-bearing list is safe here.
    authors,
  });
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
 * lines (an embedded newline), so we can't split naively on `\n`; we
 * track quote state across the join. Bounded by {@link MAX_RECORDS}.
 */
// reason: an irreducible single-pass row scanner — the quote-state + CRLF +
// cap branches are RFC-4180 row splitting and share a running buffer, so
// they can't be factored without relocating the same state. Covered by
// tests/unit/biblio-parse.test.ts (quoted commas, embedded newlines).
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
      // +1 row of headroom so a trailing data row past the cap is dropped,
      // not half-parsed.
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
 * Parses a reading-list CSV into per-entry {@link ParseOutcome}s. The
 * first row is a header; logical columns are matched by alias
 * ({@link CSV_COLUMNS}) so column order is irrelevant. Authors in a single
 * cell may be separated by `;` or ` and `. A file with no header, or a
 * header lacking a `title` column, yields a single `malformed` outcome.
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
    const authors =
      typeof authorCell === "string"
        ? authorCell.split(/\s*(?:;|\sand\s)\s*/i).filter((s) => s.trim().length > 0)
        : [];
    outcomes.push(
      toOutcome({
        title: cell(cells, "title"),
        year: cell(cells, "year"),
        publisher: cell(cells, "publisher"),
        isbn: cell(cells, "isbn"),
        doi: cell(cells, "doi"),
        authors,
      }),
    );
  }
  return outcomes;
}
