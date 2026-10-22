/**
 * The render engine.
 *
 * Pure functions from `(records, style, locale)` to formatted strings. The
 * whole surface is deterministic and network-free: styles and locales are
 * typed **data inputs**, sorting uses a stable code-unit comparison (not the
 * environment-dependent `localeCompare`), so the same records + style always
 * yield the same output.
 *
 * Ordering follows the style category: `author-date` styles sort by the
 * style's {@link CitationStyle.sortKey}; `numeric` styles preserve citation
 * (input) order and carry a `"1."`-style label.
 *
 * @copyright Thomas Foster
 * @module biblio/render/render
 * @since 0.1.0
 */

// website#1072. That determinism is the property the snapshot fixtures pin.

import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import type { BiblioRecord } from "../record.ts";
import { enLocale } from "./locale.ts";
import type {
  CitationStyle,
  RenderContext,
  RenderedBibliography,
  RenderedEntry,
  RenderOptions,
} from "./types.ts";

/** Fills in the default locale when the caller omits one. */
function resolveContext(options: RenderOptions): RenderContext {
  return { locale: options.locale ?? enLocale };
}

/**
 * The records in display order: sorted by sort key for `author-date` styles,
 * left in citation order for `numeric`. `Array.sortWith` delegates to
 * `Array.prototype.sort`, which is stable, so sort-key ties keep input order.
 */
function orderRecords(
  records: readonly BiblioRecord[],
  style: CitationStyle,
): readonly BiblioRecord[] {
  if (style.category === "numeric") return records;
  return Array.sortWith(records, style.sortKey, Order.String);
}

/**
 * Renders a single record to a formatted reference string.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { apaStyle, fromCslJson, renderReference, vancouverStyle } from "@thomasfosterau/biblio"
 *
 * const article = fromCslJson({
 *   type: "article-journal",
 *   title: "Can loneliness be lethal?",
 *   author: [{ family: "Ray", given: "Oakley" }],
 *   "container-title": "Nature",
 *   volume: "431",
 *   page: "231-232",
 *   issued: { "date-parts": [[2004]] },
 *   DOI: "10.1038/431231a",
 * })
 *
 * assert.strictEqual(
 *   renderReference(article, { style: apaStyle }),
 *   "Ray, O. (2004). Can loneliness be lethal? Nature, 431, 231-232. https://doi.org/10.1038/431231a",
 * )
 * assert.strictEqual(
 *   renderReference(article, { style: vancouverStyle }),
 *   "Ray O. Can loneliness be lethal? Nature. 2004;431:231-232.",
 * )
 * ```
 *
 * @since 0.1.0
 */
export function renderReference(record: BiblioRecord, options: RenderOptions): string {
  return options.style.renderReference(record, resolveContext(options));
}

/**
 * Renders a bibliography of records to structured {@link RenderedEntry}s in
 * display order — sorted for author-date styles, numbered for numeric.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { apaStyle, bibliographyToText, fromCslJson, renderBibliography, vancouverStyle } from "@thomasfosterau/biblio"
 *
 * const book = fromCslJson({ type: "book", title: "Sapiens", publisher: "Harper", author: [{ family: "Harari", given: "Yuval Noah" }], issued: { "date-parts": [[2015]] } })
 * const article = fromCslJson({ type: "article-journal", title: "Can loneliness be lethal?", author: [{ family: "Ray", given: "Oakley" }], "container-title": "Nature", volume: "431", page: "231-232", issued: { "date-parts": [[2004]] } })
 *
 * // Author-date styles sort by author / year / title and carry no label.
 * assert.strictEqual(
 *   bibliographyToText(renderBibliography([article, book], { style: apaStyle })),
 *   "Harari, Y. N. (2015). Sapiens. Harper.\nRay, O. (2004). Can loneliness be lethal? Nature, 431, 231-232.",
 * )
 *
 * // Numeric styles keep citation order and number each entry.
 * assert.strictEqual(
 *   bibliographyToText(renderBibliography([article, book], { style: vancouverStyle })),
 *   "1. Ray O. Can loneliness be lethal? Nature. 2004;431:231-232.\n2. Harari YN. Sapiens. Harper; 2015.",
 * )
 * ```
 *
 * @since 0.1.0
 */
export function renderBibliography(
  records: readonly BiblioRecord[],
  options: RenderOptions,
): RenderedBibliography {
  const ctx = resolveContext(options);
  const { style } = options;
  const ordered = orderRecords(records, style);
  const entries: RenderedEntry[] = ordered.map((record, i) => ({
    index: i + 1,
    label: style.category === "numeric" ? Option.some(`${i + 1}.`) : Option.none(),
    text: style.renderReference(record, ctx),
  }));
  return { style: style.id, entries };
}

/**
 * Flattens a {@link RenderedBibliography} to a display string — one entry per
 * line, numeric labels prefixed. Handy for plain-text export and snapshots.
 *
 * @since 0.1.0
 */
export function bibliographyToText(bibliography: RenderedBibliography): string {
  return bibliography.entries
    .map((entry) =>
      Option.isSome(entry.label) ? `${entry.label.value} ${entry.text}` : entry.text,
    )
    .join("\n");
}
