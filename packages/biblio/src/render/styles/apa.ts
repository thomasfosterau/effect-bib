/**
 * The APA 7th-edition style — an author-date reference format.
 *
 * A {@link CitationStyle} descriptor: it dispatches per {@link referenceClass}
 * through a lookup map of small, low-branch body renderers, each composing
 * the shared `format.ts` primitives. Output is plain text (no italic markup),
 * deterministic, and network-free.
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
  dispatchReference,
  formatNameList,
  issuedYearText,
  joinParts,
  type NameListOptions,
  pagesLabel,
  preferredUrl,
  sortFamily,
  terminate,
  terminatedField,
} from "../format.ts";
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
function head(record: BiblioRecord, ctx: RenderContext): string {
  const names = formatNameList(record.author ?? [], authorNames(ctx));
  const year = issuedYearText(Option.fromNullishOr(record.issued), ctx.locale);
  return String.isNonEmpty(names) ? `${terminate(names)} (${year}).` : `(${year}).`;
}

/** `"(2nd ed.)"` when an edition is present, else `None`. */
function editionSuffix(record: BiblioRecord, ctx: RenderContext): Option.Option<string> {
  return record.edition !== undefined
    ? Option.some(`(${record.edition} ${ctx.locale.edition})`)
    : Option.none();
}

/** The trailing DOI/URL segment, or `None`. */
function urlSuffix(record: BiblioRecord): Option.Option<string> {
  return preferredUrl(record);
}

/** `"In J. Smith (Ed.), Container title (pp. 12–30)"` — the chapter's container clause. */
function containerClause(record: BiblioRecord, ctx: RenderContext): Option.Option<string> {
  const editors = formatNameList(record.editor ?? [], editorNames(ctx));
  const label = (record.editor?.length ?? 0) > 1 ? ctx.locale.editors : ctx.locale.editor;
  const pages =
    record.page !== undefined
      ? Option.some(`(${pagesLabel(record.page, ctx.locale)} ${record.page})`)
      : Option.none<string>();
  const container = joinParts([Option.fromNullishOr(record["container-title"]), pages], " ");
  if (String.isNonEmpty(editors)) {
    return Option.some(`${ctx.locale.in} ${editors} (${label}), ${container}`);
  }
  return String.isNonEmpty(container) ? Option.some(container) : Option.none();
}

function book(record: BiblioRecord, ctx: RenderContext): string {
  const title =
    record.title !== undefined
      ? Option.some(
          terminate(joinParts([Option.some(record.title), editionSuffix(record, ctx)], " ")),
        )
      : Option.none<string>();
  return joinParts(
    [title, terminatedField(Option.fromNullishOr(record.publisher)), urlSuffix(record)],
    " ",
  );
}

function chapter(record: BiblioRecord, ctx: RenderContext): string {
  const container = containerClause(record, ctx);
  return joinParts(
    [
      terminatedField(Option.fromNullishOr(record.title)),
      Option.map(container, terminate),
      terminatedField(Option.fromNullishOr(record.publisher)),
      urlSuffix(record),
    ],
    " ",
  );
}

function article(record: BiblioRecord): string {
  const volIssue =
    record.volume !== undefined
      ? Option.some(`${record.volume}${record.issue !== undefined ? `(${record.issue})` : ""}`)
      : Option.none<string>();
  const locator = joinParts(
    [Option.fromNullishOr(record["container-title"]), volIssue, Option.fromNullishOr(record.page)],
    ", ",
  );
  return joinParts(
    [
      terminatedField(Option.fromNullishOr(record.title)),
      String.isNonEmpty(locator) ? Option.some(terminate(locator)) : Option.none<string>(),
      urlSuffix(record),
    ],
    " ",
  );
}

function webpage(record: BiblioRecord): string {
  return joinParts(
    [
      terminatedField(Option.fromNullishOr(record.title)),
      terminatedField(Option.fromNullishOr(record["container-title"])),
      urlSuffix(record),
    ],
    " ",
  );
}

function generic(record: BiblioRecord): string {
  return joinParts(
    [
      terminatedField(Option.fromNullishOr(record.title)),
      terminatedField(Option.fromNullishOr(record["container-title"])),
      terminatedField(Option.fromNullishOr(record.publisher)),
      urlSuffix(record),
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
  renderReference,
  sortKey,
};
