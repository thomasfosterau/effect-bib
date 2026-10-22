/**
 * LaTeX → Unicode decoding for BibTeX field values: accents (`{\"o}`,
 * `\'{e}`, `\c{c}`, `\v{s}`), special letters (`{\aa}`, `\ss`, `\o`),
 * escaped specials (`\&`, `\%`), dashes and quotes (`--`, `---`, ` `` `),
 * ties (`~`), and the common text commands (`\emph`, `\textbf`, `\url`,
 * `\href`, `\enquote`), whose formatting is dropped and whose text is kept.
 *
 * Grouping braces are removed. They also carry BibTeX's case protection
 * (`{DNA}`); the record has no rich-text field to keep it in yet, and no
 * renderer changes a title's case, so nothing reads it today.
 *
 * @copyright Thomas Foster
 * @module biblio/bibtex/latex
 * @since 0.1.0
 */

import { Parser, Token } from "@thomasfosterau/effect-parse";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { braced } from "./scan.ts";

/** Combining marks for the control-symbol accents (`\"o`, `\'e`, …). */
const SYMBOL_ACCENTS = HashMap.fromIterable<string, string>([
  ["`", "̀"],
  ["'", "́"],
  ["^", "̂"],
  ["~", "̃"],
  ["=", "̄"],
  [".", "̇"],
  ['"', "̈"],
]);

/** Combining marks for the control-word accents (`\c{c}`, `\v{s}`, …). */
const WORD_ACCENTS = HashMap.fromIterable<string, string>([
  ["u", "̆"],
  ["r", "̊"],
  ["H", "̋"],
  ["v", "̌"],
  ["d", "̣"],
  ["c", "̧"],
  ["k", "̨"],
  ["b", "̱"],
  ["t", "͡"],
]);

/** Control words that stand for a character or a fixed text. */
const SYMBOL_WORDS = HashMap.fromIterable<string, string>([
  ["aa", "å"],
  ["AA", "Å"],
  ["ae", "æ"],
  ["AE", "Æ"],
  ["o", "ø"],
  ["O", "Ø"],
  ["oe", "œ"],
  ["OE", "Œ"],
  ["ss", "ß"],
  ["SS", "SS"],
  ["l", "ł"],
  ["L", "Ł"],
  ["i", "ı"],
  ["j", "ȷ"],
  ["dh", "ð"],
  ["DH", "Ð"],
  ["dj", "đ"],
  ["DJ", "Đ"],
  ["th", "þ"],
  ["TH", "Þ"],
  ["ng", "ŋ"],
  ["NG", "Ŋ"],
  ["copyright", "©"],
  ["textcopyright", "©"],
  ["textregistered", "®"],
  ["texttrademark", "™"],
  ["pounds", "£"],
  ["textsterling", "£"],
  ["euro", "€"],
  ["texteuro", "€"],
  ["S", "§"],
  ["P", "¶"],
  ["dag", "†"],
  ["ddag", "‡"],
  ["textdagger", "†"],
  ["textdaggerdbl", "‡"],
  ["ldots", "…"],
  ["dots", "…"],
  ["textellipsis", "…"],
  ["textendash", "–"],
  ["textemdash", "—"],
  ["textquoteleft", "‘"],
  ["textquoteright", "’"],
  ["textquotedblleft", "“"],
  ["textquotedblright", "”"],
  ["guillemotleft", "«"],
  ["guillemotright", "»"],
  ["guillemetleft", "«"],
  ["guillemetright", "»"],
  ["textexclamdown", "¡"],
  ["textquestiondown", "¿"],
  ["textasciitilde", "~"],
  ["textbackslash", "\\"],
  ["textasciicircum", "^"],
  ["textunderscore", "_"],
  ["textbar", "|"],
  ["textless", "<"],
  ["textgreater", ">"],
  ["textdegree", "°"],
  ["textbullet", "•"],
  ["textperiodcentered", "·"],
  ["textordfeminine", "ª"],
  ["textordmasculine", "º"],
  ["quad", " "],
  ["qquad", " "],
  ["space", " "],
  ["nobreakspace", " "],
  ["slash", "/"],
  ["TeX", "TeX"],
  ["LaTeX", "LaTeX"],
  ["LaTeXe", "LaTeX2e"],
  ["BibTeX", "BibTeX"],
]);

/** Control symbols that stand for a character (`\&`, `\%`) or nothing (`\-`). */
const SYMBOL_CHARACTERS = HashMap.fromIterable<string, string>([
  ["\\", " "],
  [" ", " "],
  [",", " "],
  [";", " "],
  [":", " "],
  ["!", ""],
  ["-", ""],
  ["/", ""],
  ["@", ""],
]);

