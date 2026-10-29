/**
 * Records as a BibTeX or BibLaTeX document, the inverse of `parseBibtex`.
 *
 * @copyright Thomas Foster
 * @module biblio/write/bibtex
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import { GENRES, LANGUAGES } from "../bibtex/fields.ts";
import type { BiblioRecord, CslDate, CslItemType, CslName } from "../record.ts";
import { citationKeys } from "./keys.ts";
import { type LatexDialect, textToLatex, verbatimLatex } from "./latex.ts";

/**
 * Which flavour of `.bib` {@link toBibtex} writes: `biblatex` (the default:
 * BibLaTeX's entry types and fields, `date` as ISO 8601 / EDTF, UTF-8 text
 * for biber) or `bibtex` (the classic entry types, `year` / `month` / `day`,
 * `journal` and `address`, and ASCII text with LaTeX accent commands).
 *
 * @since 1.0.0
 */
export type BibtexDialect = LatexDialect;

/**
 * How {@link toBibtex} writes: the {@link BibtexDialect} (default
 * `biblatex`).
 *
 * @since 1.0.0
 */
export interface BibtexWriteOptions {
  readonly dialect?: BibtexDialect;
}

/** CSL item type → BibLaTeX entry type; an unlisted type is `@misc`. */
const BIBLATEX_TYPES = HashMap.fromIterable<CslItemType, string>([
  ["article-journal", "article"],
  ["article-magazine", "article"],
  ["article-newspaper", "article"],
  ["book", "book"],
  ["paper-conference", "inproceedings"],
  ["thesis", "thesis"],
  ["report", "report"],
  ["webpage", "online"],
  ["post", "online"],
  ["post-weblog", "online"],
  ["dataset", "dataset"],
  ["software", "software"],
  ["patent", "patent"],
  ["periodical", "periodical"],
  ["manuscript", "unpublished"],
  ["standard", "standard"],
  ["graphic", "artwork"],
  ["song", "audio"],
  ["motion_picture", "video"],
  ["performance", "performance"],
  ["legal_case", "jurisdiction"],
  ["legislation", "legislation"],
  ["treaty", "legal"],
  ["personal_communication", "letter"],
  ["review", "review"],
  ["entry-encyclopedia", "inreference"],
  ["entry-dictionary", "inreference"],
  ["pamphlet", "booklet"],
]);

/** CSL item type → classic BibTeX entry type; an unlisted type is `@misc`. */
const BIBTEX_TYPES = HashMap.fromIterable<CslItemType, string>([
  ["article-journal", "article"],
  ["article-magazine", "article"],
  ["article-newspaper", "article"],
  ["book", "book"],
  ["paper-conference", "inproceedings"],
  ["report", "techreport"],
  ["manuscript", "unpublished"],
  ["pamphlet", "booklet"],
]);

/** An `article-*` type's BibLaTeX `entrysubtype`. */
const ENTRY_SUBTYPES = HashMap.fromIterable<CslItemType, string>([
  ["article-magazine", "magazine"],
  ["article-newspaper", "newspaper"],
]);

/** Entry types whose `number` is an issue number. */
const SERIAL_KINDS = HashSet.make("article", "periodical");

/** Reverses a name → value table, preferring `preferred`'s name where a value has several. */
const reverse = (
  table: HashMap.HashMap<string, string>,
  preferred: ReadonlyArray<readonly [string, string]>,
): HashMap.HashMap<string, string> =>
  HashMap.union(
    HashMap.fromIterable(
      Array.map(Array.fromIterable(table), ([name, value]) => [value, name] as const),
    ),
    HashMap.fromIterable(preferred),
  );

/** English genre → BibLaTeX `type` key. */
const GENRE_KEYS = reverse(GENRES, [["Master's thesis", "mathesis"]]);

/** BCP 47 tag → Babel language name (BibLaTeX's preferred name where a tag has several). */
const BABEL_NAMES = reverse(LANGUAGES, [
  ["en-US", "american"],
  ["en-GB", "british"],
  ["de-DE", "ngerman"],
  ["de-AT", "naustrian"],
  ["de-CH", "nswissgerman"],
  ["pt-BR", "brazilian"],
  ["nb-NO", "norsk"],
]);

