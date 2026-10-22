/**
 * The APA 7th-edition style — an author-date reference format.
 *
 * A {@link CitationStyle} descriptor: it dispatches per {@link referenceClass}
 * through a lookup map of small, low-branch body renderers, each composing
 * the shared `format.ts` primitives. Output is rich text (titles of whole
 * works, journals and volumes in italics, the DOI or URL as a link), with a
 * plain-text projection; deterministic and network-free.
 *
 * This is a **scoped subset** of APA, not a full CSL implementation: it
 * covers the five reference shapes the engine classifies (book, chapter, journal
 * article, webpage, and a generic fallback). Known simplifications — no
 * author moves the title to the author slot only loosely; the >20-author
 * elision is "first 19 … et al." rather than APA's "first 19 … final" — are
 * documented at their call sites.
 *
 * @copyright Thomas Foster
 * @module biblio/render/styles/apa
 * @since 0.1.0
 */

// See website#1072.

import * as Option from "effect/Option";
import * as String from "effect/String";
import type { BiblioRecord } from "../../record.ts";
import {
  dispatchRich,
  formatNameList,
  issuedYearWithSuffix,
  type NameListOptions,
  pagesLabel,
  preferredUrl,
  richField,
  type TextVariable,
  sortFamily,
  terminate,
} from "../format.ts";
import {
  concat,
  italic,
  joinRich,
  link,
  type RichText,
  terminateRich,
  text,
  toPlainText,
} from "../rich.ts";
import type { CitationStyle, RenderContext } from "../types.ts";

/** Author-list options: family-first, spaced periods, `", & "` before the last. */
function authorNames(ctx: RenderContext): NameListOptions {
  return {
    initials: { periods: true, spaced: true },
    familyFirst: true,
    familyGivenSeparator: ", ",
    delimiter: ", ",
    finalDelimiter: ", & ",
    includeSuffix: true,
    maxNames: 20,
    displayBeforeEtAl: 19,
    etAl: ctx.locale.etAl,
  };
}

/** Editor-list options for the in-container position: given-first, no suffix. */
function editorNames(ctx: RenderContext): NameListOptions {
  return { ...authorNames(ctx), familyFirst: false, includeSuffix: false };
}

/** `"Author, A. A. (2020)."` — the author + year head shared by every class. */
function head(record: BiblioRecord, ctx: RenderContext): RichText {
  const names = formatNameList(record.author ?? [], authorNames(ctx));
  const year = issuedYearWithSuffix(record, ctx);
  return text(String.isNonEmpty(names) ? `${terminate(names)} (${year}).` : `(${year}).`);
}

/** `"(2nd ed.)"` when an edition is present, else `None`. */
function editionSuffix(record: BiblioRecord, ctx: RenderContext): Option.Option<RichText> {
  return record.edition !== undefined
    ? Option.some(text(`(${record.edition} ${ctx.locale.edition})`))
    : Option.none();
}

/** The trailing DOI/URL segment, linked, or `None`. */
function urlSuffix(record: BiblioRecord): Option.Option<RichText> {
  return Option.map(preferredUrl(record), (url) => link(url));
}

/** An italic field (a title of a whole work), when present. */
const italicField = (record: BiblioRecord, key: TextVariable): Option.Option<RichText> =>
  Option.map(richField(record, key), italic);

/** A field followed by a period, when present. */
const terminated = (value: Option.Option<RichText>): Option.Option<RichText> =>
  Option.map(value, terminateRich);

/** `"In J. Smith (Ed.), Container title (pp. 12–30)"` — the chapter's container clause. */
function containerClause(record: BiblioRecord, ctx: RenderContext): Option.Option<RichText> {
  const editors = formatNameList(record.editor ?? [], editorNames(ctx));
  const label = (record.editor?.length ?? 0) > 1 ? ctx.locale.editors : ctx.locale.editor;
  const pages =
    record.page !== undefined
      ? Option.some(text(`(${pagesLabel(record.page, ctx.locale)} ${record.page})`))
      : Option.none<RichText>();
  const container = joinRich([italicField(record, "container-title"), pages], " ");
  if (String.isNonEmpty(editors)) {
    return Option.some(concat(text(`${ctx.locale.in} ${editors} (${label}), `), container));
  }
  return String.isNonEmpty(toPlainText(container)) ? Option.some(container) : Option.none();
}

function book(record: BiblioRecord, ctx: RenderContext): RichText {
  const title =
    record.title !== undefined
      ? Option.some(
          terminateRich(joinRich([italicField(record, "title"), editionSuffix(record, ctx)], " ")),
        )
      : Option.none<RichText>();
  return joinRich([title, terminated(richField(record, "publisher")), urlSuffix(record)], " ");
}

function chapter(record: BiblioRecord, ctx: RenderContext): RichText {
  return joinRich(
    [
      terminated(richField(record, "title")),
      terminated(containerClause(record, ctx)),
      terminated(richField(record, "publisher")),
      urlSuffix(record),
    ],
    " ",
  );
}

function article(record: BiblioRecord): RichText {
  const volIssue =
    record.volume !== undefined
      ? Option.some(
          concat(
            italic(text(record.volume)),
            text(record.issue !== undefined ? `(${record.issue})` : ""),
          ),
        )
      : Option.none<RichText>();
  const locator = joinRich(
    [italicField(record, "container-title"), volIssue, richField(record, "page")],
    ", ",
  );
  return joinRich(
    [
      terminated(richField(record, "title")),
      String.isNonEmpty(toPlainText(locator))
        ? Option.some(terminateRich(locator))
        : Option.none<RichText>(),
      urlSuffix(record),
    ],
    " ",
  );
}

function webpage(record: BiblioRecord): RichText {
  return joinRich(
    [
      terminated(italicField(record, "title")),
      terminated(richField(record, "container-title")),
      urlSuffix(record),
    ],
    " ",
  );
}

function generic(record: BiblioRecord): RichText {
  return joinRich(
    [
      terminated(italicField(record, "title")),
      terminated(richField(record, "container-title")),
      terminated(richField(record, "publisher")),
      urlSuffix(record),
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

/** Sort key: primary-author family, then zero-padded year, then title. */
function sortKey(record: BiblioRecord): string {
  const first = record.author?.[0];
  const author = first !== undefined ? sortFamily(first) : (record.title ?? "").toLowerCase();
  const year = (record.issued?.["date-parts"]?.[0]?.[0] ?? 0).toString().padStart(6, "0");
  return `${author} ${year} ${(record.title ?? "").toLowerCase()}`;
}

/**
 * The APA 7th-edition citation style.
 *
 * @since 0.1.0
 */
export const apaStyle: CitationStyle = {
  id: "apa",
  title: "APA 7th edition",
  category: "author-date",
  renderReference: (record, ctx) => toPlainText(reference(record, ctx)),
  reference,
  sortKey,
  citation: { etAlMin: 3, etAlUseFirst: 1, open: "(", close: ")", delimiter: "; ", and: "&" },
};
