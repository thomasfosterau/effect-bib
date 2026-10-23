/**
 * File-format parsers for bibliographic import — **BibTeX**, **CSL-JSON**
 * (the Zotero export shape), **CSL YAML**, reading-list **CSV**, and **RIS** — each
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
 *   per-field length (`MAX_TEXT_FIELD_LENGTH`), author count
 *   (`MAX_AUTHORS`), and record count ({@link MAX_RECORDS}) are all capped,
 *   each by default; {@link ParseOptions} sets them per call. Input over the
 *   cap is one `too-large` outcome, and entries past the record cap one
 *   trailing `truncated` outcome, never a silent empty result.
 * - **source positions** — a BibTeX, RIS or CSV outcome carries the
 *   {@link SourcePosition} of its entry, for a toolchain to report.
 *
 * Two modes. **`import`** (the default) is the library-import policy: a
 * record needs a title **and** at least one dedup identifier (ISBN or DOI)
 * to parse; otherwise it is skipped (`no-title` / `no-identifier`), so file
 * imports share a dedup namespace with identifier lookups. **`lenient`**
 * reads every entry the format admits, as a document's bibliography needs:
 * no title or identifier is required, and CSL-JSON items are read with
 * {@link fromCslJson} in full. Either way an entry's key (BibTeX's citation
 * key, RIS `ID`, CSL-JSON `id` / `citation-key`) is the record's `id` and
 * `citation-key`. `provenance.source` records which format the record
 * arrived through.
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
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as String from "effect/String";
import type * as Types from "effect/Types";
import {
  decodeArxiv,
  decodeDoi,
  decodeIsbn,
  decodeIssn,
  decodePmcid,
  decodePmid,
} from "./identifiers.ts";
import { limitOr } from "./limits.ts";
import {
  type BiblioRecord,
  type CslItemType,
  type CslName,
  dateFromYear,
  fromCslJson,
  isCslItemType,
  readCslName,
  MAX_AUTHORS,
  MAX_TEXT_FIELD_LENGTH,
  parsePersonName,
  type ProvenanceSource,
  type RecordIdentifiers,
  type RecordLimits,
  sanitiseText,
  sanitiseYear,
} from "./record.ts";
import type { RawFields } from "./raw-fields.ts";
import { readYaml } from "./yaml.ts";
import type { BibtexBudgets } from "./bibtex/budget.ts";
import { mapBibtexEntries } from "./bibtex/fields.ts";
import { resolveInheritance } from "./bibtex/inherit.ts";
import { scanBibtex } from "./bibtex/scan.ts";

// ── Public surface ────────────────────────────────────────────────────

/**
 * The file formats this module can parse. `csl-yaml` was added in 1.0.0.
 *
 * @since 0.1.0
 */
export type ImportFormat = "bibtex" | "zotero-json" | "csl-yaml" | "csv" | "ris";

/**
 * Why a source entry produced no importable record. `too-large` and
 * `truncated` were added in 1.0.0.
 *
 * @since 0.1.0
 */
export type SkipReason =
  /** The entry carried neither a usable ISBN nor a usable DOI to key on (`import` mode). */
  | "no-identifier"
  /** The entry had no usable title (`import` mode). */
  | "no-title"
  /** The entry was structurally unparseable (e.g. a truncated BibTeX body). */
  | "malformed"
  /** The whole input was longer than the input cap and was not read: the one outcome. */
  | "too-large"
  /** Entries past the record cap were left out: the last outcome, after the first `maxRecords`. */
  | "truncated";

/**
 * Where an entry starts in its source: the offset (UTF-16 code units, from
 * 0) and the line and column (from 1) of its first character — a BibTeX
 * entry's `@`, an RIS record's `TY` tag, a CSV row's first cell.
 *
 * @since 1.0.0
 */
export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/**
 * A source entry that did not yield a record, with the reason it was
 * dropped, and where the entry starts when the format has positions.
 *
 * @since 0.1.0
 */
export interface SkippedEntry {
  readonly outcome: "skipped";
  readonly reason: SkipReason;
  readonly position?: SourcePosition;
}

/**
 * A source entry that parsed into a {@link BiblioRecord}, and where the
 * entry starts when the format has positions.
 *
 * @since 0.1.0
 */
