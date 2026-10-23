/**
 * The render engine's format-neutral rich-text output: a small inline AST
 * (text, italic, bold, small caps, superscript, subscript, CSL's `nocase`
 * span, link, and CSL's `display` blocks) with plain-text, HTML and Markdown
 * adapters.
 *
 * Styles build references and citations as {@link RichText}, so formatting
 * (an APA container title in italics, a linked DOI) survives to whatever the
 * caller renders: a document model maps the nodes onto its own inlines, and
 * the string functions (`renderReference`, `bibliographyToText`) are
 * {@link toPlainText} over the same tree.
 *
 * @copyright Thomas Foster
 * @module biblio/render/rich
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as String from "effect/String";

/**
 * A run of plain text.
 *
 * @since 0.1.0
 */
export interface Text {
  readonly _tag: "Text";
  readonly text: string;
}

/**
 * A styled span: italic, bold, small caps, superscript, subscript, or
 * `NoCase` — text a style's case transform must leave alone (a proper noun
 * in a title, BibTeX's `{DNA}`), which renders as its children. `NoCase`
 * was added in 1.0.0.
 *
 * @since 0.1.0
 */
export interface Styled {
  readonly _tag: "Italic" | "Bold" | "SmallCaps" | "Superscript" | "Subscript" | "NoCase";
  readonly children: RichText;
}

/**
 * A hyperlink around its text.
 *
 * @since 0.1.0
 */
export interface Link {
  readonly _tag: "Link";
  readonly url: string;
  readonly children: RichText;
}

/**
 * A CSL `display` region of a bibliography entry: a block, the left margin
 * (a label), the inline text to its right, or an indented block.
 *
 * @since 0.1.0
 */
export interface Display {
  readonly _tag: "Display";
  readonly display: "block" | "left-margin" | "right-inline" | "indent";
  readonly children: RichText;
}

/**
 * One node of rich text.
 *
 * @since 0.1.0
 */
export type Inline = Text | Styled | Link | Display;

/**
 * Rich text: a sequence of inline nodes.
 *
 * @since 0.1.0
 */
export type RichText = readonly Inline[];

/**
 * Plain text as rich text; the empty string is the empty sequence.
 *
 * @since 0.1.0
 */
export const text = (value: string): RichText =>
  String.isEmpty(value) ? [] : [{ _tag: "Text", text: value }];

const styled =
  (tag: Styled["_tag"]) =>
  (children: RichText): RichText =>
    Array.isReadonlyArrayEmpty(children) ? [] : [{ _tag: tag, children }];

/**
 * Italic rich text (titles of books and journals).
 *
 * @since 0.1.0
 */
export const italic: (children: RichText) => RichText = styled("Italic");

/**
 * Bold rich text.
 *
 * @since 0.1.0
 */
export const bold: (children: RichText) => RichText = styled("Bold");

/**
 * Small-caps rich text.
 *
 * @since 0.1.0
 */
export const smallCaps: (children: RichText) => RichText = styled("SmallCaps");

/**
 * Superscript rich text.
 *
 * @since 0.1.0
 */
export const superscript: (children: RichText) => RichText = styled("Superscript");

/**
 * Subscript rich text.
 *
 * @since 0.1.0
 */
export const subscript: (children: RichText) => RichText = styled("Subscript");

/**
 * Rich text a case transform leaves alone (CSL's `<span class="nocase">`).
 *
 * @since 1.0.0
 */
export const noCase: (children: RichText) => RichText = styled("NoCase");

/**
 * A link to `url` around `children` (the URL itself when `children` is
 * empty).
 *
 * @since 0.1.0
 */
export const link = (url: string, children: RichText = text(url)): RichText =>
  Array.isReadonlyArrayEmpty(children) ? [] : [{ _tag: "Link", url, children }];

/**
 * A CSL `display` region around `children`.
 *
 * @since 0.1.0
 */
export const display = (region: Display["display"], children: RichText): RichText =>
  Array.isReadonlyArrayEmpty(children) ? [] : [{ _tag: "Display", display: region, children }];

/**
 * Concatenates rich texts.
 *
 * @since 0.1.0
 */
export const concat = (...parts: readonly RichText[]): RichText => parts.flat();

/**
 * The text of rich text with all formatting dropped.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { concat, italic, link, text, toHtml, toMarkdown, toPlainText } from "@thomasfosterau/biblio"
 *
 * const rich = concat(italic(text("Nature")), text(", 431. "), link("https://doi.org/10.1038/431231a"))
 *
 * assert.strictEqual(toPlainText(rich), "Nature, 431. https://doi.org/10.1038/431231a")
 * assert.strictEqual(
 *   toHtml(rich),
 *   '<i>Nature</i>, 431. <a href="https://doi.org/10.1038/431231a">https://doi.org/10.1038/431231a</a>',
 * )
 * assert.strictEqual(
 *   toMarkdown(rich),
 *   "*Nature*, 431. [https://doi.org/10.1038/431231a](https://doi.org/10.1038/431231a)",
 * )
 * ```
 *
 * @since 0.1.0
 */
