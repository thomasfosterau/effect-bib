/**
 * @copyright Thomas Foster
 *
 * The render module's public types — the typed **style** and **locale**
 * inputs, the render context, and the rendered-bibliography output shape
 * (biblio B5, issue #1072).
 *
 * Styles and locales are **typed data inputs**, not fetched at render time
 * (the "no network at render time" acceptance criterion). A
 * {@link CitationStyle} is a small typed descriptor — an id, a category, a
 * deterministic reference renderer, and a sort key — and a {@link Locale}
 * is a bag of localisable terms. Both are plain data; the engine
 * (`render.ts`) is a pure function of `(records, style, locale)`.
 *
 * @module biblio/render/types
 * @since 0.1.0
 */

import type * as Option from "effect/Option";
import type { BiblioRecord } from "../record.ts";

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
}

/**
 * The immutable inputs every reference renderer is threaded.
 *
 * @since 0.1.0
 */
export interface RenderContext {
  readonly locale: Locale;
}

/**
 * A citation style: a typed descriptor the engine interprets. `category`
 * drives list ordering and labelling — `"author-date"` styles sort by
 * {@link CitationStyle.sortKey} and carry no label; `"numeric"` styles keep
 * citation (input) order and are numbered.
 *
 * @since 0.1.0
 */
export interface CitationStyle {
  /** Stable lookup id, e.g. `"apa"`. */
  readonly id: string;
  /** Human-readable name, e.g. `"APA 7th edition"`. */
  readonly title: string;
  /** How the bibliography is ordered and labelled. */
  readonly category: "author-date" | "numeric";
  /** Renders one record to a formatted reference string (plain text). */
  readonly renderReference: (record: BiblioRecord, ctx: RenderContext) => string;
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
  /** Defaults to {@link module:biblio/render/locale.enLocale} when omitted. */
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
