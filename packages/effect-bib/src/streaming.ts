/**
 * Effect and `Stream` front ends for the file parsers: the same reading as
 * {@link parseBibliographicFile}, with an over-cap input as a typed
 * {@link InputTooLarge} failure rather than a `too-large` outcome, and a
 * streaming reader that takes a large file as text chunks and emits each
 * entry's outcome as soon as the entry is complete, so the whole file never
 * has to be in memory.
 *
 * @copyright Thomas Foster
 * @module effect-bib/streaming
 * @since 0.1.0
 */

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Iterable from "effect/Iterable";
import * as MutableHashMap from "effect/MutableHashMap";
import * as MutableHashSet from "effect/MutableHashSet";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import type { BibtexBudgets } from "./bibtex/budget.ts";
import { DECODED_SOURCE_FACTOR } from "./bibtex/fields.ts";
import { MIN_MACRO_EXPANSION } from "./bibtex/scan.ts";
import { rowBreak } from "./csv-rows.ts";
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
 * @since 0.1.0
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
 * import { parseBibliographic } from "@thomasfosterau/effect-bib"
 *
 * const ris = "TY  - BOOK\nTI  - Sapiens\nSN  - 9780062316097\nER  - "
 * const outcomes = Effect.runSync(parseBibliographic(ris, "ris"))
 * assert.strictEqual(outcomes[0].outcome, "parsed")
 *
 * const exit = Effect.runSyncExit(parseBibliographic(ris, "ris", { maxInputLength: 10 }))
 * assert.ok(Exit.isFailure(exit))
 * ```
 *
 * @since 0.1.0
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
  const breaks = Arr.fromIterable(text.matchAll(/\r\n?|\n/g));
  return Option.match(Arr.last(breaks), {
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
  // Each step finds one entry in what the last one left, so the entries are
  // as many as the buffer holds and the search resumes where each ended.
  const steps = Arr.unfold({ text: buffered.text, position: buffered.position }, (state) =>
    Option.map(find(state.text, final), ([start, end]) => {
      const position = advance(state.position, state.text.slice(0, start));
      const text = state.text.slice(start, end);
      const next = { text: state.text.slice(end), position: advance(position, text) };
      return [{ unit: { text, position }, next }, next] as const;
    }),
  );
  const left = Option.match(Arr.last(steps), {
    onNone: () => ({ text: buffered.text, position: buffered.position }),
    onSome: (last) => last.next,
  });
  return [steps.map((entry) => entry.unit), { ...left, tried: left.text.length }];
}

/** The index of the brace or parenthesis that closes the entry opened at `open`, or `None`. */
function closing(text: string, open: number): Option.Option<number> {
  const paren = text[open] === "(";
  const delimiters = paren ? /[{})]/g : /[{}]/g;
  delimiters.lastIndex = open + 1;
  // One step per delimiter (never per character), read lazily so the first
  // close leaves the rest of the entry unread: at depth zero a `)` closes a
  // parenthesised entry and a `}` a braced one; any other `}` lowers the depth.
  const steps = Iterable.unfold(0, (depth: number) =>
    Option.map(Option.fromNullishOr(delimiters.exec(text)), (match) => {
      const close = depth === 0 && match[0] === (paren ? ")" : "}");
      const next = match[0] === "{" ? depth + 1 : match[0] === "}" ? depth - 1 : depth;
      return [close ? Result.succeed(match.index) : Result.failVoid, next] as const;
    }),
  );
  return Iterable.head(Iterable.filterMap(steps, (close) => close));
}

/** No entry in the buffer: at the end, the rest is consumed (an empty span past it); before it, wait. */
const nothingLeft = (buffer: string, final: boolean): Option.Option<readonly [number, number]> =>
  final && Str.isNonEmpty(buffer) ? Option.some([buffer.length, buffer.length]) : Option.none();

/** An entry head: `@type` and its opening delimiter. */
const ENTRY_HEAD = /@\s*[A-Za-z]+\s*[{(]/g;

/** A BibTeX entry: from its `@` to its closing delimiter (the rest of the input at the end). */
const findBibtex: Finder = (buffer, final) => {
  ENTRY_HEAD.lastIndex = 0;
  const head = ENTRY_HEAD.exec(buffer);
  if (head === null) return nothingLeft(buffer, final);
  const open = head.index + head[0].length - 1;
  return Option.match(closing(buffer, open), {
    onNone: () => (final ? Option.some([head.index, buffer.length] as const) : Option.none()),
    onSome: (close) => Option.some([head.index, close + 1] as const),
  });
};

/** An RIS record: from its `TY` line to the end of its `ER` line, or to the next `TY`. */
const findRis: Finder = (buffer, final) => {
  const start = /^TY {2}-/m.exec(buffer);
  if (start === null) return nothingLeft(buffer, final);
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

/**
 * A paragraph of a tagged-line format (MEDLINE, Refer): from its first
 * non-blank line to the line break that ends its last, so units joined with
 * a line break stay paragraphs. Complete once a blank line follows it.
 */
const findParagraph: Finder = (buffer, final) => {
  const start = /\S/.exec(buffer);
  if (start === null) return nothingLeft(buffer, final);
  const lineStart = buffer.lastIndexOf("\n", start.index) + 1;
  // The line break before a blank line ends the paragraph.
  const blank = /\r?\n[^\S\r\n]*\r?\n/g;
  blank.lastIndex = start.index;
  const end = blank.exec(buffer);
  if (end === null) return final ? Option.some([lineStart, buffer.length] as const) : Option.none();
  return Option.some([lineStart, end.index + (end[0].startsWith("\r") ? 2 : 1)] as const);
};

/** The end of the CSV row starting at `from` (past its line break), quotes spanning lines; `None` when open. */
const rowEnd = (text: string, from: number): Option.Option<number> =>
  Option.map(rowBreak(text, from), ([, end]) => end);

/** A CSV row (the header included), with its line break. */
const findCsv: Finder = (buffer, final) => {
  if (Str.isEmpty(buffer)) return Option.none();
  return Option.match(rowEnd(buffer, 0), {
    onNone: () => (final ? Option.some([0, buffer.length] as const) : Option.none()),
    onSome: (end) => Option.some([0, end] as const),
  });
};

/** The whole input as one unit, at its end: CSL-JSON and CSL YAML are read whole. */
const findWhole: Finder = (buffer, final) =>
  final && Str.isNonEmpty(buffer) ? Option.some([0, buffer.length] as const) : Option.none();

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

/** A BibTeX `@string` definition the stream carries forward. */
interface Macro {
  readonly text: string;
  /** Its place in definition order (a redefinition takes a new one). */
  readonly order: number;
  /** The macro names its value may use, deduplicated. */
  readonly uses: readonly string[];
}

/** A BibTeX entry kept for children that cross-reference it. */
interface Parent {
  readonly key: string;
  readonly text: string;
  /** Its place in the window, so an eviction can tell whether it is the one indexed for its key. */
  readonly seq: number;
}

/** The stream's state between chunks. */
interface State {
  buffered: Buffered;
  /** Records emitted so far, and whether the record cap has been reached. */
  emitted: number;
  done: boolean;
  /** CSV: the header row, once read. */
  header: Option.Option<string>;
  /** BibTeX: the `@string` definitions seen so far, by macro name. */
  readonly macros: MutableHashMap.MutableHashMap<string, Macro>;
  /** BibTeX: the definitions' total length, and how many have been read. */
  macroLength: number;
  macroCount: number;
  /** BibTeX: recent entries, oldest first, for children that cross-reference them. */
  parents: Parent[];
  /**
   * BibTeX: the entry each key resolves to, the first in the window under
   * that key, as the whole-file parse takes the first entry with a key.
   */
  readonly parentIndex: MutableHashMap.MutableHashMap<string, Parent>;
  parentCount: number;
  /** BibTeX: the parents' total length. */
  parentLength: number;
  /** BibTeX: children waiting for a parent not yet seen. */
  pending: Unit[];
  /** BibTeX: the macro-expansion and decoding budgets, shared across the stream. */
  readonly budgets: BibtexBudgets;
  /** The input read so far, and the context parsed so far (both in characters). */
  seen: number;
  contextSpent: number;
  /** BibTeX: the context found for units so far (charged whether or not it is read). */
  discovered: number;
}

/** The total length of some texts. */
const lengthOf = (texts: Iterable<string>): number =>
  Arr.reduce(Arr.fromIterable(texts), 0, (sum, text) => sum + text.length);

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
  // Each unit's start in the document, looked up by offset: one entry per
  // unit, so finding an outcome's unit costs the same however many there are.
  const starts = MutableHashMap.empty<number, Unit>();
  Arr.reduce(units, context.length, (offset, unit) => {
    MutableHashMap.set(starts, offset, unit);
    return offset + unit.text.length + 1;
  });
  const document = `${context}${units.map((unit) => unit.text).join("\n")}`;
  return Arr.filterMap(parse(document), (outcome): Result.Result<ParseOutcome, void> =>
    Option.match(
      Option.flatMap(Option.fromUndefinedOr(outcome.position?.offset), (offset) =>
        MutableHashMap.get(starts, offset),
      ),
      {
        onNone: () => Result.failVoid,
        onSome: (unit) => Result.succeed({ ...outcome, position: unit.position }),
      },
    ),
  );
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
  Arr.flatMap(
    Arr.fromIterable(text.matchAll(/\b(?:crossref|xdata)\s*=\s*[{"]?\s*([^}"]+)/gi)),
    (match) =>
      match[1]
        .split(",")
        .map((key) => key.trim().toLowerCase())
        .filter(Str.isNonEmpty),
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
  Arr.map(Arr.fromIterable(text.matchAll(/[=#]\s*([A-Za-z_][^\s,#{}"=()]*)/g)), (match) =>
    match[1].toLowerCase(),
  );

/** How much context a BibTeX stream may parse, and separately find, by now. */
const contextBudget = (state: State, cap: number): number => CONTEXT_FACTOR * (state.seen + cap);

/**
 * The parent texts `keys` reach through the window (transitively, a few
 * levels deep), each key looked up once.
 */
function parentTexts(
  state: State,
  keys: readonly string[],
  visited: MutableHashSet.MutableHashSet<string>,
  depth = 0,
): string[] {
  if (depth > 8) return [];
  const found = Arr.filterMap(keys, (key): Result.Result<string, void> => {
    if (MutableHashSet.has(visited, key)) return Result.failVoid;
    MutableHashSet.add(visited, key);
    return Result.fromOption(
      Option.map(MutableHashMap.get(state.parentIndex, key), (parent) => parent.text),
      () => undefined,
    );
  });
  return Arr.isReadonlyArrayEmpty(found)
    ? found
    : [...found, ...parentTexts(state, found.flatMap(references), visited, depth + 1)];
}

/**
 * The definitions `names` reach (transitively, a few levels deep), in
 * definition order: each name looked up once, by name, so the work is the
 * macros reached, not every macro defined.
 */
function macrosUsed(state: State, names: readonly string[]): Macro[] {
  const visited = MutableHashSet.empty<string>();
  const found: Macro[] = [];
  const visit = (level: readonly string[], depth: number): void => {
    const next = Arr.flatMap(level, (name) => {
      if (MutableHashSet.has(visited, name)) return [];
      MutableHashSet.add(visited, name);
      return Option.match(MutableHashMap.get(state.macros, name), {
        onNone: () => [],
        onSome: (macro) => {
          found.push(macro);
          return macro.uses;
        },
      });
    });
    if (depth < 8 && Arr.isReadonlyArrayNonEmpty(next)) visit(next, depth + 1);
  };
  visit(names, 0);
  return Arr.sortWith(found, (macro) => macro.order, Order.Number);
}

/**
 * The context a unit needs: the macros it (or a parent it reads) uses, in
 * definition order, then the parents it cross-references. It depends only on
 * the keys the unit references and the macro names it uses, so a batch
 * finds it once per distinct pair (`found`). Finding it costs about as much
 * as the context it finds, so that is charged to the stream's context
 * budget; once the budget is spent, units get no context and none is looked
 * for.
 */
function contextFor(
  state: State,
  unit: Unit,
  cap: number,
  found: MutableHashMap.MutableHashMap<string, string[]>,
): string[] {
  const keys = references(unit.text);
  const uses = macroUses(unit.text);
  const signature = `${keys.join(",")}|${uses.join(",")}`;
  return Option.getOrElse(MutableHashMap.get(found, signature), () => {
    if (state.discovered > contextBudget(state, cap)) return [];
    const parents = parentTexts(state, keys, MutableHashSet.empty());
    const macros = macrosUsed(state, [...uses, ...parents.flatMap(macroUses)]);
    const context = [...macros.map((macro) => macro.text), ...parents];
    state.discovered += lengthOf(context);
    MutableHashMap.set(found, signature, context);
    return context;
  });
}

/** Records an `@string` definition, replacing an earlier one of the same name. */
function define(state: State, name: string, text: string): void {
  Option.map(MutableHashMap.get(state.macros, name), (old) => {
    state.macroLength -= old.text.length;
  });
  MutableHashMap.set(state.macros, name, {
    text,
    order: state.macroCount,
    uses: Arr.fromIterable(HashSet.fromIterable(macroUses(text))),
  });
  state.macroCount += 1;
  state.macroLength += text.length;
}

/** Remembers an entry as a possible parent, dropping the oldest past the window (by count and by length). */
function remember(state: State, unit: Unit, cap: number): void {
  Option.map(entryKey(unit.text), (key) => {
    const parent: Parent = { key, text: unit.text, seq: state.parentCount };
    state.parentCount += 1;
    state.parents.push(parent);
    if (!MutableHashMap.has(state.parentIndex, key))
      MutableHashMap.set(state.parentIndex, key, parent);
    state.parentLength += unit.text.length;
    // The oldest parents leave until the window is within both bounds: the
    // count bound is plain arithmetic, the length bound depends on how long
    // the oldest are, so they are counted only while the window is too long.
    const overCount = Math.max(0, state.parents.length - PARENT_WINDOW);
    const overLength =
      state.parentLength > cap
        ? Arr.unfold({ count: 0, length: state.parentLength }, ({ count, length }) =>
            Option.filter(Option.fromUndefinedOr(state.parents[count]), () => length > cap).pipe(
              Option.map(
                (oldest) =>
                  [count + 1, { count: count + 1, length: length - oldest.text.length }] as const,
              ),
            ),
          ).length
        : 0;
    const evicted = state.parents.splice(0, Math.max(overCount, overLength));
    state.parentLength -= Arr.reduce(evicted, 0, (sum, old) => sum + old.text.length);
    Arr.forEach(evicted, (gone) => {
      if (
        Option.exists(
          MutableHashMap.get(state.parentIndex, gone.key),
          (indexed) => indexed.seq === gone.seq,
        )
      )
        // The key falls back to its next entry still in the window (a scan of at most the window).
        Option.match(
          Arr.findFirst(state.parents, (entry) => entry.key === gone.key),
          {
            onNone: () => MutableHashMap.remove(state.parentIndex, gone.key),
            onSome: (next) => MutableHashMap.set(state.parentIndex, gone.key, next),
          },
        );
    });
  });
}

/** True when every key an entry references has been seen. */
const resolved = (state: State, unit: Unit): boolean =>
  references(unit.text).every((key) => MutableHashMap.has(state.parentIndex, key));

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
  const found = MutableHashMap.empty<string, string[]>();
  Arr.forEach(units, (unit) => {
    const context = contextFor(state, unit, cap, found);
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
      Arr.forEach(added, (text) => {
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
  const affordable = state.contextSpent + length <= contextBudget(state, cap);
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
  Arr.forEach(units, (unit) => {
    Option.match(macroName(unit.text), {
      onNone: () => {
        if (!isMacro(unit.text)) remember(state, unit, cap);
      },
      onSome: (name) => define(state, name, unit.text),
    });
  });
  const candidates = [...state.pending, ...units.filter((unit) => !isMacro(unit.text))];
  const ready = candidates.filter((unit) => final || resolved(state, unit));
  const waiting = candidates.filter((unit) => !final && !resolved(state, unit));
  // Past the bound, the oldest waiting children are read without their parent.
  const overflow = Math.max(0, waiting.length - MAX_PENDING);
  state.pending = waiting.slice(overflow);
  const batch = Arr.sortWith(
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
    if (Arr.isArrayNonEmpty(probe)) {
      state.done = true;
      return probe;
    }
    state.header = Option.some(header.text.replace(/\r?\n?$/, "\n"));
    return readCsv(state, rows, options);
  }
  const rows = units.filter((unit) => Str.isNonEmpty(unit.text.trim()));
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

/** Each format's entry finder: BibTeX, RIS, CSV, MEDLINE and Refer entry by entry, the rest whole. */
const finder = (format: ImportFormat): Finder =>
  format === "bibtex"
    ? findBibtex
    : format === "ris"
      ? findRis
      : format === "csv"
        ? findCsv
        : format === "medline" || format === "refer"
          ? findParagraph
          : findWhole;

/** Reads the complete units a step found, by format. */
function readUnits(
  state: State,
  format: ImportFormat,
  units: readonly Unit[],
  options: ParseOptions,
  final: boolean,
): ParseOutcome[] {
  const present = units.filter((unit) => Str.isNonEmpty(unit.text));
  if (format === "bibtex") return readBibtex(state, present, options, final);
  if (format === "ris") return readRis(present, options);
  if (format === "medline" || format === "refer")
    return parseUnits("", present, (document) =>
      parseBibliographicFile(document, format, documentOptions(options, document)),
    );
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
    rest.text.length + state.macroLength + lengthOf(state.pending.map((unit) => unit.text));
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
 *   the window is not found. Of several entries with the child's key, the
 *   first still in the window is the parent, as the whole-file parse takes
 *   the first.
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
 * import { parseBibliographicStream } from "@thomasfosterau/effect-bib"
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
 * @since 0.1.0
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
    macros: MutableHashMap.empty(),
    macroLength: 0,
    macroCount: 0,
    parents: [],
    parentIndex: MutableHashMap.empty(),
    parentCount: 0,
    parentLength: 0,
    pending: [],
    budgets: {
      macros: { remaining: Math.max(MIN_MACRO_EXPANSION, inputCap(options)) },
      decoded: { remaining: DECODED_SOURCE_FACTOR * inputCap(options) },
    },
    seen: 0,
    contextSpent: 0,
    discovered: 0,
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
