/**
 * The Chicago notes-and-bibliography style (17th edition): a note style.
 *
 * Its bibliography is alphabetical, with the first author inverted
 * (`Harari, Yuval Noah. Sapiens. New York: Harper, 2015.`); a source's first
 * note gives it in full (`Yuval Noah Harari, Sapiens (New York: Harper,
 * 2015)`), later notes in short form (`Harari, Sapiens`), and a repeat of the
 * source just cited is "ibid." (`renderCitations` decides which).
 *
 * Like the other built-ins, this is a **scoped subset** of the style, over
 * the five reference shapes the engine classifies, not a full CSL
 * implementation. Titles of whole works are italic and titles of parts are
 * quoted, with US punctuation inside the quotes.
 *
 * @copyright Thomas Foster
 * @module biblio/render/styles/chicago
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as String from "effect/String";
import { type BiblioRecord, type CslName, yearOf } from "../../record.ts";
import {
  citationName,
  issuedYearWithSuffix,
  plainField,
  preferredUrl,
  type ReferenceClass,
  referenceClass,
  richField,
  type TextVariable,
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

/** A name in reading order: `Yuval Noah Harari`. */
function fullName(name: CslName): string {
  if (name.literal !== undefined) return name.literal;
  return [
    name.given,
    name["dropping-particle"],
    name["non-dropping-particle"],
    name.family,
    name.suffix,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
}

/** A name inverted for the bibliography: `Harari, Yuval Noah`. */
function invertedName(name: CslName): string {
  if (name.literal !== undefined) return name.literal;
  if (name.family === undefined && name["non-dropping-particle"] === undefined) {
    return fullName(name);
  }
  const family = citationName(name);
  const given = [name.given, name["dropping-particle"]]
    .filter((part) => part !== undefined)
    .join(" ");
  const base = String.isEmpty(given) ? family : `${family}, ${given}`;
  return name.suffix === undefined ? base : `${base}, ${name.suffix}`;
}

/** `A`, `A and B`, `A, B, and C`. */
function joinNames(names: readonly string[], and: string): string {
  if (names.length <= 2) return names.join(` ${and} `);
  return `${names.slice(0, -1).join(", ")}, ${and} ${names[names.length - 1]}`;
}

/** The record's contributors: its authors, else its editors. */
const contributors = (record: BiblioRecord): readonly CslName[] =>
  record.author ?? record.editor ?? [];

/** Bibliography names: the first inverted, the rest in reading order; past ten, seven and "et al.". */
function bibliographyNames(record: BiblioRecord, ctx: RenderContext): string {
  const names = contributors(record);
  if (Array.isReadonlyArrayEmpty(names)) return "";
  const forms = names.map((name, index) => (index === 0 ? invertedName(name) : fullName(name)));
  if (forms.length > 10) return `${forms.slice(0, 7).join(", ")}, ${ctx.locale.etAl}`;
  if (forms.length === 2) return `${forms[0]}, ${ctx.locale.and} ${forms[1]}`;
  return joinNames(forms, ctx.locale.and);
}

/** Note names, in reading order; four or more as the first and "et al.". */
function noteNames(
  names: readonly CslName[],
  ctx: RenderContext,
  form: (name: CslName) => string,
): string {
  if (Array.isReadonlyArrayEmpty(names)) return "";
  if (names.length >= 4) return `${form(names[0])} ${ctx.locale.etAl}`;
  return joinNames(names.map(form), ctx.locale.and);
}

/**
 * A part's title in quotes with a following punctuation mark inside them,
 * as US style puts it (`“Title,”`); a title already ending in `?` or `!`
 * takes none.
 */
function quoted(title: RichText, punctuation: string): RichText {
  const mark = /[?!]$/.test(toPlainText(title)) ? "" : punctuation;
  return concat(text("“"), title, text(`${mark}”`));
}

/** An italic title, when present. */
const italicTitle = (record: BiblioRecord, key: TextVariable): Option.Option<RichText> =>
  Option.map(richField(record, key), italic);

/** `New York: Harper, 2015` — the imprint, without the year when `withYear` is false. */
function imprint(record: BiblioRecord, ctx: RenderContext, withYear: boolean): string {
  const place = record["publisher-place"];
  const publisher = record.publisher;
  const where = [place, publisher].filter((part) => part !== undefined).join(": ");
  const year = withYear ? issuedYearWithSuffix(record, ctx) : "";
  return [where, year].filter(String.isNonEmpty).join(", ");
}

/** A journal's volume, issue and year: `431, no. 2 (2004)`. */
function serialDetail(record: BiblioRecord, ctx: RenderContext): string {
  const volume = record.volume ?? "";
  const issue = record.issue !== undefined ? `no. ${record.issue}` : "";
  const numbering = [volume, issue].filter(String.isNonEmpty).join(", ");
  const year = `(${issuedYearWithSuffix(record, ctx)})`;
  return [numbering, year].filter(String.isNonEmpty).join(" ");
}

/** The record's link (its URL, or its DOI's), when present. */
const urlOf = (record: BiblioRecord): Option.Option<RichText> =>
  Option.map(preferredUrl(record), (url) => link(url));

/** A sentence-ended segment, when present. */
const sentence = (value: Option.Option<RichText>): Option.Option<RichText> =>
  Option.map(value, terminateRich);

/** A plain-text segment, when non-empty. */
const segment = (value: string): Option.Option<RichText> =>
  String.isEmpty(value) ? Option.none() : Option.some(text(value));

/** The title of a part in its bibliography form: `“Title.”`. */
const partTitle = (record: BiblioRecord): Option.Option<RichText> =>
  Option.map(richField(record, "title"), (title) => quoted(title, "."));

/** The editors after a container: `edited by Jane Doe`. */
function editedBy(record: BiblioRecord, ctx: RenderContext, lead: string): Option.Option<string> {
  const editors = record.editor ?? [];
  if (Array.isReadonlyArrayEmpty(editors) || record.author === undefined) return Option.none();
  return Option.some(`${lead} ${joinNames(editors.map(fullName), ctx.locale.and)}`);
}

/** Rich segments, each present or not. */
type Segments = readonly Option.Option<RichText>[];

/** A book's edition, when present: `2nd ed.`. */
const edition = (record: BiblioRecord, ctx: RenderContext): Option.Option<RichText> =>
  record.edition !== undefined ? segment(`${record.edition} ${ctx.locale.edition}`) : Option.none();

/** A journal and its volume, issue and year: `Nature 431, no. 2 (2004)`. */
const journalDetail = (record: BiblioRecord, ctx: RenderContext): RichText =>
  joinRich([italicTitle(record, "container-title"), segment(serialDetail(record, ctx))], " ");

/** A bibliography entry's body for each reference class. */
const BIBLIOGRAPHY_BODIES: Readonly<
  Record<ReferenceClass, (record: BiblioRecord, ctx: RenderContext) => Segments>
> = {
  book: (record, ctx) => [
    sentence(italicTitle(record, "title")),
    sentence(edition(record, ctx)),
    sentence(segment(imprint(record, ctx, true))),
    sentence(urlOf(record)),
  ],
  chapter: (record, ctx) => {
    const container = joinRich(
      [
        Option.map(italicTitle(record, "container-title"), (title) =>
          concat(text(`${ctx.locale.in} `), title),
        ),
        Option.map(editedBy(record, ctx, "edited by"), text),
        Option.map(Option.fromNullishOr(record.page), text),
      ],
      ", ",
    );
    return [
      partTitle(record),
      sentence(Option.some(container)),
      sentence(segment(imprint(record, ctx, true))),
      sentence(urlOf(record)),
    ];
  },
  article: (record, ctx) => {
    const journal = journalDetail(record, ctx);
    const withPages =
      record.page === undefined ? journal : concat(journal, text(`: ${record.page}`));
    return [partTitle(record), sentence(Option.some(withPages)), sentence(urlOf(record))];
  },
  webpage: (record, ctx) => [
    partTitle(record),
    sentence(richField(record, "container-title")),
    sentence(segment(issuedYearWithSuffix(record, ctx))),
    sentence(urlOf(record)),
  ],
  generic: (record, ctx) => [
    sentence(italicTitle(record, "title")),
    sentence(segment(imprint(record, ctx, true))),
    sentence(urlOf(record)),
  ],
};

/** A bibliography entry: `Harari, Yuval Noah. Sapiens. New York: Harper, 2015.` */
function reference(record: BiblioRecord, ctx: RenderContext): RichText {
  const names = bibliographyNames(record, ctx);
  const body = BIBLIOGRAPHY_BODIES[referenceClass(record.type)](record, ctx);
  return joinRich([sentence(segment(names)), ...body], " ");
}

/** The imprint in parentheses, when there is one: ` (New York: Harper, 2015)`. */
function parentheticalImprint(record: BiblioRecord, ctx: RenderContext): RichText {
  const facts = imprint(record, ctx, true);
  return String.isEmpty(facts) ? [] : text(` (${facts})`);
}

/** A part's title in a note: `“Title,”`. */
const notePartTitle = (record: BiblioRecord): Option.Option<RichText> =>
  Option.map(richField(record, "title"), (title) => quoted(title, ","));

/** A whole work in a note: `Sapiens (New York: Harper, 2015)`. */
const noteWork = (record: BiblioRecord, ctx: RenderContext): RichText =>
  concat(
    Option.getOrElse(italicTitle(record, "title"), () => []),
    parentheticalImprint(record, ctx),
  );

/** A first note's body after the names, for each reference class. */
const NOTE_BODIES: Readonly<
  Record<ReferenceClass, (record: BiblioRecord, ctx: RenderContext) => RichText>
> = {
  book: noteWork,
  generic: noteWork,
  chapter: (record, ctx) => {
    const container = joinRich(
      [
        Option.map(italicTitle(record, "container-title"), (title) => concat(text("in "), title)),
        Option.map(editedBy(record, ctx, "ed."), text),
      ],
      ", ",
    );
    return joinRich(
      [notePartTitle(record), Option.some(concat(container, parentheticalImprint(record, ctx)))],
      " ",
    );
  },
  // A note gives the pinpoint (the cite's locator), not the article's page range.
  article: (record, ctx) =>
    joinRich([notePartTitle(record), Option.some(journalDetail(record, ctx))], " "),
  webpage: (record, ctx) =>
    joinRich(
      [
        notePartTitle(record),
        Option.map(richField(record, "container-title"), (site) => concat(site, text(","))),
        segment(issuedYearWithSuffix(record, ctx)),
      ],
      " ",
    ),
};

/** A first note: `Yuval Noah Harari, Sapiens (New York: Harper, 2015)`. */
function noteFull(record: BiblioRecord, ctx: RenderContext): RichText {
  const names = noteNames(contributors(record), ctx, fullName);
  return joinRich(
    [segment(names), Option.some(NOTE_BODIES[referenceClass(record.type)](record, ctx))],
    ", ",
  );
}

/** A later note: `Harari, Sapiens`, the title cut at its colon. */
function noteShort(record: BiblioRecord, ctx: RenderContext): RichText {
  const names = noteNames(contributors(record), ctx, citationName);
  const short = Option.map(plainField(record, "title"), (title) => title.split(":")[0].trim());
  const kind = referenceClass(record.type);
  const title = Option.map(short, (value) =>
    kind === "book" || kind === "generic" ? italic(text(value)) : text(`“${value}”`),
  );
  return joinRich([segment(names), title], ", ");
}

/** Sort key: the first contributor's family name, then title, then year. */
function sortKey(record: BiblioRecord): string {
  const first = Array.head(contributors(record));
  const title = Option.getOrElse(plainField(record, "title"), () => "");
  const lead = Option.match(first, { onNone: () => title, onSome: invertedName });
  const year = `${yearOf(record.issued) ?? 0}`.padStart(6, "0");
  return `${lead.toLowerCase()} ${title.toLowerCase()} ${year}`;
}

/**
 * The Chicago notes-and-bibliography (note) citation style.
 *
 * @since 0.1.0
 */
export const chicagoNotesStyle: CitationStyle = {
  id: "chicago-notes",
  title: "Chicago Manual of Style 17th edition (notes and bibliography)",
  category: "note",
  renderReference: (record, ctx) => toPlainText(reference(record, ctx)),
  reference,
  sortKey,
  citation: { delimiter: "; ", omitPageLabel: true, noteFull, noteShort },
};