/** The months as BibTeX's predefined macros. */
const MONTH_MACROS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** One field to write: its name, its LaTeX value, and whether it is a bare macro. */
interface Field {
  readonly name: string;
  readonly value: string;
  readonly bare?: boolean;
}

/** One entry being written: the record, the dialect and the entry type. */
interface Writer {
  readonly record: BiblioRecord;
  readonly dialect: BibtexDialect;
  readonly kind: string;
}

/** The entry type a record writes as. */
function entryType(record: BiblioRecord, dialect: BibtexDialect): string {
  if (record.type === "chapter") {
    return record["container-author"] === undefined ? "incollection" : "inbook";
  }
  if (dialect === "bibtex" && record.type === "thesis") {
    return /master/i.test(record.genre ?? "") ? "mastersthesis" : "phdthesis";
  }
  return Option.getOrElse(
    HashMap.get(dialect === "biblatex" ? BIBLATEX_TYPES : BIBTEX_TYPES, record.type),
    () => "misc",
  );
}

/** A text field, when the record has it. */
const textField = (
  writer: Writer,
  name: string,
  value: Option.Option<string>,
): Option.Option<Field> =>
  Option.map(value, (text) => ({
    name,
    value: textToLatex(text, writer.dialect),
  }));

/** A verbatim field (a URL, an identifier), when the record has it. */
const verbatimField = (name: string, value: Option.Option<string>): Option.Option<Field> =>
  Option.map(value, (text) => ({ name, value: verbatimLatex(text) }));

/** True when a name part must be braced: a lower-case word (read as `von`), a comma, or an `and`. */
const needsBraces = (part: string): boolean =>
  part.includes(",") ||
  part.split(/\s+/).some((word) => /^\P{Lu}*\p{Ll}/u.test(word) || word.toLowerCase() === "and");

/** One name as BibTeX: `von Last, Jr, First`, a literal name as one `{…}` group. */
function bibtexName(name: CslName, dialect: BibtexDialect): string {
  const latex = (value: string): string => textToLatex(value, dialect);
  if (name.literal !== undefined) return `{${latex(name.literal)}}`;
  const rawFamily = name.family ?? "";
  const family = needsBraces(rawFamily) ? `{${latex(rawFamily)}}` : latex(rawFamily);
  const particle = name["dropping-particle"] ?? name["non-dropping-particle"];
  const vonLast = particle === undefined ? family : `${latex(particle)} ${family}`;
  const given = Option.map(Option.fromUndefinedOr(name.given), (value) =>
    needsBraces(value) ? `{${latex(value)}}` : latex(value),
  );
  const suffix = Option.map(Option.fromUndefinedOr(name.suffix), latex);
  if (Option.isSome(suffix)) {
    return `${vonLast}, ${suffix.value}, ${Option.getOrElse(given, () => "")}`.trimEnd();
  }
  if (Option.isSome(given)) return `${vonLast}, ${given.value}`;
  // A multi-word or braced family alone needs the comma form, or its words
  // would split into first and last names (or a group read as a literal).
  return /\s/.test(vonLast) || family.startsWith("{") ? `${vonLast},` : vonLast;
}

/** The fields whose name list ended in `and others` when it was read. */
function etAlFields(record: BiblioRecord): HashSet.HashSet<string> {
  const others = record.extra?.["tex.others"];
  return HashSet.fromIterable(
    Predicate.isIterable(others)
      ? Array.filter(Array.fromIterable(others), Predicate.isString)
      : [],
  );
}

/** A name-list field, when the record has the names. */
function namesField(
  writer: Writer,
  name: string,
  names: Option.Option<readonly CslName[]>,
): Option.Option<Field> {
  if (Option.isNone(names) || Array.isReadonlyArrayEmpty(names.value)) return Option.none();
  const list = names.value.map((entry) => bibtexName(entry, writer.dialect));
  const others = HashSet.has(etAlFields(writer.record), name) ? [...list, "others"] : list;
  return Option.some({ name, value: others.join(" and ") });
}

/** A year padded to the four digits ISO 8601 writes. */
const pad = (value: number, width: number): string => value.toString().padStart(width, "0");

