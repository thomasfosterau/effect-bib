/**
 * The BibTeX scanner: splits a document into entries, reads each entry's
 * citation key and fields, and evaluates every field value against the
 * `@string` macros defined before it (`#` concatenation, the month macros).
 *
 * The grammar is written in `@thomasfosterau/effect-parse` combinators and
 * compiled with the `closure` backend. It never throws: a truncated or
 * unbalanced tail stops the scan, and a value it cannot read falls back to its
 * raw text. Values stay LaTeX source here; decoding is the field mapper's job.
 *
 * @copyright Thomas Foster
 * @module biblio/bibtex/scan
 * @since 0.1.0
 */

import { Compiler, Parser, Token } from "@thomasfosterau/effect-parse";
import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as HashSet from "effect/HashSet";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as String from "effect/String";
import { type Budget, spend } from "./budget.ts";

/**
 * One reference entry after macro expansion: its lower-cased `@type`, its
 * citation key, the offset of its `@` in the document, its fields
 * (lower-cased names → LaTeX source values), and which of them it inherited
 * through `crossref` / `xdata`.
 *
 * @since 0.1.0
 */
export interface BibtexEntry {
  readonly kind: string;
  readonly key: string;
  readonly offset: number;
  readonly fields: HashMap.HashMap<string, string>;
  readonly inherited: HashSet.HashSet<string>;
}

/**
 * The scanned entries of a document, and whether entries past the caller's
 * cap were left out.
 *
 * @since 1.0.0
 */
export interface BibtexScan {
  readonly entries: BibtexEntry[];
  readonly truncated: boolean;
}

/**
 * The longest value a macro expansion produces, in UTF-16 code units. Each
 * expansion is clamped as it is built, so `@string` definitions that double
 * one another cannot grow a value exponentially.
 */
const MAX_VALUE_LENGTH = 64_000;

/**
 * The fewest characters macro expansion may add across one document; the
 * budget is the larger of this and the input cap. Past it a macro expands to
 * nothing, so many fields that each name one large macro cannot multiply
 * the work.
 *
 * @since 1.0.0
 */
export const MIN_MACRO_EXPANSION = 8_000_000;

/** The macro table and the expansion budget a document's values are evaluated against. */
interface Macros {
  readonly table: MutableHashMap.MutableHashMap<string, string>;
  readonly budget: Budget;
}

/**
 * The deepest `{…}` nesting the grammar accepts. The grammar is unrolled to
 * this depth rather than recursive: effect-parse's interpreter recurses once
 * per nesting level, and an unbounded `Parser.suspend` grammar overflows the
 * stack (`RangeError`) at a few thousand levels, so a hostile 5 KB `{{{…`
 * would throw (effect-parse#14). Deeper nesting is treated like an
 * unbalanced tail.
 */
const MAX_BRACE_DEPTH = 32;

/**
 * Consumes a parser's repetitions, discarding the output so compiled code
 * collects no array of matches.
 */
const skipMany = <A>(self: Parser.Parser<A>): Parser.Parser<void> =>
  Parser.asVoid(Parser.repeat(self));

/** A run of characters that are not braces. */
const unbracedRun = Token.takeTill("{}", { min: 1 });

/** A balanced `{…}` group, nested at most `depth` levels. */
function bracedTo(depth: number): Parser.Parser<void> {
  const inner = depth <= 1 ? unbracedRun : Parser.alt(unbracedRun, bracedTo(depth - 1));
  return Parser.asVoid(Parser.delimited(Token.literal("{"), skipMany(inner), Token.literal("}")));
}

/**
 * A balanced `{…}` group, nested at most 32 levels.
 *
 * @since 0.1.0
 */
export const braced: Parser.Parser<void> = bracedTo(MAX_BRACE_DEPTH);

/**
 * A `(…)` entry body, as BibTeX and biber accept in place of `{…}`: it ends
 * at the first `)` outside any brace group, the rule the stream's entry
 * splitter applies too.
 */
