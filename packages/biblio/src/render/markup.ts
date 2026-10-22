/**
 * CSL-JSON's rich-text markup in text variables, read into {@link RichText}
 * and written back. CSL lets a title carry `<i>`, `<b>`, `<sup>`, `<sub>`,
 * `<span style="font-variant:small-caps;">` and `<span class="nocase">`
 * (a species name in italics, a ship's name, a proper noun a style must not
 * lower-case); a record keeps the markup as text, as CSL-JSON does, and
 * these functions are the one reading of it.
 *
 * Anything else that looks like a tag (an unknown element, an attribute the
 * spec does not list, a close tag with no matching open) is literal text,
 * so a stray `<` in a title survives as typed and no markup but CSL's own
 * ever reaches an HTML adapter.
 *
 * @copyright Thomas Foster
 * @module biblio/render/markup
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as String from "effect/String";
import type { Inline, RichText, Styled } from "./rich.ts";
import { toPlainText } from "./rich.ts";

/** A tag CSL's markup admits: element name, optional `/`, attributes. */
const TAG = /<(\/?)(i|b|sup|sub|span)((?:\s[^<>]*)?)>/g;

/** The styled span each attribute-free open tag starts. */
const PLAIN_TAGS = HashMap.fromIterable<string, Styled["_tag"]>([
  ["i", "Italic"],
  ["b", "Bold"],
  ["sup", "Superscript"],
  ["sub", "Subscript"],
]);

/** The deepest nesting read; a deeper open tag is literal text. */
const MAX_DEPTH = 32;

/** One open span: its kind, the tag text that opened it, its children so far. */
interface Frame {
  readonly tag: Styled["_tag"];
  readonly element: string;
  readonly opened: string;
  readonly children: Inline[];
}

/** The span a `<span …>` opens, from its attributes, or `None` for any other span. */
function spanTag(attributes: string): Option.Option<Styled["_tag"]> {
  const attribute = attributes.trim();
  if (/^style\s*=\s*"\s*font-variant\s*:\s*small-caps\s*;?\s*"$/.test(attribute)) {
    return Option.some("SmallCaps");
  }
  return /^class\s*=\s*"\s*nocase\s*"$/.test(attribute) ? Option.some("NoCase") : Option.none();
}

/** The span an open tag starts, or `None` when CSL's markup does not admit it. */
function openTag(element: string, attributes: string): Option.Option<Styled["_tag"]> {
  if (element === "span") return spanTag(attributes);
  return String.isEmpty(attributes.trim()) ? HashMap.get(PLAIN_TAGS, element) : Option.none();
}

/** Appends text to a node list, merging it into a trailing text node. */
function appendText(children: Inline[], value: string): void {
  if (String.isEmpty(value)) return;
  const last = children[children.length - 1];
  if (last !== undefined && Predicate.isTagged(last, "Text")) {
    children[children.length - 1] = { _tag: "Text", text: last.text + value };
  } else children.push({ _tag: "Text", text: value });
}

/** Closes the innermost frame into its parent: as a span, or (unclosed) as literal text. */
function closeFrame(stack: Frame[], asSpan: boolean): void {
  const frame = stack.pop();
  const parent = stack[stack.length - 1];
  if (frame === undefined || parent === undefined) return;
  if (asSpan) {
    if (Array.isArrayNonEmpty(frame.children)) {
      parent.children.push({ _tag: frame.tag, children: frame.children });
    }
    return;
  }
  appendText(parent.children, frame.opened);
  Array.forEach(frame.children, (child) => {
    if (Predicate.isTagged(child, "Text")) appendText(parent.children, child.text);
    else parent.children.push(child);
  });
}

/**
 * Reads CSL rich-text markup into {@link RichText}: the six CSL elements
 * become styled spans, everything else is text. Total: unbalanced or
 * unknown markup reads as the literal text it is, and a plain string is one
 * text node.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { parseCslMarkup, toHtml, toPlainText } from "@thomasfosterau/biblio"
 *
 * const title = parseCslMarkup('The <i>Escherichia coli</i> genome and <span class="nocase">DNA</span>')
 *
 * assert.strictEqual(toPlainText(title), "The Escherichia coli genome and DNA")
 * assert.strictEqual(toHtml(title), "The <i>Escherichia coli</i> genome and DNA")
 * assert.strictEqual(toPlainText(parseCslMarkup("a < b <u>c</u>")), "a < b <u>c</u>")
 * ```
 *
 * @since 1.0.0
 */
export function parseCslMarkup(value: string): RichText {
  const root: Frame = { tag: "NoCase", element: "", opened: "", children: [] };
  const stack: Frame[] = [root];
  const end = Array.reduce(Array.fromIterable(value.matchAll(TAG)), 0, (from, match) => {
    const [whole, slash, element, attributes] = match;
    const at = match.index;
    const top = stack[stack.length - 1];
    appendText(top.children, value.slice(from, at));
    if (String.isEmpty(slash)) {
      const tag = openTag(element, attributes);
      if (Option.isSome(tag) && stack.length <= MAX_DEPTH) {
        stack.push({ tag: tag.value, element, opened: whole, children: [] });
      } else appendText(top.children, whole);
    } else if (stack.length > 1 && top.element === element && String.isEmpty(attributes.trim())) {
      closeFrame(stack, true);
    } else appendText(stack[stack.length - 1].children, whole);
    return at + whole.length;
  });
  appendText(stack[stack.length - 1].children, value.slice(end));
  // Unclosed spans, innermost first, fold back into literal text.
  Array.forEach(stack.slice(1), () => closeFrame(stack, false));
  return root.children;
}

/** The CSL markup each styled span writes as. */
const CSL_TAGS: Readonly<Record<Styled["_tag"], readonly [string, string]>> = {
  Italic: ["<i>", "</i>"],
  Bold: ["<b>", "</b>"],
  SmallCaps: ['<span style="font-variant:small-caps;">', "</span>"],
  Superscript: ["<sup>", "</sup>"],
  Subscript: ["<sub>", "</sub>"],
  NoCase: ['<span class="nocase">', "</span>"],
};

/**
 * Writes {@link RichText} as CSL rich-text markup, the inverse of
 * {@link parseCslMarkup}: styled spans as CSL's elements, a link or display
 * region as its text.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { concat, italic, text, toCslMarkup } from "@thomasfosterau/biblio"
 *
 * assert.strictEqual(toCslMarkup(concat(text("On "), italic(text("Homo sapiens")))), "On <i>Homo sapiens</i>")
 * ```
 *
 * @since 1.0.0
 */
export function toCslMarkup(rich: RichText): string {
  return rich
    .map((node): string => {
      if (Predicate.isTagged(node, "Text")) return node.text;
      if (Predicate.isTagged(node, "Link") || Predicate.isTagged(node, "Display")) {
        return toCslMarkup(node.children);
      }
      const [open, close] = CSL_TAGS[node._tag];
      return `${open}${toCslMarkup(node.children)}${close}`;
    })
    .join("");
}

/**
 * A text variable's plain text: its CSL markup dropped, for matching,
 * sorting and dedup.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { stripCslMarkup } from "@thomasfosterau/biblio"
 *
 * assert.strictEqual(stripCslMarkup("The <i>Beagle</i> voyage"), "The Beagle voyage")
 * ```
 *
 * @since 1.0.0
 */
export const stripCslMarkup = (value: string): string => toPlainText(parseCslMarkup(value));
