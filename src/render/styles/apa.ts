/**
 * @copyright Thomas Foster
 *
 * The APA 7th-edition style — an author-date reference format (biblio B5,
 * issue #1072).
 *
 * A {@link CitationStyle} descriptor: it dispatches per {@link referenceClass}
 * through a lookup map of small, low-branch body renderers, each composing
 * the shared `format.ts` primitives. Output is plain text (no italic markup),
 * deterministic, and network-free.
 *
 * This is a **scoped subset** of APA, not a full CSL implementation: it
 * covers the five reference shapes the site renders (book, chapter, journal
 * article, webpage, and a generic fallback). Known simplifications — no
 * author moves the title to the author slot only loosely; the >20-author
 * elision is "first 19 … et al." rather than APA's "first 19 … final" — are
 * documented at their call sites.
 *
 * @module biblio/render/styles/apa
 */

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
  const year = issuedYearText(record.issued, ctx.locale);
  return names.length > 0 ? `${terminate(names)} (${year}).` : `(${year}).`;
}

/** `"(2nd ed.)"` when an edition is present, else `null`. */
function editionSuffix(record: BiblioRecord, ctx: RenderContext): string | null {
  return record.edition !== undefined ? `(${record.edition} ${ctx.locale.edition})` : null;
}

/** The trailing DOI/URL segment, or `null`. */
function urlSuffix(record: BiblioRecord): string | null {
  return preferredUrl(record);
}

/** `"In J. Smith (Ed.), Container title (pp. 12–30)"` — the chapter's container clause. */
function containerClause(record: BiblioRecord, ctx: RenderContext): string | null {
  const editors = formatNameList(record.editor ?? [], editorNames(ctx));
  const label = (record.editor?.length ?? 0) > 1 ? ctx.locale.editors : ctx.locale.editor;
  const pages =
    record.page !== undefined ? `(${pagesLabel(record.page, ctx.locale)} ${record.page})` : null;
  const container = joinParts([record["container-title"], pages], " ");
  if (editors.length > 0) {
    return `${ctx.locale.in} ${editors} (${label}), ${container}`;
  }
  return container.length > 0 ? container : null;
}

function book(record: BiblioRecord, ctx: RenderContext): string {
  const title =
    record.title !== undefined
      ? terminate(joinParts([record.title, editionSuffix(record, ctx)], " "))
      : null;
  return joinParts([title, terminatedField(record.publisher), urlSuffix(record)], " ");
}

function chapter(record: BiblioRecord, ctx: RenderContext): string {
  const container = containerClause(record, ctx);
  return joinParts(
    [
      terminatedField(record.title),
      container !== null ? terminate(container) : null,
      terminatedField(record.publisher),
      urlSuffix(record),
    ],
    " ",
  );
}

function article(record: BiblioRecord): string {
  const volIssue =
    record.volume !== undefined
      ? `${record.volume}${record.issue !== undefined ? `(${record.issue})` : ""}`
      : null;
  const locator = joinParts([record["container-title"], volIssue, record.page], ", ");
  return joinParts(
    [
      terminatedField(record.title),
      locator.length > 0 ? terminate(locator) : null,
      urlSuffix(record),
    ],
    " ",
  );
}

function webpage(record: BiblioRecord): string {
  return joinParts(
    [terminatedField(record.title), terminatedField(record["container-title"]), urlSuffix(record)],
    " ",
  );
}

function generic(record: BiblioRecord): string {
  return joinParts(
    [
      terminatedField(record.title),
      terminatedField(record["container-title"]),
      terminatedField(record.publisher),
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
  const year = String(record.issued?.["date-parts"]?.[0]?.[0] ?? 0).padStart(6, "0");
  return `${author} ${year} ${(record.title ?? "").toLowerCase()}`;
}

/** The APA 7th-edition citation style. */
export const apaStyle: CitationStyle = {
  id: "apa",
  title: "APA 7th edition",
  category: "author-date",
  renderReference,
  sortKey,
};