export interface ParsedEntry {
  readonly outcome: "parsed";
  readonly record: BiblioRecord;
  readonly position?: SourcePosition;
}

/**
 * The per-entry result of parsing one source entry.
 *
 * @since 0.1.0
 */
export type ParseOutcome = ParsedEntry | SkippedEntry;

/**
 * The default cap on the entries one input yields; parsing stops at the cap
 * and reports the tail as one `truncated` outcome, so a hostile file cannot
 * force unbounded work. {@link ParseOptions} sets it per call.
 *
 * @since 0.1.0
 */
export const MAX_RECORDS = 5000;

/**
 * The default cap on the raw input length, in UTF-16 code units. A longer
 * input is not read: it yields one `too-large` outcome. ~8 MB comfortably
 * holds tens of thousands of entries. {@link ParseOptions} sets it per call.
 *
 * @since 0.1.0
 */
export const MAX_INPUT_LENGTH = 8_000_000;

/**
 * What a parser keeps: `import` applies the library-import policy (a title
 * and an ISBN or DOI, else a `no-title` / `no-identifier` skip); `lenient`
 * keeps every entry the format admits.
 *
 * @since 1.0.0
 */
export type ParseMode = "import" | "lenient";

/**
 * How a parser reads one input: the {@link ParseMode} (default `import`),
 * and its bounds, each defaulting to today's constant — `maxRecords`
 * ({@link MAX_RECORDS}), `maxInputLength` ({@link MAX_INPUT_LENGTH}) and,
 * per record, `maxFieldLength` and `maxAuthors` ({@link RecordLimits}). A
 * non-positive or non-integer bound falls back to its default.
 *
 * `bibtexMarkup` (default `false`) keeps BibTeX's formatting as CSL
 * rich-text markup in text fields, where by default it is dropped:
 * `\emph{…}` / `\textit{…}` → `<i>…</i>`, `\textbf{…}` → `<b>…</b>`,
 * `\textsc{…}` → `<span style="font-variant:small-caps;">…</span>`,
 * `\textsuperscript{…}` / `\textsubscript{…}` → `<sup>` / `<sub>`, and a
 * case-protecting group, `{DNA}`, → `<span class="nocase">DNA</span>`. CSL
 * markup has no escape, so with it on a literal `<` in the BibTeX text is
 * written as `<span class="nocase"><</span>`: it reads back (with
 * {@link parseCslMarkup}, or any CSL processor) as the `<` it is, never as a
 * tag. Names, dates and identifiers are not affected.
 *
 * @since 1.0.0
 */
export interface ParseOptions extends RecordLimits {
  readonly mode?: ParseMode;
  readonly maxRecords?: number;
  readonly maxInputLength?: number;
  readonly bibtexMarkup?: boolean;
}

/** {@link ParseOptions} with every default applied. */
interface Settings {
  readonly lenient: boolean;
  readonly maxRecords: number;
  readonly maxInputLength: number;
  readonly maxFieldLength: number;
  readonly maxAuthors: number;
  readonly cslMarkup: boolean;
}

/** Applies the defaults to a caller's options. */
function settings(options: ParseOptions): Settings {
  return {
    lenient: options.mode === "lenient",
    maxRecords: limitOr(Option.fromUndefinedOr(options.maxRecords), MAX_RECORDS),
    maxInputLength: limitOr(Option.fromUndefinedOr(options.maxInputLength), MAX_INPUT_LENGTH),
    maxFieldLength: limitOr(Option.fromUndefinedOr(options.maxFieldLength), MAX_TEXT_FIELD_LENGTH),
    maxAuthors: limitOr(Option.fromUndefinedOr(options.maxAuthors), MAX_AUTHORS),
    cslMarkup: options.bibtexMarkup === true,
  };
}

/** The one outcome for an input over the cap. */
const TOO_LARGE: readonly ParseOutcome[] = [{ outcome: "skipped", reason: "too-large" }];

/** The trailing outcome after the record cap. */
const TRUNCATED: ParseOutcome = { outcome: "skipped", reason: "truncated" };

/**
 * Runs a parser over an input within its cap: `too-large` over it, else
 * the parser's outcomes.
 */
function withinInputCap(
  content: string,
  config: Settings,
  parse: (content: string, config: Settings) => ParseOutcome[],
): ParseOutcome[] {
  return content.length > config.maxInputLength ? [...TOO_LARGE] : parse(content, config);
}

