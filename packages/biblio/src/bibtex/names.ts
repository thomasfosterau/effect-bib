/**
 * BibTeX name lists: `and`-separated names in the three BibTeX forms
 * (`First von Last`, `von Last, First`, `von Last, Jr, First`), a whole-name
 * brace group (`{World Health Organization}`) as a CSL `literal`, braces
 * protecting an `and` or a comma, and a trailing `and others` as an et al.
 * marker rather than a person called "others".
 *
 * @copyright Thomas Foster
 * @module biblio/bibtex/names
 * @since 0.1.0
 */

import { Compiler, Parser, Token } from "@thomasfosterau/effect-parse";
import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { type CslName, MAX_AUTHORS, readCslName } from "../record.ts";
import { decodeLatex } from "./latex.ts";
import { braced } from "./scan.ts";

/**
 * A parsed BibTeX name list: the structured names, and whether the list
 * ended in `and others`.
 *
 * @since 0.1.0
 */
export interface BibtexNameList {
  readonly names: readonly CslName[];
  readonly others: boolean;
}

/** Name-separating whitespace (a tie, `~`, separates words too). */
const blank = Token.takeWhile(" \t\r\n~");

/** One word of a name list: text, brace groups and stray braces, up to a blank or a comma. */
const word = Parser.taken(
  Parser.repeat(
    Parser.alt(Token.takeTill(" \t\r\n~{},", { min: 1 }), braced, Parser.asVoid(Token.oneOf("{}"))),
    { min: 1 },
  ),
);

/** A name list's tokens: its words and its top-level commas, in order. */
const tokens = Compiler.closure(
  Parser.fold(Parser.preceded(blank, Parser.alt(Token.literal(","), word)), {
    init: (): string[] => [],
    f: (all, token) => {
      all.push(token);
      return all;
    },
  }),
);

/** Splits a token list at every token `isSeparator` accepts. */
function splitOn(list: readonly string[], isSeparator: (token: string) => boolean): string[][] {
  const start: string[][] = [[]];
  return Array.reduce(list, start, (groups, token) => {
    if (isSeparator(token)) groups.push([]);
    else groups[groups.length - 1].push(token);
    return groups;
  });
}

/** A whole word that is one brace group (`{World Health Organization}`). */
const wholeGroup = Compiler.closure(Parser.allConsuming(braced));

/** True when a word is a single brace group that is not a special character (`{\"o}`). */
function isProtectedWord(token: string): boolean {
  return !token.startsWith("{\\") && Result.isSuccess(Parser.parse(wholeGroup, token));
}

/**
 * True when a word begins in lower case (a `von` word). A word that opens
 * with a plain brace group is caseless, as in BibTeX; a special character
 * (`{\'e}`) counts by its letter.
 */
function isLowerWord(token: string): boolean {
  if (token.startsWith("{") && !token.startsWith("{\\")) return false;
  const letter = /\p{L}/u.exec(decodeLatex(token));
  return letter !== null && letter[0] !== letter[0].toUpperCase();
}

/** Decodes words to one space-joined text. */
const text = (words: readonly string[]): string => decodeLatex(words.join(" "));

/** The parts of one name before they are decoded. */
interface NameParts {
  readonly first: readonly string[];
  readonly von: readonly string[];
  readonly last: readonly string[];
  readonly jr: readonly string[];
}

/** Splits `von Last` (the words before a comma): `von` runs to the last lower-case word that leaves a `Last`. */
function splitVonLast(words: readonly string[]): Pick<NameParts, "von" | "last"> {
  const lastVon = Array.findLastIndex(words.slice(0, -1), isLowerWord);
  return Option.isSome(lastVon)
    ? { von: words.slice(0, lastVon.value + 1), last: words.slice(lastVon.value + 1) }
    : { von: [], last: words };
}

/** Splits `First von Last` (no comma). */
function splitFirstVonLast(words: readonly string[]): NameParts {
  const head = words.slice(0, -1);
  const firstVon = Array.findFirstIndex(head, isLowerWord);
  if (Option.isNone(firstVon)) {
    return { first: head, von: [], last: words.slice(-1), jr: [] };
  }
  const rest = splitVonLast(words.slice(firstVon.value));
  return { first: words.slice(0, firstVon.value), ...rest, jr: [] };
}

/** Splits one name's tokens into its parts by its comma form. */
function nameParts(nameTokens: readonly string[]): NameParts {
  const parts = splitOn(nameTokens, (token) => token === ",");
  if (parts.length === 1) return splitFirstVonLast(parts[0]);
  const vonLast = splitVonLast(parts[0]);
  if (parts.length === 2) return { ...vonLast, first: parts[1], jr: [] };
  return { ...vonLast, jr: parts[1], first: parts.slice(2).flat() };
}

