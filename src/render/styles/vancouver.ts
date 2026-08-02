/**
 * @copyright Thomas Foster
 *
 * The Vancouver style — a numeric reference format (biblio B5, issue #1072).
 *
 * A deliberate contrast to APA: numbered (citation-order) entries rather
 * than author-date, initials-without-periods names (`"Smith JR"`), and a
 * different punctuation and field order (`"Journal. Year;Vol(Issue):Pages."`).
 * Rendering the same records in two structurally different styles is what the
 * B5 acceptance criteria exercise.
 *
 * Like the APA style, this is a **scoped subset** of ICMJE/Vancouver — the
 * five reference shapes the site renders — not a full CSL implementation. The
 * editor-role terms (`"editor"` / `"editors"`) are the style's own English
 * labels rather than locale terms, since they differ from APA's `"Ed."`.
 *
 * @module biblio/render/styles/vancouver
 */

import type { BiblioRecord } from "../../record.ts";
import {
  dispatchReference,
  formatNameList,
  issuedYearText,
  joinParts,
  type NameListOptions,
  terminate,
  terminatedField,
} from "../format.ts";
import type { CitationStyle, RenderContext } from "../types.ts";

/** The editor role labels (style-local; distinct from APA's `"Ed."`). */
const EDITOR = "editor";
const EDITORS = "editors";

/** Author-list options: family-first, period-less initials, six then `et al.`. */
function authorNames(ctx: RenderContext): NameListOptions {
  return {
    initials: { periods: false, spaced: false },
    familyFirst: true,
    familyGivenSeparator: " ",
    delimiter: ", ",
    finalDelimiter: ", ",
    includeSuffix: false,
    maxNames: 6,
    displayBeforeEtAl: 6,
    etAl: ctx.locale.etAl,
  };
}

/** `"Smith JR, Doe AB."` — the author head, or `""` when unauthored. */
function head(record: BiblioRecord, ctx: RenderContext): string {
  const names = formatNameList(record.author ?? [], authorNames(ctx));
  return names.length > 0 ? terminate(names) : "";
}

/** `"2nd ed."` when an edition is present, else `null`. */
function editionSegment(record: BiblioRecord, ctx: RenderContext): string | null {
  return record.edition !== undefined ? `${record.edition} ${ctx.locale.edition}` : null;
}

/** `"London: Penguin; 2020"` — place/publisher/year imprint tail. */
function imprint(record: BiblioRecord, ctx: RenderContext): string {
  const place = joinParts([record["publisher-place"], record.publisher], ": ");
  return joinParts([place, issuedYearText(record.issued, ctx.locale)], "; ");
}

function book(record: BiblioRecord, ctx: RenderContext): string {
  return joinParts(
    [
      terminatedField(record.title),
      terminateOrNull(editionSegment(record, ctx)),
      terminate(imprint(record, ctx)),
    ],
    " ",
  );
}

function chapter(record: BiblioRecord, ctx: RenderContext): string {
  const editors = formatNameList(record.editor ?? [], authorNames(ctx));
  const label = (record.editor?.length ?? 0) > 1 ? EDITORS : EDITOR;
  const inClause = editors.length > 0 ? `${ctx.locale.in}: ${editors}, ${label}.` : null;
  const pages = record.page !== undefined ? `${ctx.locale.page} ${record.page}` : null;
  return joinParts(
    [
      terminatedField(record.title),
      inClause,
      terminatedField(record["container-title"]),
      terminate(imprint(record, ctx)),
      terminateOrNull(pages),
    ],
    " ",
  );
}

function article(record: BiblioRecord, ctx: RenderContext): string {
  const volIssue =
    record.volume !== undefined
      ? `${record.volume}${record.issue !== undefined ? `(${record.issue})` : ""}`
      : "";
  const page = record.page !== undefined ? `:${record.page}` : "";
  const detail = `${issuedYearText(record.issued, ctx.locale)}${volIssue.length > 0 ? `;${volIssue}` : ""}${page}`;
  return joinParts(
    [terminatedField(record.title), terminatedField(record["container-title"]), terminate(detail)],
    " ",
  );
}

function webpage(record: BiblioRecord, ctx: RenderContext): string {
  const titleInternet =
    record.title !== undefined ? `${record.title} [${ctx.locale.internet}]` : null;
  const available = record.URL !== undefined ? `${ctx.locale.availableFrom} ${record.URL}` : null;
  return joinParts(
    [
      terminateOrNull(titleInternet),
      terminatedField(record["container-title"]),
      terminate(issuedYearText(record.issued, ctx.locale)),
      available,
    ],
    " ",
  );
}

function generic(record: BiblioRecord, ctx: RenderContext): string {
  return joinParts(
    [
      terminatedField(record.title),
      terminatedField(record["container-title"]),
      terminatedField(record.publisher),
      terminate(issuedYearText(record.issued, ctx.locale)),
    ],
    " ",
  );
}

/** `terminate`, but preserves `null` (for computed optional segments). */
function terminateOrNull(text: string | null): string | null {
  return text === null ? null : terminate(text);
}

const renderReference = dispatchReference(head, {
  book,
  chapter,
  article,
  webpage,
  generic,
});

/** Numeric styles keep citation order; the sort key is unused. */
function sortKey(): string {
  return "";
}

/** The Vancouver (numeric) citation style. */
export const vancouverStyle: CitationStyle = {
  id: "vancouver",
  title: "Vancouver",
  category: "numeric",
  renderReference,
  sortKey,
};
