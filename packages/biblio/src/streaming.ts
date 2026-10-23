/**
 * Effect and `Stream` front ends for the file parsers: the same reading as
 * {@link parseBibliographicFile}, with an over-cap input as a typed
 * {@link InputTooLarge} failure rather than a `too-large` outcome, and a
 * streaming reader that takes a large file as text chunks and emits each
 * entry's outcome as soon as the entry is complete, so the whole file never
 * has to be in memory.
 *
 * @copyright Thomas Foster
 * @module biblio/streaming
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as MutableHashSet from "effect/MutableHashSet";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as String from "effect/String";
import type { BibtexBudgets } from "./bibtex/budget.ts";
import { DECODED_SOURCE_FACTOR } from "./bibtex/fields.ts";
import { MIN_MACRO_EXPANSION } from "./bibtex/scan.ts";
import { limitOr } from "./limits.ts";
import {
  type ImportFormat,
  MAX_INPUT_LENGTH,
  MAX_RECORDS,
  parseBibliographicFile,
  parseBibtexDocument,
  parseCsv,
  type ParseOptions,
  type ParseOutcome,
  parseRis,
  type SourcePosition,
} from "./parse.ts";

/**
 * An input longer than the parse's `maxInputLength`: for
 * {@link parseBibliographic}, the whole input; for
 * {@link parseBibliographicStream}, the text it must hold at once (one entry,
 * with the macros and cross-referenced parents it carries).
 *
 * @since 1.0.0
 */
export class InputTooLarge extends Schema.TaggedError<InputTooLarge>()("InputTooLarge", {
  format: Schema.String,
  maxInputLength: Schema.Finite,
  message: Schema.String,
}) {}

/** The failure for an input over `limit`. */
const tooLarge = (format: ImportFormat, limit: number): InputTooLarge =>
  new InputTooLarge({
    format,
    maxInputLength: limit,
    message: `The ${format} input is longer than ${limit} characters`,
  });

/** The caller's input cap, defaulted. */
const inputCap = (options: ParseOptions): number =>
  limitOr(Option.fromUndefinedOr(options.maxInputLength), MAX_INPUT_LENGTH);

/**
 * Parses a whole bibliographic file, as {@link parseBibliographicFile} does,
 * as an `Effect` that fails with {@link InputTooLarge} when the input is
 * over `options.maxInputLength` (instead of yielding one `too-large`
 * outcome). Every other outcome, `skipped` and `truncated` included, is
 * returned as the pure parser returns it.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Effect from "effect/Effect"
 * import * as Exit from "effect/Exit"
 * import { parseBibliographic } from "@thomasfosterau/biblio"
 *
 * const ris = "TY  - BOOK\nTI  - Sapiens\nSN  - 9780062316097\nER  - "
 * const outcomes = Effect.runSync(parseBibliographic(ris, "ris"))
 * assert.strictEqual(outcomes[0].outcome, "parsed")
 *
 * const exit = Effect.runSyncExit(parseBibliographic(ris, "ris", { maxInputLength: 10 }))
 * assert.ok(Exit.isFailure(exit))
 * ```
 *
 * @since 1.0.0
 */
export const parseBibliographic = (
  content: string,
  format: ImportFormat,
  options: ParseOptions = {},
): Effect.Effect<ParseOutcome[], InputTooLarge> =>
  Effect.suspend(() =>
    content.length > inputCap(options)
      ? Effect.fail(tooLarge(format, inputCap(options)))
      : Effect.succeed(parseBibliographicFile(content, format, options)),
  );

// ── Splitting a stream into entries ───────────────────────────────────

/** One complete entry of the input: its text and where it starts. */
interface Unit {
  readonly text: string;
  readonly position: SourcePosition;
}

/** Where in the buffer the next entry runs: `[start, end)`; `None` when it is not complete yet. */
type Finder = (buffer: string, final: boolean) => Option.Option<readonly [number, number]>;

/** The input not yet split, and where its first character sits in the whole input. */
interface Buffered {
  readonly text: string;
  readonly position: SourcePosition;
  /** The buffer length at the last failed attempt; the next waits until it has grown by half. */
  readonly tried: number;
}