const parenthesised: Parser.Parser<void> = Parser.asVoid(
  Parser.delimited(
    Token.literal("("),
    skipMany(Parser.alt(Token.takeTill("{})", { min: 1 }), braced)),
    Token.literal(")"),
  ),
);

/** An entry's type, up to its opening `{` or `(`. */
const entryKind = Parser.map(Token.takeTill("{("), (kind) => kind.trim().toLowerCase());

/** An entry's opening delimiter. */
const opening = Parser.alt(Token.literal("{"), Token.literal("("));

/** `@comment` and `@preamble` heads, whose bodies are scanned as text. */
const isTextBlockKind = (kind: string): boolean =>
  kind === "comment" || kind === "preamble" || kind === "";

/** An entry head: skips to the next `@` and reads its type up to the `{` or `(`. */
const entryHead = Parser.preceded(Parser.seq(Token.takeUntil("@"), Token.literal("@")), entryKind);

/** One scanned block: its `@type`, its `{ ... }` body, and the offset of its `@`. */
interface RawBlock {
  readonly kind: string;
  readonly body: string;
  readonly offset: number;
}

/** A text block's head steps past its `{` only: its body is scanned as text. */
const textBlockStep = Parser.as(
  Parser.zipLeft(Parser.filter(entryHead, isTextBlockKind), opening),
  Option.none<RawBlock>(),
);

/** An entry or `@string` block: its head, its balanced `{ ... }` or `( ... )` body, and where its `@` is. */
const blockStep = Parser.map(
  Parser.preceded(
    Token.takeUntil("@"),
    Parser.withSpan(
      Parser.seq(
        Parser.preceded(Token.literal("@"), entryKind),
        Parser.taken(Parser.alt(braced, parenthesised)),
      ),
    ),
  ),
  ([[kind, body], span]): Option.Option<RawBlock> =>
    Option.some({ kind, body: body.slice(1, -1), offset: span.start }),
);

/** The running scan: the blocks so far and how many of them are reference entries. */
interface BlockScan {
  readonly blocks: RawBlock[];
  entries: number;
}

/**
 * The whole block scan: stops at the first unbalanced block, the end, or
 * once `keep` reference entries are in, keeping every `@string` before that
 * point (the fold's `while` stops on the cap, so nothing past it is
 * scanned). Compiled per scan, for the caller's cap (compiling costs
 * microseconds). The `closure` backend never calls `new Function`, so a
 * page's Content Security Policy never sees it.
 */
const bibtexBlocks = (keep: number) =>
  Compiler.closure(
    Parser.fold(Parser.alt(textBlockStep, blockStep), {
      init: (): BlockScan => ({ blocks: [], entries: 0 }),
      f: (scan, step) => {
        if (Option.isNone(step)) return scan;
        scan.blocks.push(step.value);
        if (step.value.kind !== "string") scan.entries += 1;
        return scan;
      },
      while: (scan) => scan.entries < keep,
    }),
  );

/**
 * A `}` with no open `{` in this value (the field key swallowed its `{`):
 * kept as text rather than ending the value, so the field still parses.
 */
const strayClose = Token.literal("}");

/** A `"…"` value; braces inside it still balance. */
const quoted = Parser.delimited(
  Token.literal('"'),
  skipMany(Parser.alt(Token.takeTill('{}"', { min: 1 }), braced, Parser.asVoid(strayClose))),
  Token.literal('"'),
);

/** An unterminated `"`: the value runs to the end of the body. */
const unterminatedQuote = Parser.preceded(Token.literal('"'), Token.rest);

/** A field value, up to the next top-level, unquoted `,` or the end. */
const fieldValue = Parser.taken(
  skipMany(
    Parser.alt(
      Token.takeTill('{}",', { min: 1 }),
      braced,
      Parser.asVoid(strayClose),
      Parser.asVoid(quoted),
      Parser.asVoid(unterminatedQuote),
    ),
  ),
);

