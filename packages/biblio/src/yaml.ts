/**
 * The YAML the CSL YAML format uses (Pandoc's `references:` bibliography and
 * Markdown front matter), read and written. The reader takes the subset a
 * bibliography is written in, not all of YAML: block mappings and
 * sequences (a sequence entry may open a mapping, `- id: …`), flow
 * collections on one line (`[[2015, 3]]`, `{family: Doe}`), plain,
 * single- and double-quoted scalars (a plain or quoted scalar may continue
 * on more-indented lines), literal and folded block scalars (`|`, `>`), and
 * comments. Anchors, aliases, tags, explicit keys and multi-document streams
 * past the first document are not read: such input is rejected rather than
 * misread. Internal; the public surface is `parseCslYaml` / `toCslYaml`.
 *
 * @copyright Thomas Foster
 * @module biblio/yaml
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as String from "effect/String";

/**
 * A YAML value as JSON: a scalar, a sequence or a mapping; YAML's null is
 * `null`.
 *
 * @since 1.0.0
 */
export type Yaml = Schema.Json;

/** The deepest nesting read; deeper input is rejected. */
const MAX_DEPTH = 64;

// ── Reading ───────────────────────────────────────────────────────────

/** One content line: its indentation and its text, the comment removed. */
interface Line {
  readonly indent: number;
  readonly text: string;
  /** The raw line, for block scalars (which keep `#` and blank lines). */
  readonly raw: string;
}

/** The reader's state: the lines, the next one, and whether the input was rejected. */
interface Reader {
  readonly lines: Line[];
  pos: number;
  failed: boolean;
}