/** The position after `text`, starting from `from` (CRLF, CR and LF each end a line). */
function advance(from: SourcePosition, text: string): SourcePosition {
  const breaks = Array.fromIterable(text.matchAll(/\r\n?|\n/g));
  return Option.match(Array.last(breaks), {
    onNone: () => ({
      ...from,
      offset: from.offset + text.length,
      column: from.column + text.length,
    }),
    onSome: (last) => ({
      offset: from.offset + text.length,
      line: from.line + breaks.length,
      column: text.length - (last.index + last[0].length) + 1,
    }),
  });
}

/** The complete entries at the front of the buffer, and what is left. */
function split(
  buffered: Buffered,
  find: Finder,
  final: boolean,
): readonly [units: Unit[], rest: Buffered] {
  const units: Unit[] = [];
  const state = { text: buffered.text, position: buffered.position, going: true };
  // oxlint-disable-next-line effect/imperative-loops -- each entry's extent is known only once it is found, and the next search starts where it ended; the number of entries in a chunk is not known in advance.
  while (state.going) {
    const found = find(state.text, final);
    if (Option.isNone(found)) state.going = false;
    else {
      const [start, end] = found.value;
      const position = advance(state.position, state.text.slice(0, start));
      units.push({ text: state.text.slice(start, end), position });
      state.position = advance(position, state.text.slice(start, end));
      state.text = state.text.slice(end);
    }
  }
  return [units, { text: state.text, position: state.position, tried: state.text.length }];
}

/** The index of the brace or parenthesis that closes the entry opened at `open`, or `None`. */
function closing(text: string, open: number): Option.Option<number> {
  const paren = text[open] === "(";
  const state = { depth: 0, at: -1 };
  // oxlint-disable-next-line effect/imperative-loops -- a single-pass brace scanner that stops at the closing delimiter; a fold over the characters would allocate one element per character of an entry bounded only by the input cap.
  for (let index = open + 1; index < text.length && state.at < 0; index++) {
    const char = text[index];
    if (char === "{") state.depth++;
    else if (char === "}") {
      if (state.depth === 0 && !paren) state.at = index;
      else state.depth--;
    } else if (char === ")" && paren && state.depth === 0) state.at = index;
  }
  return state.at < 0 ? Option.none() : Option.some(state.at);
}