/** One `key = value` field and its terminating `,` (or the end). */
const bibtexField = Parser.map(
  Parser.seq(
    Token.takeUntil("="),
    Token.literal("="),
    fieldValue,
    Parser.alt(Token.literal(","), Parser.eof),
  ),
  ([key, , value]) => [key.trim().toLowerCase(), value] as const,
);

/**
 * The most distinct fields one entry keeps (BibLaTeX's whole data model has
 * about 200); later new names are ignored, so one hostile entry cannot make
 * every later stage pay per field.
 */
const MAX_FIELDS_PER_ENTRY = 256;

/** The fields of a body, last-wins on a repeated name, up to {@link MAX_FIELDS_PER_ENTRY} names. */
const fieldMap = Parser.fold(bibtexField, {
  init: () => MutableHashMap.empty<string, string>(),
  f: (fields, [key, value]) => {
    const fits =
      MutableHashMap.size(fields) < MAX_FIELDS_PER_ENTRY || MutableHashMap.has(fields, key);
    if (String.isNonEmpty(key) && fits) MutableHashMap.set(fields, key, value);
    return fields;
  },
});

/** An entry body: the citation key, then the fields. */
const entryBody = Compiler.closure(
  Parser.seq(Parser.zipLeft(Token.takeUntil(","), Token.literal(",")), fieldMap),
);

/** A `@string` body: the definitions alone. */
const stringBody = Compiler.closure(fieldMap);

/** Whitespace between the parts of a value. */
const blank = Token.takeWhile(" \t\r\n");

/** One part of a value: a literal text or a macro name (or bare number). */
type ValuePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "name"; readonly name: string };

/** One `{…}`, `"…"` or bare part of a value, with surrounding whitespace. */
const valuePart = Parser.delimited(
  blank,
  Parser.alt(
    Parser.map(Parser.taken(braced), (text): ValuePart => ({
      kind: "text",
      text: text.slice(1, -1),
    })),
    Parser.map(Parser.taken(quoted), (text): ValuePart => ({
      kind: "text",
      text: text.slice(1, -1),
    })),
    Parser.map(Token.takeTill(' \t\r\n#{}",', { min: 1 }), (name): ValuePart => ({
      kind: "name",
      name,
    })),
  ),
  blank,
);

/** A whole value: parts joined by `#`, consuming all of it. */
const valueGrammar = Compiler.closure(
  Parser.allConsuming(
    Parser.seq(valuePart, Parser.repeat(Parser.preceded(Token.literal("#"), valuePart))),
  ),
);

/** The predefined month macros (`jan` … `dec`), as BibTeX's standard styles define them. */
const MONTH_MACROS: ReadonlyArray<readonly [string, string]> = [
  ["jan", "January"],
  ["feb", "February"],
  ["mar", "March"],
  ["apr", "April"],
  ["may", "May"],
  ["jun", "June"],
  ["jul", "July"],
  ["aug", "August"],
  ["sep", "September"],
  ["oct", "October"],
  ["nov", "November"],
  ["dec", "December"],
];

/** Strips one layer of wrapping `{…}` or `"…"` from a value the grammar could not read. */
function unwrapRawValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed.slice(1, -1);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Resolves one value part: text as is, a number as is, a defined macro to
 * its expansion (or nothing once the expansion budget is spent), and an
 * undefined name to itself (BibTeX would substitute an empty string with a
 * warning; keeping the name loses nothing).
 */
function resolvePart(part: ValuePart, macros: Macros): string {
  if (part.kind === "text") return part.text;
  return Option.match(MutableHashMap.get(macros.table, part.name.toLowerCase()), {
    onNone: () => part.name,
    onSome: (expansion) => (spend(macros.budget, expansion.length) ? expansion : ""),
  });
}

/**
 * Evaluates a raw field value: its `#`-joined parts, each a `{…}` / `"…"`
 * literal or a macro, concatenated and clamped to {@link MAX_VALUE_LENGTH}.
 * A value the grammar cannot read (an unterminated quote, a stray brace)
 * falls back to its text with one wrapping layer removed.
 */