/** The first `maxRecords` of `items`, and whether any were left out. */
function capped<A>(items: readonly A[], config: Settings): readonly [A[], boolean] {
  return [items.slice(0, config.maxRecords), items.length > config.maxRecords];
}

/** Appends the `truncated` outcome when entries were left out. */
const endOutcomes = (outcomes: ParseOutcome[], truncated: boolean): ParseOutcome[] =>
  truncated ? [...outcomes, TRUNCATED] : outcomes;

/** The offsets at which each line of `content` starts. */
function lineStarts(content: string): readonly number[] {
  return [
    0,
    ...Array.map(
      Array.fromIterable(content.matchAll(/\r\n?|\n/g)),
      (match) => match.index + match[0].length,
    ),
  ];
}

/** The index of the last line start at or before `offset` (a binary search over `[low, high]`). */
function lineIndex(starts: readonly number[], offset: number, low: number, high: number): number {
  if (low >= high) return low;
  const mid = Math.ceil((low + high) / 2);
  return starts[mid] <= offset
    ? lineIndex(starts, offset, mid, high)
    : lineIndex(starts, offset, low, mid - 1);
}

/** Line and column lookup for offsets into one input: the line starts are found once. */
function locator(content: string): (offset: number) => SourcePosition {
  const starts = lineStarts(content);
  return (offset) => {
    const line = lineIndex(starts, offset, 0, starts.length - 1);
    return { offset, line: line + 1, column: offset - starts[line] + 1 };
  };
}

/** An outcome with its entry's position. */
const at = (outcome: ParseOutcome, position: SourcePosition): ParseOutcome => ({
  ...outcome,
  position,
});

/**
 * Parses raw file `content` of the given `format` into a list of
 * per-entry {@link ParseOutcome}s. Pure: no network, no database. Over the
 * input-length cap the input yields one `too-large` outcome; otherwise
 * every recognised entry yields exactly one outcome, up to the record cap,
 * then one `truncated` outcome if more entries followed. `options` sets the
 * {@link ParseMode} and the bounds.
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
export function parseBibliographicFile(
  content: string,
  format: ImportFormat,
  options: ParseOptions = {},
): ParseOutcome[] {
  return Match.value(format).pipe(
    Match.when("bibtex", () => parseBibtex(content, options)),
    Match.when("zotero-json", () => parseZoteroJson(content, options)),
    Match.when("csl-yaml", () => parseCslYaml(content, options)),
    Match.when("csv", () => parseCsv(content, options)),
    Match.when("ris", () => parseRis(content, options)),
    Match.exhaustive,
  );
}

// ── Shared record assembly ────────────────────────────────────────────

/** The subset of CSL string variables the parsers populate. */
type ParserStringVar =
  | "citation-key"
  | "publisher"
  | "container-title"
  | "volume"
  | "issue"
  | "page";

/**
 * Lifts a raw field bag into a single {@link ParseOutcome}, applying the
 * full untrusted-data discipline: sanitise the title, validate the
 * identifiers by checksum, and bound the optional fields. In `import` mode
 * a missing title skips as `no-title` and a missing dedup key (ISBN or DOI)
 * as `no-identifier`. The item type is taken verbatim when the format
 * supplies one, else inferred from the identifier (ISBN → book, DOI →
 * article-journal, neither → document).
 */
function toOutcome(fields: RawFields, source: ProvenanceSource, config: Settings): ParseOutcome {
  const title = sanitiseTitle(fields.title, fields.subtitle, config.maxFieldLength);
  if (Option.isNone(title) && !config.lenient) return { outcome: "skipped", reason: "no-title" };
  const year = Option.flatMap(fields.year, sanitiseYear);
  const identifiers = assembleIdentifiers(fields);
  if (identifiers.isbn === undefined && identifiers.doi === undefined && !config.lenient) {
    return { outcome: "skipped", reason: "no-identifier" };
  }

  const optional: Types.Mutable<Pick<BiblioRecord, "id" | "title" | "issued">> = {};
  const id = Option.flatMap(fields.id, (value): Option.Option<string | number> =>
    Predicate.isNumber(value) ? Option.some(value) : sanitiseText(value, config.maxFieldLength),
  );
  if (Option.isSome(id)) optional.id = id.value;
  if (Option.isSome(title)) optional.title = title.value;
  if (Option.isSome(year)) optional.issued = dateFromYear(year.value);
  const record: BiblioRecord = {
    type: Option.getOrElse(fields.type, (): CslItemType =>
      identifiers.isbn !== undefined
        ? "book"
        : identifiers.doi !== undefined
          ? "article-journal"
          : "document",
    ),
    ...optional,
    ...collectStringVars(fields, config.maxFieldLength),
    ...collectContributors(fields, config.maxAuthors),
    identifiers,
    provenance: { source },
  };
  return { outcome: "parsed", record };
}

