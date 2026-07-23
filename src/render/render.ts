/**
 * @copyright Thomas Foster
 *
 * The render engine (biblio B5, issue #1072).
 *
 * Pure functions from `(records, style, locale)` to formatted strings. The
 * whole surface is deterministic and network-free: styles and locales are
 * typed **data inputs**, sorting uses a stable code-unit comparison (not the
 * environment-dependent `localeCompare`), so the same records + style always
 * yield the same output — the property the snapshot fixtures pin.
 *
 * Ordering follows the style category: `author-date` styles sort by the
 * style's {@link CitationStyle.sortKey}; `numeric` styles preserve citation
 * (input) order and carry a `"1."`-style label.
 *
 * @module biblio/render/render
 */

import type { BiblioRecord } from "../record";
import { enLocale } from "./locale";
import type {
  CitationStyle,
  RenderContext,
  RenderedBibliography,
  RenderedEntry,
  RenderOptions,
} from "./types";

/** Fills in the default locale when the caller omits one. */
function resolveContext(options: RenderOptions): RenderContext {
  return { locale: options.locale ?? enLocale };
}

/** Deterministic code-unit string comparison (no locale dependence). */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The records in display order: sorted by sort key for `author-date` styles,
 * left in citation order for `numeric`. `Array.prototype.sort` is stable, so
 * sort-key ties keep input order.
 */
function orderRecords(
  records: readonly BiblioRecord[],
  style: CitationStyle,
): readonly BiblioRecord[] {
  if (style.category === "numeric") return records;
  return [...records].sort((a, b) => compareStrings(style.sortKey(a), style.sortKey(b)));
}

/** Renders a single record to a formatted reference string. */
export function renderReference(record: BiblioRecord, options: RenderOptions): string {
  return options.style.renderReference(record, resolveContext(options));
}

/**
 * Renders a bibliography of records to structured {@link RenderedEntry}s in
 * display order — sorted for author-date styles, numbered for numeric.
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
    label: style.category === "numeric" ? `${i + 1}.` : null,
    text: style.renderReference(record, ctx),
  }));
  return { style: style.id, entries };
}

/**
 * Flattens a {@link RenderedBibliography} to a display string — one entry per
 * line, numeric labels prefixed. Handy for plain-text export and snapshots.
 */
export function bibliographyToText(bibliography: RenderedBibliography): string {
  return bibliography.entries
    .map((entry) => (entry.label !== null ? `${entry.label} ${entry.text}` : entry.text))
    .join("\n");
}