/** One `date-parts` entry as an ISO 8601 date. */
const isoPoint = (parts: readonly number[]): string =>
  [pad(parts[0], 4), ...parts.slice(1, 3).map((part) => pad(part, 2))].join("-");

/** True for a season the EDTF month codes 21–24 can carry. */
const isSeason = (season: CslDate["season"]): season is number =>
  Predicate.isNumber(season) && Number.isInteger(season) && season >= 1 && season <= 4;

/**
 * A CSL date as an EDTF value (`2015-03-14`, `2001/2004`, `2015-21`,
 * `2015~`), an open range as its raw text, else the literal or raw text.
 */
function edtf(date: CslDate): Option.Option<string> {
  const parts = date["date-parts"];
  if (
    parts === undefined ||
    Array.isReadonlyArrayEmpty(parts) ||
    Array.isReadonlyArrayEmpty(parts[0])
  ) {
    return Option.fromUndefinedOr(date.literal ?? date.raw);
  }
  if (parts.length === 1 && date.raw !== undefined && date.raw.includes("/"))
    return Option.some(date.raw);
  const circa = date.circa === undefined || date.circa === false || date.circa === 0 ? "" : "~";
  const start =
    parts[0].length === 1 && isSeason(date.season)
      ? `${pad(parts[0][0], 4)}-${20 + date.season}`
      : isoPoint(parts[0]);
  const end =
    parts.length > 1 && Array.isReadonlyArrayNonEmpty(parts[1])
      ? `/${isoPoint(parts[1])}${circa}`
      : "";
  return Option.some(`${start}${circa}${end}`);
}

/** A BibLaTeX date field, when the record has the date. */
const dateField = (name: string, date: Option.Option<CslDate>): Option.Option<Field> =>
  Option.map(Option.flatMap(date, edtf), (value): Field => ({
    name,
    value: verbatimLatex(value),
  }));

/** The issued date: BibLaTeX's `date`, or BibTeX's `year` / `month` / `day`. */
function issuedFields(writer: Writer): Field[] {
  const issued = writer.record.issued;
  if (issued === undefined) return [];
  if (writer.dialect === "biblatex")
    return Array.fromOption(dateField("date", Option.some(issued)));
  const parts = issued["date-parts"];
  const single =
    parts !== undefined &&
    parts.length === 1 &&
    parts[0].length > 1 &&
    !isSeason(issued.season) &&
    (issued.circa === undefined || issued.circa === false || issued.circa === 0);
  if (!single) return Array.fromOption(dateField("year", Option.some(issued)));
  const [year, month, day] = parts[0];
  return [
    { name: "year", value: year.toString() },
    {
      name: "month",
      value: MONTH_MACROS[month - 1] ?? month.toString(),
      bare: month >= 1 && month <= 12,
    },
    ...(day === undefined ? [] : [{ name: "day", value: day.toString() }]),
  ];
}

/** Entry types whose container is a book, for which a volume title is the `booktitle`. */
const CONTAINED_KINDS = HashSet.make("inbook", "incollection", "inproceedings", "inreference");

/**
 * The title fields. A record with a `volume-title` is a volume of a
 * multi-volume work, written as BibLaTeX's `maintitle` (the reader's
 * mapping in reverse): in a contained entry, the container is the
 * `maintitle` and the volume the `booktitle`; otherwise the title is the
 * `maintitle` and the volume the entry's `title`. BibTeX has no
 * `maintitle`, so it writes the title and the container as they are.
 */
function titleFields(writer: Writer): Option.Option<Field>[] {
  const { record } = writer;
  const volume = Option.fromUndefinedOr(record["volume-title"]);
  if (
    writer.dialect !== "biblatex" ||
    Option.isNone(volume) ||
    HashSet.has(SERIAL_KINDS, writer.kind)
  )
    return [
      textField(writer, "title", Option.fromUndefinedOr(record.title)),
      containerField(writer),
    ];
  if (HashSet.has(CONTAINED_KINDS, writer.kind))
    return [
      textField(writer, "title", Option.fromUndefinedOr(record.title)),
      textField(writer, "maintitle", Option.fromUndefinedOr(record["container-title"])),
      textField(writer, "booktitle", volume),
    ];
  return [
    textField(writer, "maintitle", Option.fromUndefinedOr(record.title)),
    textField(writer, "title", volume),
    containerField(writer),
  ];
}

