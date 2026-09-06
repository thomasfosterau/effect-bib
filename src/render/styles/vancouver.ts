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

import * as Option from "effect/Option";
import * as String from "effect/String";
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
  return String.isNonEmpty(names) ? terminate(names) : "";
}

/** `"2nd ed."` when an edition is present, else `None`. */
function editionSegment(record: BiblioRecord, ctx: RenderContext): Option.Option<string> {
  return record.edition !== undefined
    ? Option.some(`${record.edition} ${ctx.locale.edition}`)
    : Option.none();
}

/** `"London: Penguin; 2020"` — place/publisher/year imprint tail. */
function imprint(record: BiblioRecord, ctx: RenderContext): string {
  const place = joinParts(
    [Option.fromNullishOr(record["publisher-place"]), Option.fromNullishOr(record.publisher)],
    ": ",
  );
  return joinParts(
    [
      Option.some(place),
      Option.some(issuedYearText(Option.fromNullishOr(record.issued), ctx.locale)),
    ],
    "; ",
  );
}

function book(record: BiblioRecord, ctx: RenderContext): string {
  return joinParts(
    [
      terminatedField(Option.fromNullishOr(record.title)),
      terminatedField(editionSegment(record, ctx)),
      Option.some(terminate(imprint(record, ctx))),
    ],
    " ",
  );
}

function chapter(record: BiblioRecord, ctx: RenderContext): string {
  const editors = formatNameList(record.editor ?? [], authorNames(ctx));
  const label = (record.editor?.length ?? 0) > 1 ? EDITORS : EDITOR;
  const inClause = String.isNonEmpty(editors)
    ? Option.some(`${ctx.locale.in}: ${editors}, ${label}.`)
    : Option.none<string>();
  const pages =
    record.page !== undefined
      ? Option.some(`${ctx.locale.page} ${record.page}`)
      : Option.none<string>();
  return joinParts(
    [
      terminatedField(Option.fromNullishOr(record.title)),
      inClause,
      terminatedField(Option.fromNullishOr(record["container-title"])),
      Option.some(terminate(imprint(record, ctx))),
      terminatedField(pages),
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
  const detail = `${issuedYearText(Option.fromNullishOr(record.issued), ctx.locale)}${String.isNonEmpty(volIssue) ? `;${volIssue}` : ""}${page}`;
  return joinParts(
    [
      terminatedField(Option.fromNullishOr(record.title)),
      terminatedField(Option.fromNullishOr(record["container-title"])),
      Option.some(terminate(detail)),
    ],
    " ",
  );
}

function webpage(record: BiblioRecord, ctx: RenderContext): string {
  const titleInternet =
    record.title !== undefined
      ? Option.some(`${record.title} [${ctx.locale.internet}]`)
      : Option.none<string>();
  const available =
    record.URL !== undefined
      ? Option.some(`${ctx.locale.availableFrom} ${record.URL}`)
      : Option.none<string>();
  return joinParts(
    [
      terminatedField(titleInternet),
      terminatedField(Option.fromNullishOr(record["container-title"])),
      Option.some(terminate(issuedYearText(Option.fromNullishOr(record.issued), ctx.locale))),
      available,
    ],
    " ",
  );
}

function generic(record: BiblioRecord, ctx: RenderContext): string {
  return joinParts(
    [
      terminatedField(Option.fromNullishOr(record.title)),
      terminatedField(Option.fromNullishOr(record["container-title"])),
      terminatedField(Option.fromNullishOr(record.publisher)),
      Option.some(terminate(issuedYearText(Option.fromNullishOr(record.issued), ctx.locale))),
    ],
    " ",
  );
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