/** A `key=value` part of a BibLaTeX extended name (`family=Rabble`). */
const EXTENDED_PART = /^([A-Za-z][A-Za-z-]*)=([\s\S]*)$/;

/** True when a name is written in BibLaTeX's extended format: its first word is `key=value`. */
const isExtended = (nameTokens: readonly string[]): boolean =>
  Option.exists(Array.head(nameTokens), (first) => EXTENDED_PART.test(first));

/** True for a BibLaTeX boolean option value that is on (`true`, or the bare key). */
const isOn = (value: string): boolean => {
  const normalised = value.trim().toLowerCase();
  return normalised === "" || normalised === "true";
};

/**
 * Structures a name in BibLaTeX's extended format (biber's
 * `\DeclareNameFormat` keys): comma-separated `family=`, `given=`,
 * `prefix=` and `suffix=` parts, braces protecting a value, and a per-name
 * `useprefix` that overrides the field's. Unknown keys (`given-i`, …) are
 * ignored.
 */
function parseExtendedName(
  nameTokens: readonly string[],
  usePrefix: boolean,
): Option.Option<CslName> {
  const parts = Array.filterMap(
    splitOn(nameTokens, (token) => token === ","),
    (words): Result.Result<readonly [string, string], void> => {
      const match = EXTENDED_PART.exec(words.join(" "));
      return match === null
        ? Result.failVoid
        : Result.succeed([(match[1] ?? "").toLowerCase(), match[2] ?? ""] as const);
    },
  );
  const value = (key: string): string =>
    Option.match(
      Array.findLast(parts, ([name]) => name === key),
      { onNone: () => "", onSome: ([, raw]) => text([raw.trim()]) },
    );
  const prefixed = Option.match(
    Array.findLast(parts, ([name]) => name === "useprefix"),
    { onNone: () => usePrefix, onSome: ([, raw]) => isOn(raw) },
  );
  return readCslName({
    family: value("family"),
    given: value("given"),
    suffix: value("suffix"),
    [prefixed ? "non-dropping-particle" : "dropping-particle"]: value("prefix"),
  });
}

/**
 * A family name that opens with a braced particle ending in a hyphen or an
 * apostrophe (`{al-}Hasan`, `{d'}Alembert`), as biber and Pandoc read it:
 * the particle, non-dropping, and the rest of the family name.
 */
const BRACED_PARTICLE = /^\{([^{}]*[-'’])\}(\S[\s\S]*)$/;

/**
 * Structures one name. The `von` part is CSL's dropping particle (BibLaTeX's
 * default, `useprefix=false`), or its non-dropping particle under
 * `useprefix=true`.
 */
function parseName(nameTokens: readonly string[], usePrefix: boolean): Option.Option<CslName> {
  if (nameTokens.length === 1 && isProtectedWord(nameTokens[0])) {
    return readCslName({ literal: text(nameTokens) });
  }
  if (isExtended(nameTokens)) return parseExtendedName(nameTokens, usePrefix);
  const parts = nameParts(nameTokens);
  const particle = text(parts.von);
  const bracedParticle = Option.flatMap(Array.head(parts.last), (first) =>
    Option.fromNullishOr(BRACED_PARTICLE.exec(first)),
  );
  if (Option.isSome(bracedParticle) && particle === "") {
    return readCslName({
      family: text([bracedParticle.value[2] ?? "", ...parts.last.slice(1)]),
      given: text(parts.first),
      suffix: text(parts.jr),
      "non-dropping-particle": text([bracedParticle.value[1] ?? ""]),
    });
  }
  return readCslName({
    family: text(parts.last),
    given: text(parts.first),
    suffix: text(parts.jr),
    [usePrefix ? "non-dropping-particle" : "dropping-particle"]: particle,
  });
}

/**
 * Parses a BibTeX name list into structured names, bounded to `maxNames`
 * (default `MAX_AUTHORS`); a name that is `others` (any case) sets the et
 * al. flag instead of becoming a name.
 *
 * @since 0.1.0
 */
export function parseBibtexNames(
  source: string,
  usePrefix: boolean,
  maxNames: number = MAX_AUTHORS,
): BibtexNameList {
  const scanned = Parser.parsePeek(tokens, source);
  const all = Result.isSuccess(scanned) ? scanned.success[1] : [];
  const groups = splitOn(all, (token) => token.toLowerCase() === "and").filter(
    Array.isReadonlyArrayNonEmpty,
  );
  const others = groups.some((group) => group.length === 1 && group[0].toLowerCase() === "others");
  const names = Array.filterMap(groups, (group): Result.Result<CslName, void> => {
    if (group.length === 1 && group[0].toLowerCase() === "others") return Result.failVoid;
    return Result.fromOption(parseName(group, usePrefix), () => undefined);
  }).slice(0, maxNames);
  return { names, others };
}