export function toPlainText(rich: RichText): string {
  return rich
    .map((node) => (Predicate.isTagged(node, "Text") ? node.text : toPlainText(node.children)))
    .join("");
}

/**
 * True when rich text has no visible (non-blank) text.
 *
 * @since 0.1.0
 */
export const isBlank = (rich: RichText): boolean => String.isEmpty(toPlainText(rich).trim());

/** Escapes the characters HTML gives meaning to. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * True for a URL safe to emit as a link target: `http:`, `https:` or
 * `mailto:`. A record's URL is untrusted text, and a `javascript:` URL in an
 * `href` would run in the reader's page.
 */
const isSafeUrl = (url: string): boolean => /^(?:https?:\/\/|mailto:)/i.test(url.trim());

/** The HTML element each styled span renders as; `NoCase` has none. */
const HTML_TAGS: Readonly<Record<Styled["_tag"], readonly [string, string]>> = {
  Italic: ["<i>", "</i>"],
  Bold: ["<b>", "</b>"],
  SmallCaps: ['<span style="font-variant:small-caps;">', "</span>"],
  Superscript: ["<sup>", "</sup>"],
  Subscript: ["<sub>", "</sub>"],
  NoCase: ["", ""],
};

/**
 * Renders rich text as HTML, the markup citeproc-js emits: `<i>`, `<b>`,
 * small caps as a `font-variant` span, `<sup>`, `<sub>`, `<a href>`, and a
 * `div.csl-<display>` per display region. Text and URLs are escaped; a link
 * whose URL is not `http(s)` or `mailto` renders as its text alone. Italics
 * flip-flop, as in citeproc-js: italic text inside italic text (a species
 * name in a book title a style italicises) renders upright, as a
 * `font-style:normal` span.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { concat, italic, text, toHtml, toMarkdown } from "@thomasfosterau/biblio"
 *
 * const title = italic(concat(text("The voyage of the "), italic(text("Beagle"))))
 * assert.strictEqual(toHtml(title), '<i>The voyage of the <span style="font-style:normal;">Beagle</span></i>')
 * assert.strictEqual(toMarkdown(title), "*The voyage of the* Beagle")
 * ```
 *
 * @since 0.1.0
 */
export function toHtml(rich: RichText): string {
  return htmlNodes(rich, false);
}

/** Rich text as HTML, inside italics or not. */
const htmlNodes = (rich: RichText, inItalic: boolean): string =>
  rich.map((node) => htmlNode(node, inItalic)).join("");

function htmlNode(node: Inline, inItalic: boolean): string {
  if (Predicate.isTagged(node, "Text")) return escapeHtml(node.text);
  if (Predicate.isTagged(node, "Link")) {
    return isSafeUrl(node.url)
      ? `<a href="${escapeHtml(node.url.trim())}">${htmlNodes(node.children, inItalic)}</a>`
      : htmlNodes(node.children, inItalic);
  }
  if (Predicate.isTagged(node, "Display")) {
    return `<div class="csl-${node.display}">${htmlNodes(node.children, inItalic)}</div>`;
  }
  if (Predicate.isTagged(node, "Italic")) {
    const children = htmlNodes(node.children, !inItalic);
    return inItalic ? `<span style="font-style:normal;">${children}</span>` : `<i>${children}</i>`;
  }
  const [open, close] = HTML_TAGS[node._tag];
  return `${open}${htmlNodes(node.children, inItalic)}${close}`;
}

/** The Markdown delimiters of each styled span; those without Markdown syntax are inline HTML. */
const MARKDOWN_TAGS: Readonly<Record<Styled["_tag"], readonly [string, string]>> = {
  ...HTML_TAGS,
  Italic: ["*", "*"],
  Bold: ["**", "**"],
};

