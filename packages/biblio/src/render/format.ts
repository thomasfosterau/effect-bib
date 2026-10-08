/**
 * Shared formatting primitives for the render module.
 *
 * These are the small, style-agnostic building blocks — name lists, given-
 * name initialisation, date-to-year, and punctuation joins — that the
 * built-in styles compose. Keeping them here (parameterised by small option
 * objects) is what lets each style be a thin, low-branch descriptor rather
 * than a bespoke renderer: one name engine, many option sets.
 *
 * Everything is pure plain TypeScript (no Effect runtime): the renderer is a
 * deterministic function of its data inputs.
 *
 * @copyright Thomas Foster
 * @module biblio/render/format
 * @since 0.1.0
 */

// website#1072. The pure, plain-TypeScript posture matches `dedup-match.ts`.

import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as String from "effect/String";
import type { BiblioRecord, CslDate, CslName } from "../record.ts";
import { yearOf } from "../record.ts";
import type { RenderContext } from "./types.ts";
import type { Locale } from "./types.ts";

/**
 * How a given name is reduced to initials.
 *
 * @since 0.1.0
 */
export interface InitialsOptions {
  /** Append a period after each initial (`"J."` vs `"J"`). */
  readonly periods: boolean;
  /** Separate initials with a space (`"J. R."` vs `"J.R."` / `"JR"`). */
  readonly spaced: boolean;
}

/**
 * How a list of names is rendered.
 *
 * @since 0.1.0
 */
export interface NameListOptions {
  /** Initial-reduction rules for the given name. */
  readonly initials: InitialsOptions;
  /**
   * Render family-first (`"Smith, J."` — bibliography lead names) when true,
   * given-first (`"J. Smith"` — APA in-text editor position) when false.
   */
  readonly familyFirst: boolean;
  /** Separator between the family name and the initials (`", "` or `" "`). */
  readonly familyGivenSeparator: string;
  /** Separator between non-final names (`", "`). */
  readonly delimiter: string;
  /** Separator before the final name (`" & "` for APA, `", "` for Vancouver). */
  readonly finalDelimiter: string;
  /** Append a name suffix (`"Jr."`) when present. */
  readonly includeSuffix: boolean;
  /** Above this many names the list is elided with {@link NameListOptions.etAl}. */
  readonly maxNames: number;
  /** How many names to show before the elision. */
  readonly displayBeforeEtAl: number;
  /** The elision text (from the locale, e.g. `"et al."`). */
  readonly etAl: string;
}

/**
 * Drops absent/blank parts and trims the rest.
 *
 * @since 0.1.0
 */
export function compact(parts: readonly Option.Option<string>[]): string[] {
  return Array.filterMap(parts, (part): Result.Result<string, void> => {
    if (Option.isNone(part)) return Result.failVoid;
    const trimmed = part.value.trim();
    return String.isEmpty(trimmed) ? Result.failVoid : Result.succeed(trimmed);
  });
}

/**
 * Joins the non-blank parts with `separator`.
 *
 * @since 0.1.0
 */
export function joinParts(parts: readonly Option.Option<string>[], separator: string): string {
  return compact(parts).join(separator);
}

/**
 * Ensures `text` ends with terminal punctuation (a period is added if absent).
 *
 * @since 0.1.0
 */
