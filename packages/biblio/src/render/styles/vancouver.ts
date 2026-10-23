/**
 * The Vancouver style — a numeric reference format.
 *
 * A deliberate contrast to APA: numbered (citation-order) entries rather
 * than author-date, initials-without-periods names (`"Smith JR"`), and a
 * different punctuation and field order (`"Journal. Year;Vol(Issue):Pages."`).
 *
 * Like the APA style, this is a **scoped subset** of ICMJE/Vancouver — the
 * five reference shapes the engine classifies — not a full CSL implementation. The
 * editor-role terms (`"editor"` / `"editors"`) are the style's own English
 * labels rather than locale terms, since they differ from APA's `"Ed."`.
 *
 * Output is rich text, as APA's is: a title's CSL markup (a chemical
 * formula's `<sub>`, an exponent's `<sup>`, a species name's `<i>`) reaches
 * the HTML and Markdown output, and the plain-text output is unchanged.
 *
 * @copyright Thomas Foster
 * @module biblio/render/styles/vancouver
 * @since 0.1.0
 */

// website#1072. Rendering the same records in two structurally different styles
// is what the golden tests exercise.

import * as Option from "effect/Option";
import * as String from "effect/String";
import type { BiblioRecord } from "../../record.ts";
import {
  dispatchRich,
  formatNameList,
  issuedYearText,
  type NameListOptions,
  richField,
  terminate,
} from "../format.ts";
import { concat, joinRich, type RichText, terminateRich, text, toPlainText } from "../rich.ts";
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

/** `"Smith JR, Doe AB."` — the author head, or empty when unauthored. */
function head(record: BiblioRecord, ctx: RenderContext): RichText {
  const names = formatNameList(record.author ?? [], authorNames(ctx));
  return text(String.isNonEmpty(names) ? terminate(names) : "");
}

/** A field followed by a period, when present. */
const terminated = (value: Option.Option<RichText>): Option.Option<RichText> =>
  Option.map(value, terminateRich);

/** Plain text as an always-present part. */
const part = (value: string): Option.Option<RichText> => Option.some(text(value));

/** `"2nd ed."` when an edition is present, else `None`. */
function editionSegment(record: BiblioRecord, ctx: RenderContext): Option.Option<RichText> {
  return record.edition !== undefined
    ? Option.some(text(`${record.edition} ${ctx.locale.edition}`))
    : Option.none();
}

/** The issued year (or the no-date term). */
const year = (record: BiblioRecord, ctx: RenderContext): string =>
  issuedYearText(Option.fromNullishOr(record.issued), ctx.locale);

/** `"London: Penguin; 2020"` — place/publisher/year imprint tail. */
function imprint(record: BiblioRecord, ctx: RenderContext): RichText {
  const place = joinRich(
    [richField(record, "publisher-place"), richField(record, "publisher")],
    ": ",
  );
  return joinRich([Option.some(place), part(year(record, ctx))], "; ");
}

function book(record: BiblioRecord, ctx: RenderContext): RichText {
  return joinRich(
    [
      terminated(richField(record, "title")),
      terminated(editionSegment(record, ctx)),
      Option.some(terminateRich(imprint(record, ctx))),
    ],
    " ",
  );
}

function chapter(record: BiblioRecord, ctx: RenderContext): RichText {
  const editors = formatNameList(record.editor ?? [], authorNames(ctx));
  const label = (record.editor?.length ?? 0) > 1 ? EDITORS : EDITOR;
  const inClause = String.isNonEmpty(editors)
    ? part(`${ctx.locale.in}: ${editors}, ${label}.`)
    : Option.none<RichText>();
  const pages =
    record.page !== undefined ? part(`${ctx.locale.page} ${record.page}`) : Option.none<RichText>();
  return joinRich(
    [
      terminated(richField(record, "title")),
      inClause,
      terminated(richField(record, "container-title")),
      Option.some(terminateRich(imprint(record, ctx))),
      terminated(pages),
    ],
    " ",
  );
}

function article(record: BiblioRecord, ctx: RenderContext): RichText {
  const volIssue =
    record.volume !== undefined
      ? `${record.volume}${record.issue !== undefined ? `(${record.issue})` : ""}`
      : "";
  const page = record.page !== undefined ? `:${record.page}` : "";
  const detail = `${year(record, ctx)}${String.isNonEmpty(volIssue) ? `;${volIssue}` : ""}${page}`;
  return joinRich(
    [
      terminated(richField(record, "title")),
      terminated(richField(record, "container-title")),
      part(terminate(detail)),
    ],
    " ",
  );
}

function webpage(record: BiblioRecord, ctx: RenderContext): RichText {
  const titleInternet = Option.map(richField(record, "title"), (title) =>
    concat(title, text(` [${ctx.locale.internet}]`)),
  );
  const available =
    record.URL !== undefined
      ? part(`${ctx.locale.availableFrom} ${record.URL}`)
      : Option.none<RichText>();
  return joinRich(
    [
      terminated(titleInternet),
      terminated(richField(record, "container-title")),
      part(terminate(year(record, ctx))),
      available,
    ],
    " ",
  );
}

function generic(record: BiblioRecord, ctx: RenderContext): RichText {
  return joinRich(
    [
      terminated(richField(record, "title")),
      terminated(richField(record, "container-title")),
      terminated(richField(record, "publisher")),
      part(terminate(year(record, ctx))),
    ],
    " ",
  );
}

const reference = dispatchRich(head, {
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

/**
 * The Vancouver (numeric) citation style.
 *
 * @since 0.1.0
 */
export const vancouverStyle: CitationStyle = {
  id: "vancouver",
  title: "Vancouver",
  category: "numeric",
  renderReference: (record, ctx) => toPlainText(reference(record, ctx)),
  reference,
  sortKey,
};