/** The container title's field: a journal for an article, else the book. */
function containerField(writer: Writer): Option.Option<Field> {
  const name = HashSet.has(SERIAL_KINDS, writer.kind)
    ? writer.dialect === "biblatex"
      ? "journaltitle"
      : "journal"
    : "booktitle";
  return textField(writer, name, Option.fromUndefinedOr(writer.record["container-title"]));
}

/** `number`, `issue` and `series`: an issue number for a serial, a series number in a series, else the item's own. */
function numberingFields(writer: Writer): Option.Option<Field>[] {
  const { record } = writer;
  const arxivNumber =
    record.identifiers.arxiv === undefined ? undefined : `arXiv:${record.identifiers.arxiv}`;
  const own = record.number === arxivNumber ? undefined : record.number;
  if (HashSet.has(SERIAL_KINDS, writer.kind)) {
    return [
      textField(writer, "series", Option.fromUndefinedOr(record["collection-title"])),
      textField(writer, "number", Option.fromUndefinedOr(record.issue ?? own)),
    ];
  }
  const inSeries = record["collection-title"] !== undefined;
  return [
    textField(writer, "series", Option.fromUndefinedOr(record["collection-title"])),
    textField(
      writer,
      "number",
      Option.fromUndefinedOr(inSeries ? record["collection-number"] : own),
    ),
    textField(writer, "issue", Option.fromUndefinedOr(record.issue)),
  ];
}

/** The publisher's field: a thesis's school or a report's institution, else `publisher`. */
function publisherField(writer: Writer): Option.Option<Field> {
  const name =
    writer.kind === "thesis" || writer.kind === "report" || writer.kind === "techreport"
      ? "institution"
      : writer.kind === "phdthesis" || writer.kind === "mastersthesis"
        ? "school"
        : "publisher";
  return textField(writer, name, Option.fromUndefinedOr(writer.record.publisher));
}

/** The language: BibLaTeX's `langid` when the tag has a Babel name, else `language`. */
function languageField(writer: Writer): Option.Option<Field> {
  return Option.map(Option.fromUndefinedOr(writer.record.language), (tag) =>
    Option.match(HashMap.get(BABEL_NAMES, tag), {
      onNone: (): Field => ({ name: "language", value: textToLatex(tag, writer.dialect) }),
      onSome: (babel): Field => ({
        name: writer.dialect === "biblatex" ? "langid" : "language",
        value: babel,
      }),
    }),
  );
}

/** The genre as `type`: BibLaTeX's localisable key when it has one, else the text. */
const genreField = (writer: Writer): Option.Option<Field> =>
  Option.map(Option.fromUndefinedOr(writer.record.genre), (genre) => ({
    name: "type",
    value: Option.getOrElse(
      Option.filter(HashMap.get(GENRE_KEYS, genre), () => writer.dialect === "biblatex"),
      () => textToLatex(genre, writer.dialect),
    ),
  }));

/** The identifiers: ISBN, ISSN, DOI, PubMed and arXiv (as an `eprint`). */
function identifierFields(writer: Writer): Option.Option<Field>[] {
  const { isbn, issn, doi, pmid, pmcid, arxiv } = writer.record.identifiers;
  return [
    verbatimField("isbn", Option.fromUndefinedOr(isbn)),
    verbatimField("issn", Option.fromUndefinedOr(issn)),
    verbatimField("doi", Option.fromUndefinedOr(doi)),
    verbatimField("pmid", Option.fromUndefinedOr(pmid)),
    verbatimField("pmcid", Option.fromUndefinedOr(pmcid)),
    verbatimField("eprint", Option.fromUndefinedOr(arxiv)),
    Option.map(Option.fromUndefinedOr(arxiv), () =>
      writer.dialect === "biblatex"
        ? { name: "eprinttype", value: "arxiv" }
        : { name: "archiveprefix", value: "arXiv" },
    ),
  ];
}