function evaluateValue(raw: string, macros: Macros): string {
  // Without a `#` the value is one part, and the grammar would agree with this.
  if (!raw.includes("#")) return evaluateSinglePart(raw, macros).slice(0, MAX_VALUE_LENGTH);
  const parsed = Parser.parse(valueGrammar, raw);
  if (Result.isFailure(parsed)) return unwrapRawValue(raw).slice(0, MAX_VALUE_LENGTH);
  const [first, rest] = parsed.success;
  return Array.reduce([first, ...rest], "", (value, part) =>
    value.length >= MAX_VALUE_LENGTH
      ? value
      : (value + resolvePart(part, macros)).slice(0, MAX_VALUE_LENGTH),
  );
}

/** A value with no `#`: a bare name resolves as a macro; anything else is its unwrapped text. */
function evaluateSinglePart(raw: string, macros: Macros): string {
  const trimmed = raw.trim();
  return /^[^\s#{}",]+$/.test(trimmed)
    ? resolvePart({ kind: "name", name: trimmed }, macros)
    : unwrapRawValue(trimmed);
}

/** Splits a document into its `@string` blocks and its first `keep` entry blocks, in order. */
function scanBlocks(content: string, keep: number): readonly RawBlock[] {
  // A `fold` with no minimum always succeeds, so this never fails.
  const scanned = Parser.parsePeek(bibtexBlocks(keep), content);
  return Result.isSuccess(scanned) ? scanned.success[1].blocks : [];
}

/** Adds a `@string` block's definitions to the macro table, each evaluated against those before it. */
function defineMacros(body: string, macros: Macros): void {
  const scanned = Parser.parsePeek(stringBody, body);
  if (Result.isFailure(scanned)) return;
  MutableHashMap.forEach(scanned.success[1], (value, name) => {
    MutableHashMap.set(macros.table, name, evaluateValue(value, macros));
  });
}

/** Reads one entry block: its citation key and its macro-expanded fields. */
function readEntry(block: RawBlock, macros: Macros): BibtexEntry {
  // Fails only on a body with no `,` after the citation key: no fields.
  const scanned = Parser.parsePeek(entryBody, block.body);
  if (Result.isFailure(scanned)) {
    return {
      kind: block.kind,
      key: block.body.trim(),
      offset: block.offset,
      fields: HashMap.empty(),
      inherited: HashSet.empty(),
    };
  }
  const [key, raw] = scanned.success[1];
  const fields = HashMap.fromIterable(
    Array.map(
      Array.fromIterable(raw),
      ([name, value]) => [name, evaluateValue(value, macros)] as const,
    ),
  );
  return {
    kind: block.kind,
    key: key.trim(),
    offset: block.offset,
    fields,
    inherited: HashSet.empty(),
  };
}

/**
 * Scans a BibTeX document into its first `maxEntries` reference entries, in
 * order, with every field value macro-expanded against the `@string`
 * definitions above it. `@comment` and `@preamble` bodies are scanned as
 * text; `@string` blocks define macros and yield no entry. The macro
 * expansion budget is the larger of 8,000,000 characters and `maxInput`,
 * unless the caller passes a `budget` it shares across documents.
 *
 * @since 0.1.0
 */
export function scanBibtex(
  content: string,
  maxEntries: number,
  maxInput: number,
  budget: Budget = { remaining: Math.max(MIN_MACRO_EXPANSION, maxInput) },
): BibtexScan {
  const macros: Macros = {
    table: MutableHashMap.fromIterable(MONTH_MACROS),
    budget,
  };
  const entries: BibtexEntry[] = [];
  // One entry past the cap tells a truncated document.
  const truncated = Array.some(scanBlocks(content, maxEntries + 1), (block) => {
    if (block.kind === "string") defineMacros(block.body, macros);
    else if (entries.length < maxEntries) entries.push(readEntry(block, macros));
    else return true;
    return false;
  });
  return { entries, truncated };
}
