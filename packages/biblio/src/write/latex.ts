/**
 * Text → LaTeX for the BibTeX writer, the inverse of the parser's LaTeX
 * decoder: the specials escaped (`&` → `\&`, `{` → `\{`, `\` →
 * `\textbackslash{}`), `--` and `''` kept literal, CSL markup as LaTeX
 * commands (`<i>` → `\emph{…}`, `<b>` → `\textbf{…}`, the small-caps span →
 * `\textsc{…}`, `<sup>` / `<sub>` → `\textsuperscript{…}` /
 * `\textsubscript{…}`) and a `nocase` span as a `{…}` case-protecting
 * group. In the `bibtex` dialect non-ASCII letters become accent commands
 * (`ö` → `{\"o}`, `ç` → `{\c{c}}`, `ø` → `{\o}`), and typographic dashes
 * and quotes their ASCII ligatures; a character with no LaTeX spelling here
 * is kept as UTF-8.
 *
 * @copyright Thomas Foster
 * @module biblio/write/latex
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { parseCslMarkup } from "../render/markup.ts";
import type { RichText, Styled } from "../render/rich.ts";

/** ASCII characters LaTeX reads as markup, and their escaped spelling. */
const SPECIALS = HashMap.fromIterable<string, string>([
  ["\\", "\\textbackslash{}"],
  ["{", "\\{"],
  ["}", "\\}"],
  ["&", "\\&"],
  ["%", "\\%"],
  ["$", "\\$"],
  ["#", "\\#"],
  ["_", "\\_"],
  ["~", "\\textasciitilde{}"],
  ["^", "\\textasciicircum{}"],
]);

/** Characters with a LaTeX spelling of their own (the `bibtex` dialect). */
const LETTERS = HashMap.fromIterable<string, string>([
  ["å", "{\\aa}"],
  ["Å", "{\\AA}"],
  ["æ", "{\\ae}"],
  ["Æ", "{\\AE}"],
  ["ø", "{\\o}"],
  ["Ø", "{\\O}"],
  ["œ", "{\\oe}"],
  ["Œ", "{\\OE}"],
  ["ß", "{\\ss}"],
  ["ł", "{\\l}"],
  ["Ł", "{\\L}"],
  ["ı", "{\\i}"],
  ["ð", "{\\dh}"],
  ["Ð", "{\\DH}"],
  ["đ", "{\\dj}"],
  ["Đ", "{\\DJ}"],
  ["þ", "{\\th}"],
  ["Þ", "{\\TH}"],
  ["ŋ", "{\\ng}"],
  ["Ŋ", "{\\NG}"],
  ["–", "--"],
  ["—", "---"],
  ["“", "``"],
  ["”", "''"],
  ["‘", "`"],
  ["’", "'"],
  ["…", "\\ldots{}"],
  ["©", "\\copyright{}"],
  ["£", "\\pounds{}"],
  ["€", "\\texteuro{}"],
  ["§", "\\S{}"],
  ["¶", "\\P{}"],
  ["«", "\\guillemotleft{}"],
  ["»", "\\guillemotright{}"],
  ["¡", "\\textexclamdown{}"],
  ["¿", "\\textquestiondown{}"],
  ["°", "\\textdegree{}"],
  [" ", "~"],
]);

/** Combining marks and the accent command that puts each on a letter. */
const ACCENTS = HashMap.fromIterable<string, string>([
  ["̀", "\\`"],
  ["́", "\\'"],
  ["̂", "\\^"],
  ["̃", "\\~"],
  ["̄", "\\="],
  ["̇", "\\."],
  ["̈", '\\"'],
  ["̆", "\\u"],
  ["̊", "\\r"],
  ["̋", "\\H"],
  ["̌", "\\v"],
  ["̣", "\\d"],
  ["̧", "\\c"],
  ["̨", "\\k"],
  ["̱", "\\b"],
]);

/** A letter with one combining mark as an accent command (`{\"o}`, `{\c{c}}`, `{\'\i}`). */
function accented(char: string): Option.Option<string> {
  const decomposed = char.normalize("NFD");
  const base = decomposed.charAt(0);
  const mark = decomposed.slice(1);
  if (!/^[A-Za-z]$/.test(base)) return Option.none();
  return Option.map(HashMap.get(ACCENTS, mark), (command) => {
    const letter = base === "i" ? "\\i" : base === "j" ? "\\j" : base;
    // A control word (`\c`, `\v`) takes its argument as a group; a control
    // symbol (`\"`, `\'`) the letter directly.
    return /[a-zA-Z]$/.test(command) ? `{${command}{${letter}}}` : `{${command}${letter}}`;
  });
}

/**
 * The writer's LaTeX dialect: UTF-8 kept (`biblatex`), or ASCII with accent
 * commands (`bibtex`).
 *
 * @since 1.0.0
 */
export type LatexDialect = "bibtex" | "biblatex";

/**
 * Plain text as LaTeX: the specials escaped, the parser's ligatures (`--`,
 * `''`) broken with an empty group so they read back as typed, and in the
 * `bibtex` dialect non-ASCII letters as accent commands.
 *
 * @since 1.0.0
 */
function escapeLatex(value: string, dialect: LatexDialect): string {
  const chars = Array.fromIterable(value.normalize("NFC"));
  return Array.map(chars, (char, index) => {
    const next = chars[index + 1];
    if ((char === "-" && next === "-") || (char === "'" && next === "'")) return `${char}{}`;
    const special = HashMap.get(SPECIALS, char);
    if (Option.isSome(special)) return special.value;
    if (dialect === "biblatex" || char.charCodeAt(0) < 128) return char;
    return Option.getOrElse(
      Option.orElse(HashMap.get(LETTERS, char), () => accented(char)),
      () => char,
    );
  }).join("");
}

/** The LaTeX command each styled span writes as (`NoCase` is a bare group). */
const COMMANDS: Readonly<Record<Styled["_tag"], string>> = {
  Italic: "\\emph",
  Bold: "\\textbf",
  SmallCaps: "\\textsc",
  Superscript: "\\textsuperscript",
  Subscript: "\\textsubscript",
  NoCase: "",
};

/** Rich text as LaTeX. */
function richToLatex(rich: RichText, dialect: LatexDialect): string {
  return rich
    .map((node): string => {
      if (Predicate.isTagged(node, "Text")) return escapeLatex(node.text, dialect);
      const inner = richToLatex(node.children, dialect);
      if (Predicate.isTagged(node, "Link") || Predicate.isTagged(node, "Display")) return inner;
      return `${COMMANDS[node._tag]}{${inner}}`;
    })
    .join("");
}

/**
 * A text variable (which may carry CSL markup) as a LaTeX field value: the
 * markup as LaTeX commands, a `nocase` span as a case-protecting `{…}` group,
 * the text escaped.
 *
 * @since 1.0.0
 */
export const textToLatex = (value: string, dialect: LatexDialect): string =>
  richToLatex(parseCslMarkup(value), dialect);

/**
 * A verbatim field value (a URL, a DOI): braces and backslashes, which would
 * unbalance or escape the field, percent-encoded; everything else as written.
 *
 * @since 1.0.0
 */
export const verbatimLatex = (value: string): string =>
  value.replace(/\{/g, "%7B").replace(/\}/g, "%7D").replace(/\\/g, "%5C");