/** `options = {useprefix=true}` when a name's particle is non-dropping (and none is dropping). */
function optionsField(record: BiblioRecord): Option.Option<Field> {
  const names = [
    ...(record.author ?? []),
    ...(record.editor ?? []),
    ...(record.translator ?? []),
    ...(record["container-author"] ?? []),
  ];
  const nonDropping = names.some((name) => name["non-dropping-particle"] !== undefined);
  const dropping = names.some((name) => name["dropping-particle"] !== undefined);
  return nonDropping && !dropping
    ? Option.some({ name: "options", value: "useprefix=true" })
    : Option.none();
}

/** The `tex.<field>` passthrough the parser kept, written back when no mapping wrote the field. */
function passthroughFields(writer: Writer, written: HashSet.HashSet<string>): Field[] {
  return Array.filterMap(
    Record.toEntries(writer.record.extra ?? {}),
    ([key, value]): Result.Result<Field, void> => {
      if (!key.startsWith("tex.") || key === "tex.others" || !Predicate.isString(value))
        return Result.failVoid;
      const name = key.slice(4).toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(name) || HashSet.has(written, name)) return Result.failVoid;
      return Result.succeed({
        name,
        value: /^(?:url|doi|eprint|pdf|verb[abc])$/.test(name)
          ? verbatimLatex(value)
          : textToLatex(value, writer.dialect),
      });
    },
  );
}

/** Every field of one entry, in the order they are written. */
function entryFields(writer: Writer): Field[] {
  const { record } = writer;
  const biblatex = writer.dialect === "biblatex";
  const mapped = Array.getSomes([
    namesField(writer, "author", Option.fromUndefinedOr(record.author)),
    namesField(writer, "editor", Option.fromUndefinedOr(record.editor)),
    namesField(writer, "translator", Option.fromUndefinedOr(record.translator)),
    namesField(writer, "bookauthor", Option.fromUndefinedOr(record["container-author"])),
    ...titleFields(writer),
    textField(writer, "shorttitle", Option.fromUndefinedOr(record["title-short"])),
    textField(writer, "shortjournal", Option.fromUndefinedOr(record["container-title-short"])),
    textField(writer, "edition", Option.fromUndefinedOr(record.edition)),
    textField(writer, "volume", Option.fromUndefinedOr(record.volume)),
    textField(writer, "volumes", Option.fromUndefinedOr(record["number-of-volumes"])),
    ...numberingFields(writer),
    textField(writer, "chapter", Option.fromUndefinedOr(record["chapter-number"])),
    Option.map(Option.fromUndefinedOr(record.page), (page) => ({
      name: "pages",
      value: textToLatex(page.replace(/-+/g, "-"), writer.dialect).replace(/-/g, "--"),
    })),
    textField(writer, "pagetotal", Option.fromUndefinedOr(record["number-of-pages"])),
    textField(writer, "version", Option.fromUndefinedOr(record.version)),
    publisherField(writer),
    textField(
      writer,
      biblatex ? "location" : "address",
      Option.fromUndefinedOr(record["publisher-place"]),
    ),
  ]);
  const later = Array.getSomes([
    dateField("urldate", Option.fromUndefinedOr(record.accessed)),
    dateField("origdate", Option.fromUndefinedOr(record["original-date"])),
    dateField("eventdate", Option.fromUndefinedOr(record["event-date"])),
    textField(writer, "eventtitle", Option.fromUndefinedOr(record["event-title"])),
    textField(writer, "venue", Option.fromUndefinedOr(record["event-place"])),
    textField(writer, "origtitle", Option.fromUndefinedOr(record["original-title"])),
    textField(writer, "origpublisher", Option.fromUndefinedOr(record["original-publisher"])),
    textField(writer, "origlocation", Option.fromUndefinedOr(record["original-publisher-place"])),
    textField(writer, "pubstate", Option.fromUndefinedOr(record.status)),
    genreField(writer),
    Option.flatMap(HashMap.get(ENTRY_SUBTYPES, record.type), (value) =>
      biblatex ? Option.some({ name: "entrysubtype", value }) : Option.none(),
    ),
    languageField(writer),
    textField(writer, "keywords", Option.fromUndefinedOr(record.keyword)),
    ...identifierFields(writer),
    verbatimField("url", Option.fromUndefinedOr(record.URL)),
    textField(writer, "abstract", Option.fromUndefinedOr(record.abstract)),
    textField(writer, "annotation", Option.fromUndefinedOr(record.annote)),
    textField(writer, "note", Option.fromUndefinedOr(record.note)),
    optionsField(record),
  ]);
  const fields = [...mapped, ...issuedFields(writer), ...later];
  return [
    ...fields,
    ...passthroughFields(writer, HashSet.fromIterable(fields.map((field) => field.name))),
  ];
}