/** Validates the raw identifiers into the branded sub-record, dropping what fails. */
function assembleIdentifiers(fields: RawFields): RecordIdentifiers {
  const identifiers: Types.Mutable<RecordIdentifiers> = {};
  const isbn = Option.flatMap(fields.isbn, decodeIsbn);
  if (Option.isSome(isbn)) identifiers.isbn = isbn.value;
  const doi = Option.flatMap(fields.doi, decodeDoi);
  if (Option.isSome(doi)) identifiers.doi = doi.value;
  const issn = Option.flatMap(fields.issn, decodeIssn);
  if (Option.isSome(issn)) identifiers.issn = issn.value;
  const pmid = Option.flatMap(fields.pmid, decodePmid);
  if (Option.isSome(pmid)) identifiers.pmid = pmid.value;
  const pmcid = Option.flatMap(fields.pmcid, decodePmcid);
  if (Option.isSome(pmcid)) identifiers.pmcid = pmcid.value;
  const arxiv = Option.flatMap(fields.arxiv, decodeArxiv);
  if (Option.isSome(arxiv)) identifiers.arxiv = arxiv.value;
  return identifiers;
}

/** Collects the sanitised CSL string variables a parser populated. */
function collectStringVars(
  fields: RawFields,
  maxFieldLength: number,
): Partial<Record<ParserStringVar, string>> {
  const strings: Partial<Record<ParserStringVar, string>> = {};
  const assign = (key: ParserStringVar, value: Option.Option<string>): void => {
    const clean = Option.flatMap(value, (text) => sanitiseText(text, maxFieldLength));
    if (Option.isSome(clean)) strings[key] = clean.value;
  };
  assign("citation-key", fields.citationKey);
  assign("publisher", fields.publisher);
  assign("container-title", fields.containerTitle);
  assign("volume", fields.volume);
  assign("issue", fields.issue);
  assign("page", fields.page);
  return strings;
}

/** Collects the bounded author / editor name lists. */
function collectContributors(
  fields: RawFields,
  maxAuthors: number,
): Partial<Pick<BiblioRecord, "author" | "editor">> {
  const contributors: Types.Mutable<Partial<Pick<BiblioRecord, "author" | "editor">>> = {};
  if (Array.isReadonlyArrayNonEmpty(fields.names)) {
    contributors.author = fields.names.slice(0, maxAuthors);
  }
  if (Array.isReadonlyArrayNonEmpty(fields.editors)) {
    contributors.editor = fields.editors.slice(0, maxAuthors);
  }
  return contributors;
}

/**
 * Sanitises the title, folding a subtitle in the `Title: Subtitle` shape
 * the OpenLibrary normaliser uses so both import paths agree.
 * `Option.none()` when there is no usable title.
 */
function sanitiseTitle(
  rawTitle: Option.Option<string>,
  rawSubtitle: Option.Option<string>,
  maxFieldLength: number,
): Option.Option<string> {
  const clean = (value: string): Option.Option<string> => sanitiseText(value, maxFieldLength);
  const base = Option.flatMap(rawTitle, clean);
  if (Option.isNone(base)) return Option.none();
  const subtitle = Option.flatMap(rawSubtitle, clean);
  return Option.isNone(subtitle) ? base : clean(`${base.value}: ${subtitle.value}`);
}