export function terminate(text: string): string {
  if (String.isEmpty(text)) return text;
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

/**
 * {@link terminate} an optional field, preserving absence.
 *
 * @since 0.1.0
 */
export function terminatedField(value: Option.Option<string>): Option.Option<string> {
  return Option.map(value, terminate);
}

/**
 * Reduces a given name to initials per {@link InitialsOptions} (hyphens preserved).
 *
 * @since 0.1.0
 */
export function givenInitials(given: string, opts: InitialsOptions): string {
  const initialOf = (token: string): string =>
    token
      .split("-")
      .filter(String.isNonEmpty)
      .map((piece) => piece.charAt(0).toUpperCase() + (opts.periods ? "." : ""))
      .join("-");
  return given
    .split(/\s+/)
    .filter(String.isNonEmpty)
    .map(initialOf)
    .join(opts.spaced ? " " : "");
}

/**
 * The display family name: dropping-particle + non-dropping-particle +
 * family, joined by spaces (a simplified CSL particle rule — particles fold
 * into the family cluster, e.g. `"de Beauvoir"`).
 *
 * @since 0.1.0
 */
export function familyName(name: CslName): string {
  return joinParts(
    [
      Option.fromNullishOr(name["dropping-particle"]),
      Option.fromNullishOr(name["non-dropping-particle"]),
      Option.fromNullishOr(name.family),
    ],
    " ",
  );
}

/**
 * The lowercased sort key for a name — non-dropping-particle + family (the
 * dropping particle is excluded, so `"de Beauvoir"` sorts under `B`), or the
 * literal for organisational names.
 *
 * @since 0.1.0
 */
export function sortFamily(name: CslName): string {
  return joinParts(
    [
      Option.fromNullishOr(name["non-dropping-particle"]),
      Option.fromNullishOr(name.family),
      Option.fromNullishOr(name.literal),
    ],
    " ",
  ).toLowerCase();
}

/** Combines a family cluster and given initials in the configured order. */
function orderName(family: string, initials: string, opts: NameListOptions): string {
  if (String.isEmpty(family) || String.isEmpty(initials))
    return String.isNonEmpty(family) ? family : initials;
  return opts.familyFirst
    ? `${family}${opts.familyGivenSeparator}${initials}`
    : `${initials} ${family}`;
}

/**
 * Renders one name per {@link NameListOptions}.
 *
 * @since 0.1.0
 */
export function formatOneName(name: CslName, opts: NameListOptions): string {
  if (name.literal !== undefined) return name.literal;
  const family = familyName(name);
  const initials = name.given !== undefined ? givenInitials(name.given, opts.initials) : "";
  const base = orderName(family, initials, opts);
  if (opts.includeSuffix && name.suffix !== undefined) return `${base}, ${name.suffix}`;
  return base;
}

/**
 * Renders a list of names, eliding past the style's cap with `et al.`.
 *
 * @since 0.1.0
 */
export function formatNameList(names: readonly CslName[], opts: NameListOptions): string {
  if (Array.isReadonlyArrayEmpty(names)) return "";
  const rendered = names.map((name) => formatOneName(name, opts));
  if (names.length > opts.maxNames) {
    return `${rendered.slice(0, opts.displayBeforeEtAl).join(opts.delimiter)}, ${opts.etAl}`;
  }
  if (rendered.length === 1) return rendered[0];
  const head = rendered.slice(0, -1).join(opts.delimiter);
  return `${head}${opts.finalDelimiter}${rendered[rendered.length - 1]}`;
}

/**
 * The issued date's year as text, or the locale's no-date term.
 *
 * @since 0.1.0
 */
export function issuedYearText(issued: Option.Option<CslDate>, locale: Locale): string {
  // `yearOf` still takes/returns plain values — it is consumed by apps/api.
  const year = yearOf(Option.getOrUndefined(issued));
  return year === null ? locale.noDate : year.toString();
}

/**
 * `p.` for a single page, `pp.` for a range (detected by a hyphen or en dash).
 *
 * @since 0.1.0
 */
export function pagesLabel(page: string, locale: Locale): string {
  return /[-–]/.test(page) ? locale.pages : locale.page;
}

/**
 * The `https://doi.org/` resolver URL for a DOI string.
 *
 * @since 0.1.0
 */
export function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}

/**
 * The record's explicit URL, falling back to a DOI resolver URL, or `None`.
 *
 * @since 0.1.0
 */
export function preferredUrl(
  record: Pick<BiblioRecord, "URL" | "identifiers">,
): Option.Option<string> {
  if (record.URL !== undefined) return Option.some(record.URL);
  if (record.identifiers.doi !== undefined) return Option.some(doiUrl(record.identifiers.doi));
  return Option.none();
}

/**
 * The coarse rendering class a CSL item type maps to. The 45 CSL types
 * collapse to five reference shapes the styles template against, so per-type
 * handling is a lookup, not a growing switch.
 *
 * @since 0.1.0
 */
export type ReferenceClass = "book" | "chapter" | "article" | "webpage" | "generic";

const REFERENCE_CLASS: Readonly<Record<string, ReferenceClass>> = {
  book: "book",
  classic: "book",
  manuscript: "book",
  pamphlet: "book",
  chapter: "chapter",
  entry: "chapter",
  "entry-dictionary": "chapter",
  "entry-encyclopedia": "chapter",
  "article-journal": "article",
  article: "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  "paper-conference": "article",
  review: "article",
  "review-book": "article",
  periodical: "article",
  webpage: "webpage",
  post: "webpage",
  "post-weblog": "webpage",
  dataset: "webpage",
  software: "webpage",
};

/**
 * Maps a CSL item type to its {@link ReferenceClass} (`"generic"` fallback).
 *
 * @since 0.1.0
 */
export function referenceClass(type: string): ReferenceClass {
  return REFERENCE_CLASS[type] ?? "generic";
}

/**
 * Renders one record's reference body (post-head) for a given style.
 *
 * @since 0.1.0
 */
export type BodyRenderer = (record: BiblioRecord, ctx: RenderContext) => string;

/**
 * The per-{@link ReferenceClass} body renderers a style dispatches over.
 *
 * @since 0.1.0
 */
export type BodyRenderers = Readonly<Record<ReferenceClass, BodyRenderer>>;

/**
 * Assembles a style's `renderReference` from its `head` and per-class
 * `bodies`: dispatch on the record's reference class, then join the head and
 * body. Shared so each style stays a set of body renderers, not boilerplate.
 *
 * @since 0.1.0
 */
export function dispatchReference(head: BodyRenderer, bodies: BodyRenderers): BodyRenderer {
  return (record, ctx) =>
    joinParts(
      [
        Option.some(head(record, ctx)),
        Option.some(bodies[referenceClass(record.type)](record, ctx)),
      ],
      " ",
    );
}
