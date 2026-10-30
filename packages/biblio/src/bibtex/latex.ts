/**
 * LaTeX → Unicode decoding for BibTeX field values: accents (`{\"o}`,
 * `\'{e}`, `\c{c}`, `\v{s}`), special letters (`{\aa}`, `\ss`, `\o`),
 * escaped specials (`\&`, `\%`), dashes and quotes (`--`, `---`, ` `` `),
 * ties (`~`), and the common text commands (`\emph`, `\textbf`, `\url`,
 * `\href`, `\enquote`), whose formatting is dropped and whose text is kept.
 * Grouping braces are removed, so BibTeX's case protection (`{DNA}`) is not
 * kept.
 *
 * {@link decodeLatexMarkup} is the opt-in alternative (`bibtexMarkup` in the
 * parse options): the same decoding, with the formatting commands and the
 * case-protecting groups kept as CSL rich-text markup.
 *
 * @copyright Thomas Foster
 * @module biblio/bibtex/latex
 * @since 0.1.0
 */

import { Compiler, Parser, Token } from "@thomasfosterau/effect-parse";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
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
  // BibLaTeX's breakable hyphen.
  ["hyphen", "-"],
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
 * What follows a control word, by name. Accents take an argument; `\url`
 * keeps its group verbatim (a URL's `~`, `_` and `--` are not markup);
 * `\href` drops its URL group and keeps the link text; `\enquote` and
 * BibLaTeX's `\mkbibquote` quote their group; a symbol word is its character. Built once: a record of cases, not a
 * function, so a command's parser is not rebuilt each time it occurs.
 * Later entries win, so an accent takes precedence over a symbol word.
 */
const controlWords = Record.fromEntries([
  ...Array.from(SYMBOL_WORDS, ([name, symbol]) => [name, Parser.succeed(symbol)] as const),
  ["url", withGroup((inner) => inner)],
  ["href", withGroup(() => "")],
  ["enquote", withGroup((inner) => `“${decodeLatex(inner)}”`)],
  ["mkbibquote", withGroup((inner) => `“${decodeLatex(inner)}”`)],
  ...Array.from(WORD_ACCENTS, ([name, mark]) => [name, accented(mark)] as const),
]);

/** Any other command is dropped, and its arguments read on as ordinary text. */
const droppedCommand = Parser.succeed("");

/** What follows a known control symbol (`\"`, `\&`, `\\`, …); an accent wins over a character. */
const controlSymbols = Record.fromEntries([
  ...Array.from(SYMBOL_CHARACTERS, ([char, text]) => [char, Parser.succeed(text)] as const),
  ...Array.from(SYMBOL_ACCENTS, ([char, mark]) => [char, accented(mark)] as const),
]);

/**
 * A `\` command: a control word (and the blanks after it), a control symbol
 * (an unknown one is the character itself), or a trailing `\`.
 */
const command = Parser.preceded(
  Token.literal("\\"),
  Parser.alt(
    Parser.dispatch(
      Parser.zipLeft(Token.takeWhile(isLetter, { min: 1 }), blank),
      controlWords,
      droppedCommand,
    ),
    Parser.dispatch(Token.any, controlSymbols),
    Token.any,
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
const decoder = Compiler.closure(
  Parser.fold(piece, {
    init: (): string[] => [],
    f: (pieces, text) => {
      pieces.push(text);
      return pieces;
    },
  }),
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

// ── CSL markup ─────────────────────────────────────────────────────────

/** The formatting commands kept as CSL markup, and the markup each becomes. */
const FORMATTING: ReadonlyArray<readonly [string, string, string]> = [
  ["emph", "<i>", "</i>"],
  ["mkbibemph", "<i>", "</i>"],
  ["textit", "<i>", "</i>"],
  ["textbf", "<b>", "</b>"],
  ["textsc", '<span style="font-variant:small-caps;">', "</span>"],
  ["textsuperscript", "<sup>", "</sup>"],
  ["textsubscript", "<sub>", "</sub>"],
];

/**
 * A literal `<` in the source, which CSL markup cannot escape: it is wrapped
 * in a `nocase` span, so `a <i> b` cannot read back as markup. Every CSL
 * processor reads the span as its text.
 */
const LITERAL_LT = '<span class="nocase"><</span>';

/** Text with every `<` made literal for CSL markup. */
const literal = (text: string): string => text.replace(/</g, LITERAL_LT);

/**
 * The CSL-markup decoder's pieces: as the plain decoder's, with the
 * formatting commands as markup, a case-protecting `{…}` group as a
 * `nocase` span (one level: inside it, groups are plain), and `<` literal.
 */
function markupPieces(inNoCase: boolean): Parser.Parser<string> {
  const decode = (inner: string): string =>
    inNoCase ? decodeNoCaseMarkup(inner) : decodeLatexMarkup(inner);
  const words = Record.fromEntries([
    ...Array.from(
      SYMBOL_WORDS,
      ([name, symbol]) => [name, Parser.succeed(literal(symbol))] as const,
    ),
    ["url", withGroup(literal)],
    // `\href{url}{text}`: the URL is dropped and the text is the link's, not
    // a case-protecting group.
    [
      "href",
      Parser.orElseSucceed(
        Parser.map(Parser.preceded(groupText, Parser.preceded(blank, groupText)), decode),
        () => "",
      ),
    ],
    ["enquote", withGroup((inner) => `“${decode(inner)}”`)],
    ["mkbibquote", withGroup((inner) => `“${decode(inner)}”`)],
    ...FORMATTING.map(
      ([name, open, close]) =>
        [
          name,
          withGroup((inner) => {
            const decoded = decode(inner);
            return decoded === "" ? "" : `${open}${decoded}${close}`;
          }),
        ] as const,
    ),
    ...Array.from(WORD_ACCENTS, ([name, mark]) => [name, accented(mark)] as const),
  ]);
  const markupCommand = Parser.preceded(
    Token.literal("\\"),
    Parser.alt(
      Parser.dispatch(
        Parser.zipLeft(Token.takeWhile(isLetter, { min: 1 }), blank),
        words,
        droppedCommand,
      ),
      Parser.map(Parser.dispatch(Token.any, controlSymbols), literal),
      Parser.map(Token.any, literal),
      Parser.succeed(""),
    ),
  );
  const group = Parser.map(groupText, (inner) => {
    // A group that opens with a command is a special character (`{\"o}`),
    // not case protection; inside a nocase span, groups add nothing.
    if (inNoCase || inner.trimStart().startsWith("\\")) return decode(inner);
    const decoded = decodeNoCaseMarkup(inner);
    return decoded === "" ? "" : `<span class="nocase">${decoded}</span>`;
  });
  return Parser.alt(
    Parser.map(Token.takeTill("\\{}-~`'$", { min: 1 }), literal),
    markupCommand,
    group,
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
}

/** A decoder over `pieces`, built once. */
const compile = (pieces: Parser.Parser<string>) =>
  Compiler.closure(
    Parser.fold(pieces, {
      init: (): string[] => [],
      f: (all, text) => {
        all.push(text);
        return all;
      },
    }),
  );

/** The two markup decoders (top level, and inside a nocase span), built on first use. */
const markupDecoders = {
  top: Option.none<ReturnType<typeof compile>>(),
  noCase: Option.none<ReturnType<typeof compile>>(),
};

/** Runs a markup decoder, building it on first use (the pieces refer to each other). */
function runMarkup(inNoCase: boolean, source: string): string {
  const key = inNoCase ? "noCase" : "top";
  const markup = Option.getOrElse(markupDecoders[key], () => {
    const built = compile(markupPieces(inNoCase));
    markupDecoders[key] = Option.some(built);
    return built;
  });
  const decoded = Parser.parsePeek(markup, source);
  return Result.isSuccess(decoded) ? decoded.success[1].join("") : literal(source);
}

/** Decodes source inside a `nocase` span. */
const decodeNoCaseMarkup = (source: string): string => runMarkup(true, source);

/**
 * Decodes a LaTeX field value to text with CSL rich-text markup: as
 * {@link decodeLatex}, but `\emph{…}` / `\textit{…}` become `<i>…</i>`,
 * `\textbf{…}` `<b>…</b>`, `\textsc{…}` a small-caps span,
 * `\textsuperscript{…}` / `\textsubscript{…}` `<sup>` / `<sub>`, and a
 * case-protecting group (`{DNA}`, a group that does not open with a command)
 * a `<span class="nocase">`. CSL markup has no escape, so a literal `<` in
 * the source is written as a `nocase` span holding it
 * (`<span class="nocase"><</span>`), which reads back as the `<` it is.
 * Total.
 *
 * @since 1.0.0
 */
export function decodeLatexMarkup(source: string): string {
  return runMarkup(false, source);
}