/** Escapes the characters CommonMark gives inline meaning to. */
const escapeMarkdown = (value: string): string => value.replace(/([\\`*_[\]<>~|])/g, "\\$1");

/**
 * Renders rich text as CommonMark: `*italic*`, `**bold**`, `[text](url)`;
 * small caps, superscript and subscript have no Markdown syntax and render
 * as inline HTML. Text is escaped; an unsafe link renders as its text alone,
 * and a display region as its text. Italics flip-flop as in {@link toHtml}:
 * italic text inside italic text closes the emphasis around it, and the
 * spaces at an emphasis's edges sit outside its `*`, as CommonMark needs.
 *
 * @since 0.1.0
 */
export function toMarkdown(rich: RichText): string {
  return markdownNodes(rich, false);
}

/** Rich text as Markdown, inside italics or not. */
const markdownNodes = (rich: RichText, inItalic: boolean): string =>
  rich.map((node) => markdownNode(node, inItalic)).join("");

/** `*text*`, with the text's edge whitespace moved outside the delimiters; nothing for blank text. */
function emphasis(inner: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  const [, lead, core, trail] = match ?? ["", "", inner, ""];
  return String.isEmpty(core) ? inner : `${lead}*${core}*${trail}`;
}

/**
 * An italic span as Markdown: its runs of text emphasised, and any italic
 * nested in it written upright between them (the flip-flop).
 */
function markdownItalic(children: RichText): string {
  const none: Array<{ upright: boolean; nodes: Inline[] }> = [];
  const runs = Array.reduce(children, none, (acc, node) => {
    const upright = Predicate.isTagged(node, "Italic");
    const last = acc[acc.length - 1];
    if (last !== undefined && last.upright === upright && !upright) last.nodes.push(node);
    else acc.push({ upright, nodes: [node] });
    return acc;
  });
  return runs
    .map((run) =>
      run.upright
        ? run.nodes
            .map((node) =>
              Predicate.isTagged(node, "Italic") ? markdownNodes(node.children, false) : "",
            )
            .join("")
        : emphasis(markdownNodes(run.nodes, true)),
    )
    .join("");
}

function markdownNode(node: Inline, inItalic: boolean): string {
  if (Predicate.isTagged(node, "Text")) return escapeMarkdown(node.text);
  if (Predicate.isTagged(node, "Link")) {
    return isSafeUrl(node.url)
      ? `[${markdownNodes(node.children, inItalic)}](${node.url.trim().replace(/[()\s<>]/g, encodeURIComponent)})`
      : markdownNodes(node.children, inItalic);
  }
  if (Predicate.isTagged(node, "Display")) return markdownNodes(node.children, inItalic);
  if (Predicate.isTagged(node, "Italic")) return markdownItalic(node.children);
  const [open, close] = MARKDOWN_TAGS[node._tag];
  return `${open}${markdownNodes(node.children, inItalic)}${close}`;
}

/** Removes leading whitespace, and any node left empty by it. */
function trimStart(rich: RichText): RichText {
  return Option.match(Array.head(rich), {
    onNone: () => rich,
    onSome: (first) => {
      const rest = rich.slice(1);
      if (!Predicate.isTagged(first, "Text")) {
        const children = trimStart(first.children);
        return Array.isReadonlyArrayEmpty(children)
          ? trimStart(rest)
          : [{ ...first, children }, ...rest];
      }
      const trimmed = first.text.trimStart();
      return String.isEmpty(trimmed) ? trimStart(rest) : [{ _tag: "Text", text: trimmed }, ...rest];
    },
  });
}

/** Removes trailing whitespace, and any node left empty by it. */
function trimEnd(rich: RichText): RichText {
  return Option.match(Array.last(rich), {
    onNone: () => rich,
    onSome: (last) => {
      const rest = rich.slice(0, -1);
      if (!Predicate.isTagged(last, "Text")) {
        const children = trimEnd(last.children);
        return Array.isReadonlyArrayEmpty(children)
          ? trimEnd(rest)
          : [...rest, { ...last, children }];
      }
      const trimmed = last.text.trimEnd();
      return String.isEmpty(trimmed) ? trimEnd(rest) : [...rest, { _tag: "Text", text: trimmed }];
    },
  });
}

/**
 * Joins the non-blank parts with `separator`, each trimmed: the rich
 * counterpart of `joinParts`.
 *
 * @since 0.1.0
 */
export function joinRich(parts: readonly Option.Option<RichText>[], separator: string): RichText {
  const present = Array.filter(Array.getSomes(parts), (part) => !isBlank(part)).map((part) =>
    trimEnd(trimStart(part)),
  );
  const empty: RichText = [];
  return Array.reduce(present, empty, (joined, part) =>
    Array.isReadonlyArrayEmpty(joined) ? part : concat(joined, text(separator), part),
  );
}

/**
 * Ends rich text with terminal punctuation, adding a period (outside any
 * formatting) when its text does not already end in `.`, `?` or `!`: the
 * rich counterpart of `terminate`.
 *
 * @since 0.1.0
 */
export function terminateRich(rich: RichText): RichText {
  const plain = toPlainText(rich);
  if (String.isEmpty(plain) || /[.?!]$/.test(plain)) return rich;
  return concat(rich, text("."));
}