/** A control word's name: a run of ASCII letters. */
const isLetter = (char: string): boolean =>
  (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");

/** Whitespace that TeX skips after a control word. */
const blank = Token.takeWhile(" \t\r\n");

/** A `{…}` group's inner text. */
const groupText = Parser.map(Parser.taken(braced), (group) => group.slice(1, -1));

/**
 * Puts a combining mark on the first character of `base`, composed to NFC
 * (`o` + U+0308 → `ö`). The dotless `ı` / `ȷ` take the mark as `i` / `j`,
 * so `\'{\i}` composes to `í`.
 */
function applyAccent(mark: string, base: string): string {
  const first = base.charAt(0);
  if (first === "") return "";
  const letter = first === "ı" ? "i" : first === "ȷ" ? "j" : first;
  return `${letter}${mark}${base.slice(1)}`.normalize("NFC");
}

/** An accent's argument: a `{…}` group, a control word (`\i`, and the blanks after it), or one character. */
const accentArgument = Parser.preceded(
  blank,
  Parser.alt(
    Parser.map(groupText, (inner) => decodeLatex(inner)),
    Parser.map(
      Parser.preceded(
        Token.literal("\\"),
        Parser.zipLeft(Token.takeWhile(isLetter, { min: 1 }), blank),
      ),
      (name) => Option.getOrElse(HashMap.get(SYMBOL_WORDS, name), () => ""),
    ),
    Token.noneOf("{}\\"),
  ),
);

/** An accent command's output: its argument, accented (or nothing when it has none). */
const accented = (mark: string): Parser.Parser<string> =>
  Parser.orElseSucceed(
    Parser.map(accentArgument, (base) => applyAccent(mark, base)),
    () => "",
  );

/** An optional `{…}` group after a command, mapped; nothing when it is absent. */
const withGroup = (f: (inner: string) => string): Parser.Parser<string> =>
  Parser.orElseSucceed(Parser.map(groupText, f), () => "");

/**
 * What follows a control word. Accents take an argument; `\url` keeps its
 * group verbatim (a URL's `~`, `_` and `--` are not markup); `\href` drops
 * its URL group and keeps the link text; `\enquote` quotes its group; a
 * symbol word is its character; any other command is dropped, and its
 * arguments read on as ordinary text.
 */
function controlWord(name: string): Parser.Parser<string> {
  const accent = HashMap.get(WORD_ACCENTS, name);
  if (Option.isSome(accent)) return accented(accent.value);
  if (name === "url") return withGroup((inner) => inner);
  if (name === "href") return withGroup(() => "");
  if (name === "enquote") return withGroup((inner) => `“${decodeLatex(inner)}”`);
  return Parser.succeed(Option.getOrElse(HashMap.get(SYMBOL_WORDS, name), () => ""));
}

/** What follows a control symbol (`\"`, `\&`, `\\`, …). */
function controlSymbol(char: string): Parser.Parser<string> {
  const accent = HashMap.get(SYMBOL_ACCENTS, char);
  if (Option.isSome(accent)) return accented(accent.value);
  return Parser.succeed(Option.getOrElse(HashMap.get(SYMBOL_CHARACTERS, char), () => char));
}

/** A `\` command: a control word (and the blanks after it), a control symbol, or a trailing `\`. */
const command = Parser.preceded(
  Token.literal("\\"),
  Parser.alt(
    Parser.dispatch(Parser.zipLeft(Token.takeWhile(isLetter, { min: 1 }), blank), controlWord),
    Parser.dispatch(Token.any, controlSymbol),
    Parser.succeed(""),
  ),
);

/** One piece of LaTeX source and its decoded text. */
const piece = Parser.alt(
  Token.takeTill("\\{}-~`'$", { min: 1 }),
  command,
  Parser.as(Token.oneOf("{}$"), ""),
  Parser.as(Token.literal("---"), "—"),
  Parser.as(Token.literal("--"), "–"),
  Token.literal("-"),
  Parser.as(Token.literal("~"), " "),
  Parser.as(Token.literal("``"), "“"),
  Parser.as(Token.literal("''"), "”"),
  Parser.as(Token.literal("`"), "‘"),
  Token.literal("'"),
);

/** The whole decoder: every piece, concatenated. */
const decoder = Parser.compile(
  Parser.fold(piece, {
    init: (): string[] => [],
    f: (pieces, text) => {
      pieces.push(text);
      return pieces;
    },
  }),
  { backend: "closure" },
);

/**
 * Decodes a LaTeX field value to plain Unicode text. Total: every character
 * is matched by some piece, an unknown command is dropped, and an unbalanced
 * brace is removed like a balanced one.
 *
 * @since 0.1.0
 */
export function decodeLatex(source: string): string {
  // A `fold` with no minimum always succeeds.
  const decoded = Parser.parsePeek(decoder, source);
  return Result.isSuccess(decoded) ? decoded.success[1].join("") : source;
}