/** The index where a `#` comment starts on a line (outside quotes, after a blank), or its length. */
function commentStart(text: string): number {
  const chars = Array.fromIterable(text);
  const state = Array.reduce(chars, { quote: "", at: -1, offset: 0 }, (acc, char, index) => {
    const next = { ...acc, offset: acc.offset + char.length };
    if (acc.at >= 0) return next;
    if (String.isNonEmpty(acc.quote)) {
      return char === acc.quote ? { ...next, quote: "" } : next;
    }
    if ((char === '"' || char === "'") && (index === 0 || /[\s[{,:]/.test(chars[index - 1]))) {
      return { ...next, quote: char };
    }
    if (char === "#" && (index === 0 || /\s/.test(chars[index - 1]))) {
      return { ...next, at: acc.offset };
    }
    return next;
  });
  return state.at >= 0 ? state.at : text.length;
}

/** Splits a YAML document into lines, recording each one's indentation. */
function toLines(source: string): Line[] {
  return source.split(/\r\n?|\n/).map((raw) => {
    const indent = raw.length - raw.replace(/^ */, "").length;
    const body = raw.slice(indent);
    return { indent, text: body.slice(0, commentStart(body)).trimEnd(), raw };
  });
}

/** The next line with content, skipping blanks and comments; `None` at the end. */
function peek(reader: Reader): Option.Option<Line> {
  const next = Array.findFirstIndex(reader.lines.slice(reader.pos), (line) =>
    String.isNonEmpty(line.text),
  );
  if (Option.isNone(next)) {
    reader.pos = reader.lines.length;
    return Option.none();
  }
  reader.pos += next.value;
  return Option.some(reader.lines[reader.pos]);
}

/** A `key:` at the start of a line: the key and the text after the colon. */
const KEY_LINE =
  /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#\-?:[\]{},&*!|>%@`][^:#]*?|-[^\s:][^:#]*?)\s*:(?:\s+(.*))?$/;

/** A line's key and rest when it is a `key: value` line. */
function keyLine(text: string): Option.Option<readonly [string, string]> {
  const match = KEY_LINE.exec(text);
  if (match === null) return Option.none();
  const key = match[1];
  return Option.map(
    key.startsWith('"') || key.startsWith("'") ? quoted(key) : Option.some(key.trim()),
    (name) => [name, match[2] ?? ""] as const,
  );
}

/** True for a sequence entry line (`-` or `- …`). */
const isEntry = (text: string): boolean => text === "-" || text.startsWith("- ");

/** Reads a double- or single-quoted scalar that spans the whole of `text`. */
function quoted(text: string): Option.Option<string> {
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    const body = text.slice(1, -1);
    return body.replace(/''/g, "").includes("'")
      ? Option.none()
      : Option.some(body.replace(/''/g, "'"));
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return unescapeDouble(text.slice(1, -1));
  }
  return Option.none();
}

/** The escapes a double-quoted scalar admits. */
const ESCAPES = HashMap.fromIterable<string, string>([
  ["0", "\0"],
  ["a", "\x07"],
  ["b", "\b"],
  ["t", "\t"],
  ["\t", "\t"],
  ["n", "\n"],
  ["v", "\v"],
  ["f", "\f"],
  ["r", "\r"],
  ["e", "\x1b"],
  [" ", " "],
  ['"', '"'],
  ["/", "/"],
  ["\\", "\\"],
  ["N", "\u0085"],
  ["_", "\u00a0"],
  ["L", "\u2028"],
  ["P", "\u2029"],
]);

/** Unescapes a double-quoted scalar's body; `None` when it holds an unescaped `"` or a bad escape. */
function unescapeDouble(body: string): Option.Option<string> {
  if (/(?:^|[^\\])(?:\\\\)*"/.test(body)) return Option.none();
  const bad = { found: false };
  const text = body.replace(
    /\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g,
    (_, escape: string) => {
      if (escape.length > 1) {
        const code = Number.parseInt(escape.slice(1), 16);
        if (code > 0x10ffff) {
          bad.found = true;
          return "";
        }
        return globalThis.String.fromCodePoint(code);
      }
      const known = HashMap.get(ESCAPES, escape);
      if (Option.isNone(known)) bad.found = true;
      return Option.getOrElse(known, () => "");
    },
  );
  return bad.found ? Option.none() : Option.some(text);
}

/** A plain scalar's value: `null` / `~` as null, `true` / `false`, a number in a sequence, else the text. */
function plain(text: string, inSequence: boolean): Yaml {
  if (text === "~" || /^null$/i.test(text)) return null;
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  if (inSequence && /^[-+]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/** True when a scalar's text uses a YAML feature the reader does not take. */
const unsupported = (text: string): boolean => /^[&*!%@`]/.test(text) || text.startsWith("? ");

/** Reads a scalar (or one-line flow collection) that spans `text`. */
function scalar(reader: Reader, text: string, inSequence: boolean): Yaml {
  if (text.startsWith("[") || text.startsWith("{")) {
    const flow = readFlow(text, 0, 0);
    if (Option.isNone(flow) || String.isNonEmpty(text.slice(flow.value[1]).trim())) {
      reader.failed = true;
      return null;
    }
    return flow.value[0];
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    return Option.getOrElse(quoted(text), () => {
      reader.failed = true;
      return "";
    });
  }
  if (unsupported(text)) {
    reader.failed = true;
    return null;
  }
  return plain(text, inSequence);
}

/** A flow scalar's end: the next `,`, `]` or `}` outside quotes. */
function flowScalar(
  text: string,
  at: number,
  isKey = false,
): Option.Option<readonly [string, number]> {
  const head = text[at];
  if (head === '"' || head === "'") {
    const pattern = head === '"' ? /"(?:[^"\\]|\\.)*"/y : /'(?:[^']|'')*'/y;
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (match === null) return Option.none();
    return Option.map(quoted(match[0]), (value) => [value, at + match[0].length] as const);
  }
  const match = isKey ? /[^,[\]{}:]*/y : /[^,[\]{}]*/y;
  match.lastIndex = at;
  const found = match.exec(text);
  const raw = found === null ? "" : found[0];
  return Option.some([raw.trim(), at + raw.length] as const);
}

/** Skips blanks from `at`. */
const skipBlank = (text: string, at: number): number =>
  at + (/^\s*/.exec(text.slice(at))?.[0].length ?? 0);

/** Reads a flow collection or scalar at `at`: the value and the index after it. */
function readFlow(text: string, at: number, depth: number): Option.Option<readonly [Yaml, number]> {
  if (depth > MAX_DEPTH) return Option.none();
  const start = skipBlank(text, at);
  const open = text[start];
  if (open === "[" || open === "{") return readFlowCollection(text, start, depth);
  if (open === '"' || open === "'") return flowScalar(text, start);
  return Option.flatMap(flowScalar(text, start), ([raw, end]) =>
    unsupported(raw) ? Option.none() : Option.some([plain(raw, true), end] as const),
  );
}

/** One flow mapping entry (`key: value`) at `at`: the entry and the index after it. */
function flowEntry(
  text: string,
  at: number,
  depth: number,
): Option.Option<readonly [readonly [string, Yaml], number]> {
  return Option.flatMap(flowScalar(text, at, true), ([key, end]) => {
    const colon = skipBlank(text, end);
    if (text[colon] !== ":") return Option.none();
    return Option.map(
      readFlow(text, colon + 1, depth),
      ([value, after]) => [[key, value] as const, after] as const,
    );
  });
}

/** The index after the separator following an item: past a `,`, at the `close`, else `None`. */
function afterItem(text: string, at: number, close: string): Option.Option<number> {
  const next = skipBlank(text, at);
  if (text[next] === ",") return Option.some(skipBlank(text, next + 1));
  return text[next] === close ? Option.some(next) : Option.none();
}

/** Reads a `[…]` or `{…}` collection starting at `at`. */
function readFlowCollection(
  text: string,
  at: number,
  depth: number,
): Option.Option<readonly [Yaml, number]> {
  const mapping = text[at] === "{";
  const close = mapping ? "}" : "]";
  const items: Yaml[] = [];
  const entries: Array<readonly [string, Yaml]> = [];
  const state = { pos: skipBlank(text, at + 1), ok: true };
  // oxlint-disable-next-line effect/imperative-loops -- a flow collection's items are read left to right from a moving offset; a fold over a pre-split list cannot split at the commas that matter (those outside nested brackets and quotes) without first parsing them, and recursion per item would overflow the stack on a long list.
  while (state.ok && text[state.pos] !== close) {
    const end = mapping
      ? Option.map(flowEntry(text, state.pos, depth + 1), ([entry, after]) => {
          entries.push(entry);
          return after;
        })
      : Option.map(readFlow(text, state.pos, depth + 1), ([value, after]) => {
          items.push(value);
          return after;
        });
    const next = Option.flatMap(end, (after) => afterItem(text, after, close));
    if (Option.isNone(next)) state.ok = false;
    else state.pos = next.value;
  }
  if (!state.ok) return Option.none();
  return Option.some([mapping ? Record.fromEntries(entries) : items, state.pos + 1] as const);
}

/** The lines of a block scalar (`|` or `>`) after a line at `parent` indentation, folded or kept. */
function blockScalar(reader: Reader, header: string, parent: number): string {
  const folded = header.startsWith(">");
  const keep = header.includes("+");
  const strip = header.includes("-");
  reader.pos += 1;
  const rest = reader.lines.slice(reader.pos);
  const length = Option.getOrElse(
    Array.findFirstIndex(
      rest,
      (line) => String.isNonEmpty(line.raw.trim()) && line.indent <= parent,
    ),
    () => rest.length,
  );
  const body = rest.slice(0, length);
  reader.pos += length;
  const indent = Option.getOrElse(
    Option.map(
      Array.findFirst(body, (line) => String.isNonEmpty(line.raw.trim())),
      (line) => line.indent,
    ),
    () => parent + 1,
  );
  const lines = body.map((line) => line.raw.slice(indent));
  const joined = folded
    ? lines.join("\n").replace(/([^\n])\n(?=[^\n ])/g, "$1 ")
    : lines.join("\n");
  const trimmed = joined.replace(/\n+$/, "");
  return strip ? trimmed : keep ? `${joined}\n` : `${trimmed}\n`;
}

/** An inline value after `key:` or `- `, with any more-indented continuation lines folded in. */
function inlineValue(reader: Reader, text: string, parent: number, inSequence: boolean): Yaml {
  if (/^[|>][+-]?\d?$/.test(text)) return blockScalar(reader, text, parent);
  reader.pos += 1;
  const rest = reader.lines.slice(reader.pos);
  const length = Option.getOrElse(
    Array.findFirstIndex(rest, (line) => String.isNonEmpty(line.text) && line.indent <= parent),
    () => rest.length,
  );
  const continuation = rest.slice(0, length).filter((line) => String.isNonEmpty(line.text));
  reader.pos += length;
  const whole = [text, ...continuation.map((line) => line.text.trim())].join(" ");
  if (
    Array.isArrayNonEmpty(continuation) &&
    !/^["']/.test(text) &&
    /:\s|^- /.test(whole.slice(text.length))
  ) {
    reader.failed = true;
  }
  return scalar(reader, whole, inSequence);
}

/** Reads the node whose first line is `line` (the reader's current line). */
function readNode(reader: Reader, line: Line, depth: number): Yaml {
  if (depth > MAX_DEPTH) {
    reader.failed = true;
    return null;
  }
  if (isEntry(line.text)) return readSequence(reader, line.indent, depth);
  if (Option.isSome(keyLine(line.text))) return readMapping(reader, line.indent, depth);
  return inlineValue(reader, line.text, line.indent - 1, false);
}

/** The value after a `key:` or `-` with nothing after it: a nested node, or null. */
function nestedValue(reader: Reader, indent: number, depth: number, allowSequence: boolean): Yaml {
  reader.pos += 1;
  return Option.match(peek(reader), {
    onNone: (): Yaml => null,
    onSome: (next) =>
      next.indent > indent || (allowSequence && next.indent === indent && isEntry(next.text))
        ? readNode(reader, next, depth + 1)
        : null,
  });
}

/** Reads a block mapping whose keys sit at `indent`. */
function readMapping(reader: Reader, indent: number, depth: number): Yaml {
  const entries: Array<readonly [string, Yaml]> = [];
  const state = { going: true };
  // oxlint-disable-next-line effect/imperative-loops -- an indentation-structured reader: each key's value consumes a run of lines whose length is known only once it is read, so the next key's position comes from the reader's cursor, not from a list a fold could walk.
  while (state.going && !reader.failed) {
    const line = peek(reader);
    const key = Option.flatMap(
      Option.filter(line, (next) => next.indent === indent),
      (next) => keyLine(next.text),
    );
    if (Option.isNone(key)) {
      state.going = false;
      if (Option.exists(line, (next) => next.indent > indent)) reader.failed = true;
    } else {
      const [name, rest] = key.value;
      const value = String.isEmpty(rest)
        ? nestedValue(reader, indent, depth, true)
        : inlineValue(reader, rest, indent, false);
      entries.push([name, value]);
    }
  }
  return Record.fromEntries(entries);
}

/** Reads a block sequence whose `-` markers sit at `indent`. */
function readSequence(reader: Reader, indent: number, depth: number): Yaml {
  const items: Yaml[] = [];
  const state = { going: true };
  // oxlint-disable-next-line effect/imperative-loops -- an indentation-structured reader: each entry consumes a run of lines whose length is known only once it is read (see readMapping).
  while (state.going && !reader.failed) {
    const line = Option.filter(
      peek(reader),
      (next) => next.indent === indent && isEntry(next.text),
    );
    if (Option.isNone(line)) state.going = false;
    else {
      const rest = line.value.text.slice(1).trimStart();
      if (String.isEmpty(rest)) items.push(nestedValue(reader, indent, depth, false));
      else if (isEntry(rest) || Option.isSome(keyLine(rest))) {
        // A compact entry (`- key: value`, `- - x`): the rest of the line is
        // the first line of a node indented to where its text starts.
        const at = indent + line.value.text.length - rest.length;
        const compact: Line = { indent: at, text: rest, raw: line.value.raw };
        reader.lines[reader.pos] = compact;
        items.push(readNode(reader, compact, depth + 1));
      } else items.push(inlineValue(reader, rest, indent, true));
    }
  }
  return items;
}

/**
 * The first YAML document in `source` (a Markdown file's front matter
 * included): the text between a leading `---` and the next `---` or `...`
 * line, else the whole text up to such a line.
 */
function firstDocument(source: string): string {
  const lines = source.replace(/^﻿/, "").split(/\r\n?|\n/);
  const start = Option.getOrElse(
    Option.map(
      Array.findFirstIndex(
        lines,
        (line) => /^---\s*$/.test(line) || String.isNonEmpty(line.trim()),
      ),
      (index) => (/^---\s*$/.test(lines[index]) ? index + 1 : index),
    ),
    () => lines.length,
  );
  const rest = lines.slice(start);
  const end = Option.getOrElse(
    Array.findFirstIndex(rest, (line) => /^(?:---|\.\.\.)\s*$/.test(line)),
    () => rest.length,
  );
  return rest.slice(0, end).join("\n");
}

/**
 * Reads the first YAML document of `source` (front matter included) as
 * JSON-shaped data; `None` when it uses YAML the reader does not take or is
 * malformed. Total.
 *
 * @since 1.0.0
 */
export function readYaml(source: string): Option.Option<Yaml> {
  const reader: Reader = { lines: toLines(firstDocument(source)), pos: 0, failed: false };
  if (
    reader.lines.some(
      (line) => line.raw.slice(line.indent).startsWith("	") && String.isNonEmpty(line.text),
    )
  ) {
    return Option.none();
  }
  const value = Option.match(peek(reader), {
    onNone: (): Yaml => null,
    onSome: (line) => readNode(reader, line, 0),
  });
  return reader.failed || Option.isSome(peek(reader)) ? Option.none() : Option.some(value);
}

// ── Writing ───────────────────────────────────────────────────────────

/** A character a double-quoted scalar must escape: a C0 control, DEL, NEL or a line / paragraph separator. */
const mustEscape = (code: number): boolean =>
  code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029;

/** A string as a YAML double-quoted scalar (control characters and line separators escaped). */
function quote(value: string): string {
  const escaped = Array.map(Array.fromIterable(value), (char) => {
    const code = char.charCodeAt(0);
    if (char === "\\") return "\\\\";
    if (char === '"') return '\\"';
    if (!mustEscape(code)) return char;
    return code === 10 ? "\\n" : code === 9 ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
  }).join("");
  return `"${escaped}"`;
}

/** A mapping key: plain when it is a simple name, else quoted. */
const yamlKey = (key: string): string => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : quote(key));

/** True for a JSON array. */
const isList = (value: Yaml): value is Schema.JsonArray => globalThis.Array.isArray(value);

/** True for a JSON object. */
const isObject = (value: Yaml): value is Schema.JsonObject =>
  Predicate.isObject(value) && !isList(value);

/** A scalar as YAML. */
function yamlScalar(value: Yaml): string {
  if (Predicate.isString(value)) return quote(value);
  if (Predicate.isNumber(value)) return Number.isFinite(value) ? value.toString() : "null";
  if (Predicate.isBoolean(value)) return value ? "true" : "false";
  return "null";
}

/** True when a value is written inline: a scalar, or a list of scalars and lists (`date-parts`). */
const isFlow = (value: Yaml): boolean =>
  !isObject(value) && (!isList(value) || value.every(isFlow));

/** A flow value: a scalar, or a `[…]` list of flow values. */
const flow = (value: Yaml): string =>
  isList(value) ? `[${value.map(flow).join(", ")}]` : yamlScalar(value);

/** A mapping's entries as YAML lines at `indent`. */
function mappingLines(value: Schema.JsonObject, indent: string): string[] {
  return Record.toEntries(value).flatMap(([key, entry]) => {
    if (isFlow(entry)) return [`${indent}${yamlKey(key)}: ${flow(entry)}`];
    if (isList(entry)) return [`${indent}${yamlKey(key)}:`, ...sequenceLines(entry, indent)];
    if (!isObject(entry) || Record.isEmptyRecord(entry)) return [`${indent}${yamlKey(key)}: {}`];
    return [`${indent}${yamlKey(key)}:`, ...mappingLines(entry, `${indent}  `)];
  });
}

/** A sequence's entries as YAML lines (`- …`) at `indent`, a mapping entry compact. */
function sequenceLines(value: Schema.JsonArray, indent: string): string[] {
  return value.flatMap((entry) => {
    if (isFlow(entry)) return [`${indent}- ${flow(entry)}`];
    if (isList(entry)) return [`${indent}-`, ...sequenceLines(entry, `${indent}  `)];
    const lines = isObject(entry) ? mappingLines(entry, `${indent}  `) : [];
    return Array.match(lines, {
      onEmpty: () => [`${indent}- {}`],
      onNonEmpty: ([first, ...rest]) => [`${indent}- ${first.trimStart()}`, ...rest],
    });
  });
}

/**
 * JSON data as block-style YAML lines: mappings and lists of mappings as
 * blocks, lists of scalars as flow `[…]`, strings double-quoted.
 *
 * @since 1.0.0
 */
export function writeYamlMapping(value: Schema.JsonObject): string[] {
  return mappingLines(value, "");
}