/** An entry head: `@type` and its opening delimiter. */
const ENTRY_HEAD = /@\s*[A-Za-z]+\s*[{(]/g;

/** A BibTeX entry: from its `@` to its closing delimiter (the rest of the input at the end). */
const findBibtex: Finder = (buffer, final) => {
  ENTRY_HEAD.lastIndex = 0;
  const head = ENTRY_HEAD.exec(buffer);
  if (head === null)
    return final && String.isNonEmpty(buffer)
      ? Option.some([buffer.length, buffer.length])
      : Option.none();
  const open = head.index + head[0].length - 1;
  return Option.match(closing(buffer, open), {
    onNone: () => (final ? Option.some([head.index, buffer.length] as const) : Option.none()),
    onSome: (close) => Option.some([head.index, close + 1] as const),
  });
};

/** An RIS record: from its `TY` line to the end of its `ER` line, or to the next `TY`. */
const findRis: Finder = (buffer, final) => {
  const start = /^TY {2}-/m.exec(buffer);
  if (start === null)
    return final && String.isNonEmpty(buffer)
      ? Option.some([buffer.length, buffer.length])
      : Option.none();
  const after = /^(?:ER {2}-[^\r\n]*(?:\r\n?|\n)|TY {2}-)/gm;
  after.lastIndex = start.index + 1;
  const end = after.exec(buffer);
  if (end === null)
    return final ? Option.some([start.index, buffer.length] as const) : Option.none();
  return Option.some([
    start.index,
    end[0].startsWith("TY") ? end.index : end.index + end[0].length,
  ] as const);
};

/** The end of the CSV row starting at `from` (past its line break), quotes spanning lines; `None` when open. */
function rowEnd(text: string, from: number): Option.Option<number> {
  const state = { quoted: false, at: -1 };
  // oxlint-disable-next-line effect/imperative-loops -- the RFC-4180 row scanner (see parse.ts's splitCsvRows), stopping at the row's end.
  for (let index = from; index < text.length && state.at < 0; index++) {
    const char = text[index];
    if (char === '"') state.quoted = !state.quoted;
    else if ((char === "\n" || char === "\r") && !state.quoted) {
      state.at = char === "\r" && text[index + 1] === "\n" ? index + 2 : index + 1;
    }
  }
  return state.at < 0 ? Option.none() : Option.some(state.at);
}

/** A CSV row (the header included), with its line break. */
const findCsv: Finder = (buffer, final) => {
  if (String.isEmpty(buffer)) return Option.none();
  return Option.match(rowEnd(buffer, 0), {
    onNone: () => (final ? Option.some([0, buffer.length] as const) : Option.none()),
    onSome: (end) => Option.some([0, end] as const),
  });
};

/** The whole input as one unit, at its end: CSL-JSON and CSL YAML are read whole. */
const findWhole: Finder = (buffer, final) =>
  final && String.isNonEmpty(buffer) ? Option.some([0, buffer.length] as const) : Option.none();

// ── Reading entries ───────────────────────────────────────────────────

/** How many cross-referenceable entries a BibTeX stream keeps for later children. */
const PARENT_WINDOW = 1000;

/** How many children a BibTeX stream holds back waiting for a parent that comes later. */
const MAX_PENDING = 1000;

/**
 * How much context (macros and parents re-read with each batch) a BibTeX
 * stream may parse, as a multiple of the input it has read (plus one input
 * cap). Past it a batch is read without context, as an inherited field is
 * once the whole-file parse's decoding budget is spent.
 */
const CONTEXT_FACTOR = 4;

/** The stream's state between chunks. */
interface State {
  buffered: Buffered;
  /** Records emitted so far, and whether the record cap has been reached. */
  emitted: number;
  done: boolean;
  /** CSV: the header row, once read. */
  header: Option.Option<string>;
  /** BibTeX: the `@string` definitions seen so far, by macro name, in definition order. */
  macros: Array<readonly [string, string]>;
  /** BibTeX: recent entries by key, oldest first, for children that cross-reference them. */
  parents: Array<readonly [string, string]>;
  /** BibTeX: the parents' total length. */
  parentLength: number;
  /** BibTeX: children waiting for a parent not yet seen. */
  pending: Unit[];
  /** BibTeX: the macro-expansion and decoding budgets, shared across the stream. */
  readonly budgets: BibtexBudgets;
  /** The input read so far, and the context parsed so far (both in characters). */
  seen: number;
  contextSpent: number;
}

/** The total length of some texts. */
const lengthOf = (texts: Iterable<string>): number =>
  Array.reduce(Array.fromIterable(texts), 0, (sum, text) => sum + text.length);

/**
 * Parses a document assembled from `context` (macros, parents, a CSV
 * header: read, but not reported) and `units`, and maps each outcome back
 * to its unit's position in the input. An outcome that does not start a
 * unit (one from the context) is dropped.
 */
function parseUnits(
  context: string,
  units: readonly Unit[],
  parse: (document: string) => ParseOutcome[],
): ParseOutcome[] {
  const starts: Array<readonly [number, Unit]> = [];
  Array.reduce(units, context.length, (offset, unit) => {
    starts.push([offset, unit]);
    return offset + unit.text.length + 1;
  });
  const document = `${context}${units.map((unit) => unit.text).join("\n")}`;
  return Array.filterMap(parse(document), (outcome): Result.Result<ParseOutcome, void> => {
    const offset = outcome.position?.offset;
    const unit = Array.findFirst(starts, ([start]) => start === offset);
    if (Option.isNone(unit)) return Result.failVoid;
    return Result.succeed({ ...outcome, position: unit.value[1].position });
  });
}

/**
 * The parse options for one assembled document: the caller's, with the
 * record and length caps set to the document's own length. The stream
 * applies the caller's caps itself (the record cap over the stream, the
 * input cap to the text it holds), and a document is never longer than the
 * caller's input cap, so this only stops the whole-document rejection; the
 * BibTeX expansion and decoding budgets are the stream's shared ones.
 */
const documentOptions = (options: ParseOptions, document: string): ParseOptions => ({
  ...options,
  maxRecords: Math.max(1, document.length),
  maxInputLength: Math.max(1, document.length),
});

/** An entry's key (the text between its delimiter and the first comma), lower-cased. */
const entryKey = (text: string): Option.Option<string> =>
  Option.map(
    Option.fromNullishOr(/^@\s*[A-Za-z]+\s*[{(]\s*([^,\s{}()]+)\s*,/.exec(text)),
    (match) => match[1].toLowerCase(),
  );

/** The keys an entry cross-references (`crossref`, `xdata`), lower-cased. */
const references = (text: string): string[] =>
  Array.flatMap(
    Array.fromIterable(text.matchAll(/\b(?:crossref|xdata)\s*=\s*[{"]?\s*([^}"]+)/gi)),
    (match) =>
      match[1]
        .split(",")
        .map((key) => key.trim().toLowerCase())
        .filter(String.isNonEmpty),
  );

/** An `@string` definition's macro name, lower-cased; `None` for any other entry. */
const macroName = (text: string): Option.Option<string> =>
  Option.map(Option.fromNullishOr(/^@\s*string\s*[{(]\s*([^=\s{}()]+)\s*=/i.exec(text)), (match) =>
    match[1].toLowerCase(),
  );

/** True for an `@string` macro definition. */
const isMacro = (text: string): boolean => /^@\s*string\s*[{(]/i.test(text);

/** The names a text may use as macros (a bare word after `=` or `#`), lower-cased; an over-approximation. */
const macroUses = (text: string): string[] =>
  Array.map(Array.fromIterable(text.matchAll(/[=#]\s*([A-Za-z_][^\s,#{}"=()]*)/g)), (match) =>
    match[1].toLowerCase(),
  );

/** The parent texts `keys` reach through the window (transitively, a few levels deep). */
function parentTexts(state: State, keys: readonly string[], depth = 0): string[] {
  if (depth > 8 || Array.isReadonlyArrayEmpty(keys)) return [];
  const found = Array.filterMap(keys, (key): Result.Result<string, void> =>
    Result.fromOption(
      Option.map(
        Array.findLast(state.parents, ([parent]) => parent === key),
        ([, text]) => text,
      ),
      () => undefined,
    ),
  );
  return [...found, ...parentTexts(state, found.flatMap(references), depth + 1)];
}

/** The macro names `names` reach through the definitions (transitively, a few levels deep). */
function macroClosure(state: State, names: readonly string[], depth = 0): string[] {
  if (depth > 8 || Array.isReadonlyArrayEmpty(names)) return [];
  const wanted = HashSet.fromIterable(names);
  const defined = state.macros.filter(([name]) => HashSet.has(wanted, name));
  return [
    ...names,
    ...macroClosure(
      state,
      defined.flatMap(([, text]) => macroUses(text)),
      depth + 1,
    ),
  ];
}

/**
 * The context a unit needs: the macros it (or a parent it reads) uses, in
 * definition order, then the parents it cross-references.
 */
function contextFor(state: State, unit: Unit): string[] {
  const parents = Array.dedupe(parentTexts(state, references(unit.text)));
  const used = HashSet.fromIterable(
    macroClosure(state, [unit.text, ...parents].flatMap(macroUses)),
  );
  const macros = state.macros.filter(([name]) => HashSet.has(used, name)).map(([, text]) => text);
  return Array.dedupe([...macros, ...parents]);
}

/** Remembers an entry as a possible parent, dropping the oldest past the window (by count and by length). */
function remember(state: State, unit: Unit, cap: number): void {
  Option.map(entryKey(unit.text), (key) => {
    state.parents.push([key, unit.text]);
    state.parentLength += unit.text.length;
    // oxlint-disable-next-line effect/imperative-loops -- evicts from the front of the window until it is within both bounds; how many go depends on their lengths.
    while (state.parents.length > PARENT_WINDOW || state.parentLength > cap) {
      Option.map(Option.fromUndefinedOr(state.parents.shift()), ([, text]) => {
        state.parentLength -= text.length;
      });
    }
  });
}

/** True when every key an entry references has been seen. */
const resolved = (state: State, unit: Unit): boolean =>
  references(unit.text).every((key) => state.parents.some(([parent]) => parent === key));

/** One document to read: its units, the context they need, and its length so far. */
interface Group {
  readonly units: Unit[];
  readonly context: string[];
  readonly included: MutableHashSet.MutableHashSet<string>;
  size: number;
}

/** A document of one unit and its context. */
function single(unit: Unit, context: readonly string[]): Group {
  return {
    units: [unit],
    context: [...context],
    included: MutableHashSet.fromIterable(context),
    size: unit.text.length + 1 + lengthOf(context.map((text) => `${text}\n`)),
  };
}

/**
 * Packs units into documents no longer than the input cap, each carrying
 * the context its units need; a unit whose context would not fit is read
 * alone without it.
 */
function groups(state: State, units: readonly Unit[], cap: number): Group[] {
  const all: Group[] = [];
  Array.forEach(units, (unit) => {
    const context = contextFor(state, unit);
    const last = all[all.length - 1];
    const added = context.filter(
      (text) => last === undefined || !MutableHashSet.has(last.included, text),
    );
    const grown =
      last === undefined
        ? Number.POSITIVE_INFINITY
        : last.size + unit.text.length + 1 + lengthOf(added.map((text) => `${text}\n`));
    if (last !== undefined && grown <= cap) {
      last.units.push(unit);
      Array.forEach(added, (text) => {
        last.context.push(text);
        MutableHashSet.add(last.included, text);
      });
      last.size = grown;
      return;
    }
    const alone = single(unit, context);
    all.push(alone.size <= cap ? alone : single(unit, []));
  });
  return all;
}

/** Reads one document, with its context while the stream's context budget lasts. */
function readGroup(state: State, group: Group, options: ParseOptions, cap: number): ParseOutcome[] {
  const length = lengthOf(group.context);
  const affordable = state.contextSpent + length <= CONTEXT_FACTOR * (state.seen + cap);
  if (affordable) state.contextSpent += length;
  const context = affordable ? group.context.map((text) => `${text}\n`).join("") : "";
  return parseUnits(context, group.units, (document) =>
    parseBibtexDocument(document, documentOptions(options, document), state.budgets),
  );
}

/** Reads a batch of complete BibTeX entries, holding back children whose parent has not come yet. */
function readBibtex(
  state: State,
  units: readonly Unit[],
  options: ParseOptions,
  final: boolean,
): ParseOutcome[] {
  const cap = inputCap(options);
  Array.forEach(units, (unit) => {
    Option.match(macroName(unit.text), {
      onNone: () => {
        if (!isMacro(unit.text)) remember(state, unit, cap);
      },
      onSome: (name) => {
        state.macros = [...state.macros.filter(([defined]) => defined !== name), [name, unit.text]];
      },
    });
  });
  const candidates = [...state.pending, ...units.filter((unit) => !isMacro(unit.text))];
  const ready = candidates.filter((unit) => final || resolved(state, unit));
  const waiting = candidates.filter((unit) => !final && !resolved(state, unit));
  // Past the bound, the oldest waiting children are read without their parent.
  const overflow = Math.max(0, waiting.length - MAX_PENDING);
  state.pending = waiting.slice(overflow);
  const batch = Array.sortWith(
    [...ready, ...waiting.slice(0, overflow)],
    (unit) => unit.position.offset,
    Order.Number,
  );
  return groups(state, batch, cap).flatMap((group) => readGroup(state, group, options, cap));
}

/** Reads a batch of complete RIS records. */
const readRis = (units: readonly Unit[], options: ParseOptions): ParseOutcome[] =>
  parseUnits("", units, (document) => parseRis(document, documentOptions(options, document)));

/** Reads a batch of complete CSV rows, the first row of the input being the header. */
function readCsv(state: State, units: readonly Unit[], options: ParseOptions): ParseOutcome[] {
  if (Option.isNone(state.header)) {
    const [header, ...rows] = units;
    if (header === undefined) return [];
    const probe = parseCsv(header.text, documentOptions(options, header.text));
    if (Array.isArrayNonEmpty(probe)) {
      state.done = true;
      return probe;
    }
    state.header = Option.some(header.text.replace(/\r?\n?$/, "\n"));
    return readCsv(state, rows, options);
  }
  const rows = units.filter((unit) => String.isNonEmpty(unit.text.trim()));
  return parseUnits(
    state.header.value,
    rows.map((unit) => ({ ...unit, text: unit.text.replace(/\r?\n?$/, "") })),
    (document) => parseCsv(document, documentOptions(options, document)),
  );
}

/** One step of the stream: the outcomes of the entries a chunk completed, or the failure. */
type Step = Result.Result<ParseOutcome, InputTooLarge>;

/** Applies the record cap to a batch's outcomes, ending the stream with `truncated` once it is reached. */
function capRecords(state: State, outcomes: readonly ParseOutcome[], maxRecords: number): Step[] {
  const room = Math.max(0, maxRecords - state.emitted);
  const kept = outcomes.slice(0, room);
  state.emitted += kept.length;
  const truncated = outcomes.length > room;
  if (truncated) state.done = true;
  return [
    ...kept.map((outcome) => Result.succeed(outcome)),
    ...(truncated
      ? [Result.succeed<ParseOutcome>({ outcome: "skipped", reason: "truncated" })]
      : []),
  ];
}

/** Each format's entry finder: BibTeX, RIS and CSV entry by entry, the rest whole. */
const finder = (format: ImportFormat): Finder =>
  format === "bibtex"
    ? findBibtex
    : format === "ris"
      ? findRis
      : format === "csv"
        ? findCsv
        : findWhole;

/** Reads the complete units a step found, by format. */
function readUnits(
  state: State,
  format: ImportFormat,
  units: readonly Unit[],
  options: ParseOptions,
  final: boolean,
): ParseOutcome[] {
  const present = units.filter((unit) => String.isNonEmpty(unit.text));
  if (format === "bibtex") return readBibtex(state, present, options, final);
  if (format === "ris") return readRis(present, options);
  if (format === "csv") return readCsv(state, units, options);
  // CSL-JSON / CSL YAML: the one unit is the whole input, within the cap.
  return present.flatMap((unit) => parseBibliographicFile(unit.text, format, options));
}

/** Feeds one chunk (or the end of the input) through the splitter and the format's reader. */
function step(
  state: State,
  format: ImportFormat,
  options: ParseOptions,
  chunk: string,
  final: boolean,
): Step[] {
  if (state.done) return [];
  const cap = inputCap(options);
  const text = state.buffered.text + chunk;
  if (text.length > cap) {
    state.done = true;
    return [Result.fail(tooLarge(format, cap))];
  }
  // The shared budgets grow with the input read, as a whole-file parse's
  // scale with its input.
  state.seen += chunk.length;
  state.budgets.macros.remaining += chunk.length;
  state.budgets.decoded.remaining += DECODED_SOURCE_FACTOR * chunk.length;
  // Wait for more input until the buffer has grown by half since the last
  // attempt, so a long entry arriving in small chunks is scanned a bounded
  // number of times.
  if (!final && text.length < state.buffered.tried * 1.5) {
    state.buffered = { ...state.buffered, text };
    return [];
  }
  const [units, rest] = split({ ...state.buffered, text }, finder(format), final);
  state.buffered = rest;
  // Parents are bounded apart (by count and length); this is the rest of
  // what the stream holds.
  const held =
    rest.text.length +
    lengthOf(state.macros.map(([, definition]) => definition)) +
    lengthOf(state.pending.map((unit) => unit.text));
  if (held > cap) {
    state.done = true;
    return [Result.fail(tooLarge(format, cap))];
  }
  return capRecords(
    state,
    readUnits(state, format, units, options, final),
    limitOr(Option.fromUndefinedOr(options.maxRecords), MAX_RECORDS),
  );
}

/**
 * Parses a bibliographic file that arrives as a stream of text chunks,
 * emitting each entry's {@link ParseOutcome} once the entry is complete, so
 * a large file never has to be in memory at once. BibTeX, RIS and CSV
 * stream entry by entry; CSL-JSON and CSL YAML are read whole once the
 * stream ends. Outcomes and their positions are those
 * {@link parseBibliographicFile} gives, with these differences:
 *
 * - **BibTeX `@string` macros** are carried forward, so a macro applies to
 *   every entry after its definition, as in the whole-file parse.
 * - **`crossref` / `xdata`**: a child whose parent has already passed is read
 *   with it from a window of the last 1000 entries (fewer when they are
 *   long: the window holds at most `maxInputLength` characters); a child
 *   whose parent is still to come waits for it (at most 1000 children wait;
 *   past that the oldest are read without their parent), so it is emitted
 *   once the parent has come, out of document order. A parent that has left
 *   the window is not found.
 * - **Work is bounded across the stream**, not per chunk: macro expansion and
 *   inherited-field decoding spend one budget for the whole stream (growing
 *   with the input read, as the whole-file parse's scale with its input), and
 *   the macros and parents re-read with each batch spend a context budget of
 *   four times the input read; once it is spent, entries are read without
 *   them. Each document the stream parses is at most `maxInputLength` long.
 * - **The input cap** (`options.maxInputLength`) bounds the text the stream
 *   holds at once (a chunk with an incomplete entry, the macros, the waiting
 *   children; the parents apart), not the stream: over it the stream fails
 *   with {@link InputTooLarge}, at once, for every format.
 * - **The record cap** (`options.maxRecords`) ends the stream with one
 *   `truncated` outcome, without reading the rest.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { parseBibliographicStream } from "@thomasfosterau/biblio"
 *
 * // The file arrives in pieces that split entries anywhere.
 * const chunks = Stream.fromIterable([
 *   '@string{ups = "Oxford Univ',
 *   'ersity Press"}\n@book{a, title = {First}, publisher = ups, isbn = {9780199695836}}\n@bo',
 *   "ok{b, title = {Second}, isbn = {9780062316097}}",
 * ])
 *
 * const outcomes = Effect.runSync(Stream.runCollect(parseBibliographicStream(chunks, "bibtex")))
 * assert.deepStrictEqual(outcomes.map((outcome) => outcome.outcome), ["parsed", "parsed"])
 * assert.strictEqual(outcomes[0].outcome === "parsed" ? outcomes[0].record.publisher : undefined, "Oxford University Press")
 * assert.deepStrictEqual(outcomes[1].position, { offset: 108, line: 3, column: 1 })
 * ```
 *
 * @since 1.0.0
 */
export const parseBibliographicStream = <E, R>(
  chunks: Stream.Stream<string, E, R>,
  format: ImportFormat,
  options: ParseOptions = {},
): Stream.Stream<ParseOutcome, E | InputTooLarge, R> => {
  const initial = (): State => ({
    buffered: { text: "", position: { offset: 0, line: 1, column: 1 }, tried: 0 },
    emitted: 0,
    done: false,
    header: Option.none(),
    macros: [],
    parents: [],
    parentLength: 0,
    pending: [],
    budgets: {
      macros: { remaining: Math.max(MIN_MACRO_EXPANSION, inputCap(options)) },
      decoded: { remaining: DECODED_SOURCE_FACTOR * inputCap(options) },
    },
    seen: 0,
    contextSpent: 0,
  });
  return chunks.pipe(
    Stream.mapAccum(
      initial,
      (state, chunk: string) => [state, step(state, format, options, chunk, false)] as const,
      {
        onHalt: (state) => step(state, format, options, "", true),
      },
    ),
    Stream.mapEffect((result) => Effect.fromResult(result)),
  );
};