/** One entry as text. */
function writeEntry(record: BiblioRecord, key: string, dialect: BibtexDialect): string {
  const writer: Writer = { record, dialect, kind: entryType(record, dialect) };
  const body = entryFields(writer).map(
    (field) => `  ${field.name} = ${field.bare === true ? field.value : `{${field.value}}`},`,
  );
  return [`@${writer.kind}{${key},`, ...body, "}"].join("\n");
}

/**
 * Writes records as a BibTeX or BibLaTeX document, one entry per record,
 * the inverse of {@link parseBibtex}: the CSL item type maps back to an
 * entry type (a type with no entry type of its own is `@misc`), each
 * variable to its field, CSL markup to LaTeX commands with a `nocase` span
 * as a case-protecting `{…}` group, the identifiers to `isbn` / `issn` /
 * `doi` / `pmid` / `pmcid` and an arXiv id to an `eprint`, and the
 * `tex.<field>` passthrough `parseBibtex` kept back to its field. Each
 * entry's key is the record's `citation-key` (else a string `id`), cleaned
 * of characters a key cannot hold, or a generated `authorYEARword` key; a
 * key already used gets a letter suffix. `options.dialect` picks BibLaTeX
 * (the default: UTF-8, `date`, `journaltitle`, `location`) or classic
 * BibTeX (ASCII with accent commands, `year` / `month`, `journal`,
 * `address`). Pure and total.
 *
 * What a `.bib` file cannot hold is left out: an ORCID, `categories`, the
 * CSL variables with no BibLaTeX field (`archive`, `call-number`, …) and the
 * provenance. A name's particle reads back as a dropping particle unless
 * every particle in the entry is non-dropping (then `useprefix=true`).
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { fromCslJson, parseBibtex, toBibtex } from "@thomasfosterau/biblio"
 *
 * const record = fromCslJson({
 *   type: "article-journal",
 *   title: 'The <span class="nocase">DNA</span> of Schön',
 *   author: [{ family: "Berg", given: "Anna", "dropping-particle": "van der" }],
 *   "container-title": "Nature",
 *   issued: { "date-parts": [[2004, 3]] },
 *   DOI: "10.1038/nature02345",
 * })
 *
 * const bib = toBibtex([record])
 * assert.strictEqual(bib.split("\n")[0], "@article{berg2004dna,")
 * assert.ok(bib.includes("  title = {The {DNA} of Schön},"))
 * assert.ok(bib.includes("  date = {2004-03},"))
 *
 * // Classic BibTeX: ASCII, with accent commands and `year` / `month`.
 * const classic = toBibtex([record], { dialect: "bibtex" })
 * assert.ok(classic.includes('  title = {The {DNA} of Sch{\\"o}n},'))
 * assert.ok(classic.includes("  month = mar,"))
 *
 * // And back again.
 * const [parsed] = parseBibtex(bib, { mode: "lenient" })
 * assert.strictEqual(parsed.outcome === "parsed" ? parsed.record["container-title"] : undefined, "Nature")
 * ```
 *
 * @since 1.0.0
 */
export function toBibtex(
  records: readonly BiblioRecord[],
  options: BibtexWriteOptions = {},
): string {
  const dialect = options.dialect ?? "biblatex";
  const keys = citationKeys(records);
  const entries = Array.map(records, (record, index) => writeEntry(record, keys[index], dialect));
  return Array.isArrayEmpty(entries) ? "" : `${entries.join("\n\n")}\n`;
}
