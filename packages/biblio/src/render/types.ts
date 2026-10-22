/**
 * The render module's public types — the typed **style** and **locale**
 * inputs, the render context, and the rendered-bibliography output shape.
 *
 * Styles and locales are **typed data inputs**, not fetched at render time.
 * A {@link CitationStyle} is a small typed descriptor — an id, a category, a
 * deterministic reference renderer, and a sort key — and a {@link Locale}
 * is a bag of localisable terms. Both are plain data; the engine
 * (`render.ts`) is a pure function of `(records, style, locale)`.
 *
 * @copyright Thomas Foster
 * @module biblio/render/types
 * @since 0.1.0
 */

// Typed data inputs are website#1072's "no network at render time" acceptance
// criterion.

import type * as Option from "effect/Option";
import type { BiblioRecord } from "../record.ts";
import type { RichText } from "./rich.ts";

/**
 * The kinds of locator a cite can point to (CSL 1.0.2's locator terms).
 *
 * @since 0.1.0
 */
export type LocatorLabel =
  | "act"
  | "appendix"
  | "article-locator"
  | "book"
  | "canon"
  | "chapter"
  | "column"
  | "elocation"
  | "equation"
  | "figure"
  | "folio"
  | "issue"
  | "line"
  | "note"
  | "opus"
  | "page"
  | "paragraph"
  | "part"
  | "rule"
  | "scene"
  | "section"
  | "sub-verbo"
  | "supplement"
  | "table"
  | "timestamp"
  | "title-locator"
  | "verse"
  | "version"
  | "volume";

/**
 * The localisable terms a style draws on. A {@link Locale} is a typed data
 * input — the render engine never fetches one. Only the terms the built-in
 * styles need are modelled; the shape can grow additively.
 *
 * @since 0.1.0
 */
export interface Locale {
  /** BCP-47-ish identifier, e.g. `"en-US"`. */
  readonly id: string;
  /** The word joining the final two names in a list, e.g. `"and"`. */
  readonly and: string;
  /** The "and others" elision, e.g. `"et al."`. */
  readonly etAl: string;
  /** Editor role, singular, e.g. `"Ed."`. */
  readonly editor: string;
  /** Editor role, plural, e.g. `"Eds."`. */
  readonly editors: string;
  /** Edition abbreviation, e.g. `"ed."`. */
  readonly edition: string;
  /** No-date elision, e.g. `"n.d."`. */
  readonly noDate: string;
  /** Single-page abbreviation, e.g. `"p."`. */
  readonly page: string;
  /** Multi-page abbreviation, e.g. `"pp."`. */
  readonly pages: string;
  /** The "in a container" preposition, e.g. `"In"`. */
  readonly in: string;
  /** Online-availability lead-in, e.g. `"Available from:"`. */
  readonly availableFrom: string;
  /** The `[Internet]` medium marker used by numeric medical styles. */
  readonly internet: string;
  /** The repeated-source term for note styles, e.g. `"ibid."` (capitalised at the start of a note). */
  readonly ibid?: string;
  /**
   * Locator labels as `[singular, plural]`, e.g. `chapter: ["chap.", "chaps."]`.
   * A label the locale omits falls back to the US-English term.
   */
  readonly locators?: Readonly<Partial<Record<LocatorLabel, readonly [string, string]>>>;
}

/**
 * The immutable inputs every reference renderer is threaded.
 *
 * @since 0.1.0
 */
export interface RenderContext {
  readonly locale: Locale;
  /**
   * The disambiguating year suffix (`"a"`, `"b"`, …) a citation pass gave
   * this record, rendered after its year (`2004a`). Absent outside
   * `renderCitations`.
   */
  readonly yearSuffix?: string;
}

/**
 * How a style renders in-text citations. Every member is optional; the
 * defaults are APA's for author-date styles, bracketed numbers for numeric
 * styles, and the reference itself (first note) and `Family, Title`
 * (subsequent notes) for note styles.
 *
 * @since 0.1.0
 */
export interface CitationFormat {
  /** With at least this many names, a citation shows the first {@link CitationFormat.etAlUseFirst} and "et al." (default 3). */
  readonly etAlMin?: number;
  /** How many names an elided citation shows (default 1). */
  readonly etAlUseFirst?: number;
  /** The citation's opening affix: `"("` for author-date, `"["` for numeric. */
  readonly open?: string;
  /** The citation's closing affix: `")"` for author-date, `"]"` for numeric. */
  readonly close?: string;
  /** Between cites, or between groups of cites by one author (default `"; "`, numeric `", "`). */
  readonly delimiter?: string;
  /** Joins the last two names in a parenthetical citation (default `"&"`). */
  readonly and?: string;
  /** Omit the `p.` / `pp.` label before a page locator, as Chicago notes do (default false). */
  readonly omitPageLabel?: boolean;
  /** A note style's first-note form of a reference (default: the reference). */
  readonly noteFull?: (record: BiblioRecord, ctx: RenderContext) => RichText;
  /** A note style's short form for later notes (default: `Family, Title`). */
  readonly noteShort?: (record: BiblioRecord, ctx: RenderContext) => RichText;
}

/**
 * A citation style: a typed descriptor the engine interprets. `category`
 * drives list ordering, labelling and in-text citations — `"author-date"`
 * and `"note"` styles sort by {@link CitationStyle.sortKey} and carry no
 * label; `"numeric"` styles keep citation (input) order and are numbered.
 *
 * @since 0.1.0
 */
export interface CitationStyle {
  /** Stable lookup id, e.g. `"apa"`. */
  readonly id: string;
  /** Human-readable name, e.g. `"APA 7th edition"`. */
  readonly title: string;
  /** How the bibliography is ordered and labelled. */
  readonly category: "author-date" | "numeric" | "note";
  /** Renders one record to a formatted reference string (plain text). */
  readonly renderReference: (record: BiblioRecord, ctx: RenderContext) => string;
  /**
   * Renders one record to a formatted reference as rich text. A style without
   * it renders as its {@link CitationStyle.renderReference} text.
   */
  readonly reference?: (record: BiblioRecord, ctx: RenderContext) => RichText;
  /** How the style renders in-text citations; defaults by category. */
  readonly citation?: CitationFormat;
  /**
   * The deterministic sort key for `author-date` ordering (primary-author
   * family, then year, then title). Ignored for `numeric` styles.
   */
  readonly sortKey: (record: BiblioRecord) => string;
}

/**
 * Options for a single-reference or whole-bibliography render.
 *
 * @since 0.1.0
 */
export interface RenderOptions {
  readonly style: CitationStyle;
  /** Defaults to `enLocale` when omitted. */
  readonly locale?: Locale;
}

/**
 * One rendered reference in a bibliography.
 *
 * @since 0.1.0
 */
export interface RenderedEntry {
  /** 1-based position in the rendered (sorted or citation-ordered) list. */
  readonly index: number;
  /**
   * The list label for numeric styles (`"1."`), or `Option.none()` for
   * author-date styles (which are unlabelled).
   */
  readonly label: Option.Option<string>;
  /** The formatted reference, plain text. */
  readonly text: string;
  /** The formatted reference as rich text. */
  readonly rich: RichText;
  /** The record's id, for a bibliography from `renderCitations`. */
  readonly id?: string;
}

/**
 * A fully rendered bibliography — the engine's structured output.
 *
 * @since 0.1.0
 */
export interface RenderedBibliography {
  /** The id of the style used. */
  readonly style: string;
  /** The rendered entries, in display order. */
  readonly entries: readonly RenderedEntry[];
}