/** Structures a list of display-form names, bounded and empties dropped. */
function structuredNames(raw: readonly string[], maxAuthors: number): CslName[] {
  return Array.filterMap(raw, (value): Result.Result<CslName, void> => {
    const name = parsePersonName(value);
    return name === null ? Result.failVoid : Result.succeed(name);
  }).slice(0, maxAuthors);
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
 * `file` is dropped. The entry's key is the record's `id` and
 * `citation-key`, and each outcome carries the position of its entry's `@`.
 * In the default `import` mode an entry still needs a title and an ISBN or
 * DOI; in `lenient` mode every entry is a record.
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
 * assert.strictEqual(chapter?.["citation-key"], "chapter")
 * assert.deepStrictEqual(outcomes[1].position, { offset: 168, line: 3, column: 1 })
 *
 * // A document's bibliography: no identifier needed.
 * const [thesis] = parseBibtex("@phdthesis{doe2020, title = {On Things}, author = {Doe, Jane}, school = {MIT}, year = 2020}", { mode: "lenient" })
 * assert.strictEqual(thesis.outcome === "parsed" ? thesis.record.genre : undefined, "PhD thesis")
 * ```
 *
 * @since 0.1.0
 */
export function parseBibtex(content: string, options: ParseOptions = {}): ParseOutcome[] {
  return withinInputCap(content, settings(options), (input, config) =>
    bibtexOutcomes(input, config, Option.none()),
  );
}

/** The outcomes of a BibTeX document within the cap, spending `budgets` when given, else fresh ones. */
function bibtexOutcomes(
  input: string,
  config: Settings,
  budgets: Option.Option<BibtexBudgets>,
): ParseOutcome[] {
  const scan = Option.match(budgets, {
    onNone: () => scanBibtex(input, config.maxRecords, config.maxInputLength),
    onSome: ({ macros }) => scanBibtex(input, config.maxRecords, config.maxInputLength, macros),
  });
  const entries = resolveInheritance(scan.entries);
  const position = locator(input);
  const mapped = Option.match(budgets, {
    onNone: () => mapBibtexEntries(entries, config),
    onSome: ({ decoded }) => mapBibtexEntries(entries, config, decoded),
  });
  const outcomes = Array.map(
    Array.zip(entries, mapped),
    ([entry, { fields, additions }]): ParseOutcome => {
      const outcome = toOutcome(fields, "bibtex", config);
      return at(
        outcome.outcome === "parsed"
          ? { outcome: "parsed", record: { ...outcome.record, ...additions } }
          : outcome,
        position(entry.offset),
      );
    },
  );
  return endOutcomes(outcomes, scan.truncated);
}

/**
 * `parseBibtex` for one document of a streamed parse: the same reading,
 * spending the stream's shared macro-expansion and decoding budgets rather
 * than fresh ones, so a stream of many small documents cannot claim a full
 * budget for each. Internal to the streaming front end: not exported from
 * the package.
 *
 * @category internal
 * @since 1.0.0
 */
export function parseBibtexDocument(
  content: string,
  options: ParseOptions,
  budgets: BibtexBudgets,
): ParseOutcome[] {
  return withinInputCap(content, settings(options), (input, config) =>
    bibtexOutcomes(input, config, Option.some(budgets)),
  );
}

// ── Zotero / CSL-JSON ─────────────────────────────────────────────────

/**
 * Parses a Zotero / CSL-JSON export into per-entry {@link ParseOutcome}s.
 * Accepts a top-level array of item objects or a `{ items: [...] }`
 * envelope. Invalid JSON yields a single `malformed` outcome; a non-object
 * item is skipped as `malformed`. Each item is read in full with
 * {@link fromCslJson}, so importing a file is no lossier than decoding one
 * item; in `import` mode the policy then applies (a title and an ISBN or
 * DOI), and an item with no valid `type` is typed by its identifier (an
 * ISBN → `book`, a DOI → `article-journal`). JSON carries no positions, so
 * these outcomes have none.
 *
 * @since 0.1.0
 */
export function parseZoteroJson(content: string, options: ParseOptions = {}): ParseOutcome[] {
  return withinInputCap(content, settings(options), (input, config) => {
    const data = decodeJsonBody(input);
    if (Option.isNone(data)) return [{ outcome: "skipped", reason: "malformed" }];
    return cslItemOutcomes(
      Option.getOrElse(
        Option.orElse(decodeCslItemArray(data.value), () =>
          Option.map(decodeCslEnvelope(data.value), (envelope) => envelope.items),
        ),
        (): readonly unknown[] => [],
      ),
      config,
    );
  });
}

/** The outcomes of a list of CSL items (from CSL-JSON or CSL YAML), up to the record cap. */
function cslItemOutcomes(all: readonly unknown[], config: Settings): ParseOutcome[] {
  const [items, truncated] = capped(all, config);
  const outcomes = Array.map(items, (item): ParseOutcome => {
    if (!Predicate.isObjectOrArray(item)) return { outcome: "skipped", reason: "malformed" };
    const record = fromCslJson(item, config);
    if (config.lenient) return { outcome: "parsed", record };
    const declared = Option.filter(
      Option.flatMap(decodeTypedItem(item), (typed) => Option.fromUndefinedOr(typed.type)),
      isCslItemType,
    );
    return cslImportOutcome(record, declared);
  });
  return endOutcomes(outcomes, truncated);
}

/** An item object's `type` member, when it is text. */
const decodeTypedItem = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.optional(Schema.String) }),
);

/**
 * Applies the import policy to a CSL item read in full: a title and an ISBN
 * or DOI, and a type from the identifier when the item declared none.
 */
function cslImportOutcome(
  record: BiblioRecord,
  declared: Option.Option<CslItemType>,
): ParseOutcome {
  if (record.title === undefined) return { outcome: "skipped", reason: "no-title" };
  const { isbn, doi } = record.identifiers;
  if (isbn === undefined && doi === undefined)
    return { outcome: "skipped", reason: "no-identifier" };
  const type = Option.getOrElse(declared, (): CslItemType =>
    isbn !== undefined ? "book" : "article-journal",
  );
  return { outcome: "parsed", record: { ...record, type } };
}

/** Decodes an untrusted JSON document body; `None` when the text is not JSON. */
const decodeJsonBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** A parsed CSL body that is a bare array of items. */
const decodeCslItemArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

/** A parsed CSL body that is a `{ items: [...] }` envelope. */
const decodeCslEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({ items: Schema.Array(Schema.Unknown) }),
);

// ── CSL YAML ──────────────────────────────────────────────────────────

/** A parsed CSL YAML body: a `references:` mapping (Pandoc's form). */
const decodeCslReferences = Schema.decodeUnknownOption(
  Schema.Struct({ references: Schema.Array(Schema.Unknown) }),
);

/**
 * Parses CSL YAML — a Pandoc bibliography file, or a Markdown document's
 * front matter, holding `references:` — into per-entry
 * {@link ParseOutcome}s. It is the same data as CSL-JSON in YAML form, read
 * the same way (each item in full with {@link fromCslJson}, the `import`
 * policy on top); a bare top-level list of items is read too. The YAML
 * reader takes the subset bibliographies are written in (block mappings and
 * lists, one-line flow lists, plain, quoted and block scalars, comments);
 * YAML outside it (anchors, aliases, tags), or a document with no
 * references, is one `malformed` outcome. YAML carries no positions here,
 * so the outcomes have none.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { parseCslYaml } from "@thomasfosterau/biblio"
 *
 * const markdown = [
 *   "---",
 *   "title: My paper",
 *   "references:",
 *   "- id: harari2015",
 *   "  type: book",
 *   "  title: 'Sapiens: A Brief History of Humankind'",
 *   "  author:",
 *   "  - family: Harari",
 *   "    given: Yuval Noah",
 *   "  issued:",
 *   "    date-parts: [[2015]]",
 *   "  ISBN: 9780062316097",
 *   "---",
 *   "",
 *   "As @harari2015 argues…",
 * ].join("\n")
 *
 * const [outcome] = parseCslYaml(markdown)
 * const record = outcome.outcome === "parsed" ? outcome.record : undefined
 * assert.strictEqual(record?.title, "Sapiens: A Brief History of Humankind")
 * assert.strictEqual(record?.identifiers.isbn, "9780062316097")
 * assert.deepStrictEqual(record?.issued, { "date-parts": [[2015]] })
 * ```
 *
 * @since 1.0.0
 */
export function parseCslYaml(content: string, options: ParseOptions = {}): ParseOutcome[] {
  return withinInputCap(content, settings(options), (input, config) => {
    const items = Option.flatMap(readYaml(input), (data) =>
      Option.orElse(
        Option.map(decodeCslReferences(data), (body) => body.references),
        () => decodeCslItemArray(data),
      ),
    );
    return Option.match(items, {
      onNone: (): ParseOutcome[] => [{ outcome: "skipped", reason: "malformed" }],
      onSome: (list) => cslItemOutcomes(list, config),
    });
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

/** One logical CSV row: its text and the offset of its first character. */
interface CsvRow {
  readonly text: string;
  readonly offset: number;
}

/**
 * Splits CSV content into logical rows. A quoted cell may span physical
 * lines (an embedded newline), so we track quote state across the join.
 * Stops past `maxRows` rows.
 */
// reason: an irreducible single-pass row scanner — the quote-state + CRLF +
// cap branches are RFC-4180 row splitting and share a running buffer.
// fallow-ignore-next-line complexity
function splitCsvRows(content: string, maxRows: number): CsvRow[] {
  const rows: CsvRow[] = [];
  let cur = "";
  let start = 0;
  let inQuote = false;
  // oxlint-disable-next-line effect/imperative-loops -- RFC-4180 row scanner: it needs to skip the `\n` of a CRLF pair (`i++`), which a fold cannot express, and `content.split("")` would allocate one array element per UTF-16 unit of an input bounded only by the input cap — a memory-DoS regression.
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') inQuote = !inQuote;
    if ((c === "\n" || c === "\r") && !inQuote) {
      if (c === "\r" && content[i + 1] === "\n") i++; // CRLF
      if (String.isNonEmpty(cur)) rows.push({ text: cur, offset: start });
      cur = "";
      start = i + 1;
      if (rows.length > maxRows) break;
    } else cur += c;
  }
  if (String.isNonEmpty(cur)) rows.push({ text: cur, offset: start });
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
  key: ["key", "citation key", "citation-key", "citationkey", "id"],
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
 * irrelevant (a `key` / `citation key` / `id` column is the record's `id`
 * and `citation-key`). Authors in a single cell may be separated by `;` or
 * ` and `. A file with no header, or a header lacking a `title` column,
 * yields a single `malformed` outcome. The item type is inferred from the
 * identifier.
 *
 * @since 0.1.0
 */
export function parseCsv(content: string, options: ParseOptions = {}): ParseOutcome[] {
  return withinInputCap(content, settings(options), csvOutcomes);
}

/** The CSV outcomes of an input within the cap. */
function csvOutcomes(content: string, config: Settings): ParseOutcome[] {
  // The header, the cap, and one row more to tell a truncated file.
  const rows = splitCsvRows(content, config.maxRecords + 1);
  if (Array.isArrayEmpty(rows)) return [];
  const header = parseCsvLine(rows[0].text);
  const index = csvHeaderIndex(header);
  if (index.title === undefined) return [{ outcome: "skipped", reason: "malformed" }];

  const cell = (cells: readonly string[], key: CsvColumn): Option.Option<string> =>
    Option.flatMap(Option.fromUndefinedOr(index[key]), (column) => Array.get(cells, column));
  const position = locator(content);
  const [body, truncated] = capped(rows.slice(1), config);

  const outcomes = Array.map(body, (row) => {
    const cells = parseCsvLine(row.text);
    const authorNames = Option.match(cell(cells, "author"), {
      onNone: (): string[] => [],
      onSome: (authorCell) =>
        authorCell.split(/\s*(?:;|\sand\s)\s*/i).filter((s) => String.isNonEmpty(s.trim())),
    });
    const key = cell(cells, "key");
    const outcome = toOutcome(
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
        pmid: Option.none(),
        pmcid: Option.none(),
        arxiv: Option.none(),
        id: key,
        citationKey: key,
        names: structuredNames(authorNames, config.maxAuthors),
        editors: [],
      },
      "csv",
      config,
    );
    return at(outcome, position(row.offset));
  });
  return endOutcomes(outcomes, truncated);
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
function splitRisRecords(content: string, maxRecords: number): RisRecord[] {
  const records: RisRecord[] = [];
  /** Appends a finished record; `false` once one past the record cap is reached. */
  const push = (record: RisRecord): boolean => {
    records.push(record);
    return records.length <= maxRecords;
  };
  const initial: RisScan = { current: Option.none(), done: false, offset: 0 };
  const lines = content.split(/(\r?\n)/);
  const trailing = Array.reduce(lines, initial, (state, line, index): RisScan => {
    const next = state.offset + line.length;
    // The split keeps each line break as its own element, at the odd indices.
    if (state.done || index % 2 === 1) return { ...state, offset: next };
    const match = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (match === null) return { ...state, offset: next };
    const tag = match[1];
    const value = match[2].trim();
    if (tag === "TY") {
      if (Option.isSome(state.current) && !push(state.current.value)) {
        return { current: Option.none(), done: true, offset: next };
      }
      const started: RisRecord = { tags: MutableHashMap.empty(), offset: state.offset };
      addRisTag(started, tag, value);
      return { current: Option.some(started), done: false, offset: next };
    }
    if (tag === "ER") {
      if (Option.isNone(state.current)) return { ...state, offset: next };
      return { current: Option.none(), done: !push(state.current.value), offset: next };
    }
    if (Option.isSome(state.current)) addRisTag(state.current.value, tag, value);
    return { ...state, offset: next };
  });
  if (Option.isSome(trailing.current) && records.length <= maxRecords) {
    records.push(trailing.current.value);
  }
  return records;
}

/** The RIS scanner's running state: the record being read, whether the record cap was hit, and the offset of the next line. */
interface RisScan {
  readonly current: Option.Option<RisRecord>;
  readonly done: boolean;
  readonly offset: number;
}

/** One RIS record: each two-character tag mapped to its values, in order, and the offset of its `TY` line. */
interface RisRecord {
  readonly tags: MutableHashMap.MutableHashMap<string, string[]>;
  readonly offset: number;
}

/** Appends a tag value to an RIS record's multimap. */
function addRisTag(record: RisRecord, tag: string, value: string): void {
  const existing = MutableHashMap.get(record.tags, tag);
  if (Option.isNone(existing)) MutableHashMap.set(record.tags, tag, [value]);
  else existing.value.push(value);
}

/** The first value of an RIS tag, or `None`. */
function risFirst(record: RisRecord, tag: string): Option.Option<string> {
  return Option.flatMap(MutableHashMap.get(record.tags, tag), Array.head);
}

/** All values across a set of RIS tags, in order. */
function risAll(record: RisRecord, tags: readonly string[]): string[] {
  return Array.flatMap(tags, (tag) => risValues(record, tag));
}

/** All values recorded for one RIS tag, in order. */
function risValues(record: RisRecord, tag: string): readonly string[] {
  return Option.getOrElse(MutableHashMap.get(record.tags, tag), (): string[] => []);
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

/**
 * Structures RIS names: `Last, First, Suffix` (the suffix is the text after
 * a second comma), else as a display-form name; bounded and empties dropped.
 */
function risNames(raw: readonly string[], maxAuthors: number): CslName[] {
  return Array.filterMap(raw, (value): Result.Result<CslName, void> => {
    const parts = value.split(",");
    return Result.fromOption(
      parts.length >= 3
        ? readCslName({ family: parts[0], given: parts[1], suffix: parts.slice(2).join(",") })
        : Option.fromNullishOr(parsePersonName(value)),
      () => undefined,
    );
  }).slice(0, maxAuthors);
}

/** Maps one RIS record multimap to a {@link ParseOutcome}. */
function risRecordOutcome(record: RisRecord, config: Settings): ParseOutcome {
  const serials = risSerials(record);
  const key = risFirst(record, "ID");
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
      pmid: Option.none(),
      pmcid: Option.none(),
      arxiv: Option.none(),
      id: key,
      citationKey: key,
      names: risNames(risAll(record, ["AU", "A1"]), config.maxAuthors),
      editors: risNames(risAll(record, ["ED", "A2"]), config.maxAuthors),
    },
    "ris",
    config,
  );
}

/**
 * Parses an RIS document into per-entry {@link ParseOutcome}s. A record's
 * `ID` tag is its `id` and `citation-key`; each outcome carries the position
 * of its `TY` line.
 *
 * @since 0.1.0
 */
export function parseRis(content: string, options: ParseOptions = {}): ParseOutcome[] {
  return withinInputCap(content, settings(options), (input, config) => {
    const position = locator(input);
    const [records, truncated] = capped(splitRisRecords(input, config.maxRecords), config);
    return endOutcomes(
      Array.map(records, (record) => at(risRecordOutcome(record, config), position(record.offset))),
      truncated,
    );
  });
}
