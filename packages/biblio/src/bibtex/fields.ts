/**
 * BibTeX and BibLaTeX fields as CSL: the entry-type mapping, the field
 * mapping onto the record's typed slots (`title-short`, `genre`, `keyword`
 * and the other CSL variables among them, and the PubMed and arXiv
 * identifiers), and every remaining field in `extra` as `tex.<field>`, so
 * nothing in the entry is silently dropped. The one field ignored outright
 * is `file` (a local attachment path).
 *
 * The mapping follows the published BibLaTeX → CSL mapping Pandoc and
 * citeproc-js use.
 *
 * @copyright Thomas Foster
 * @module biblio/bibtex/fields
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as HashSet from "effect/HashSet";
import * as MutableHashSet from "effect/MutableHashSet";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import type * as Types from "effect/Types";
import { decodeArxiv, decodeIsbn, decodeIssn, decodePmcid, decodePmid } from "../identifiers.ts";
import type { RawFields } from "../raw-fields.ts";
import {
  type BiblioRecord,
  type CslDate,
  type CslItemType,
  type CslName,
  sanitiseText,
} from "../record.ts";
import { type Budget, spend } from "./budget.ts";
import { dateFromParts, readBibtexDate, readDay, readMonth } from "./dates.ts";
import { decodeLatex, decodeLatexMarkup } from "./latex.ts";
import { parseBibtexNames } from "./names.ts";
import type { BibtexEntry } from "./scan.ts";

/**
 * The record members a BibTeX entry fills beyond the shared field bag.
 *
 * @since 0.1.0
 */
export type BibtexAdditions = Partial<Omit<BiblioRecord, "type" | "identifiers" | "provenance">>;

/**
 * One entry mapped: the shared field bag the assembly validates, and the
 * further record members it adds to a parsed record.
 *
 * @since 0.1.0
 */
export interface BibtexMapped {
  readonly fields: RawFields;
  readonly additions: BibtexAdditions;
}

/**
 * The longest field source decoded, unless the caller's field-length limit
 * is longer; the sanitised result is clamped to that limit.
 */
const MAX_SOURCE_LENGTH = 64_000;

/**
 * The most inherited field source decoded across one document: four times
 * the input cap. Past it an inherited field decodes to nothing, so
 * thousands of children of one large `crossref` parent cannot multiply the
 * work.
 *
 * @since 1.0.0
 */
export const DECODED_SOURCE_FACTOR = 4;

/**
 * The bounds one document is mapped under: the longest sanitised field, the
 * most names per name variable, and the input cap the decoding budget
 * scales with; and whether text fields keep their LaTeX formatting as CSL
 * markup.
 *
 * @since 1.0.0
 */
export interface BibtexLimits {
  readonly maxFieldLength: number;
  readonly maxAuthors: number;
  readonly maxInputLength: number;
  readonly cslMarkup: boolean;
}

/** BibTeX / BibLaTeX entry type → CSL item type; an unlisted type is `document`. */
const ENTRY_TYPES = HashMap.fromIterable<string, CslItemType>([
  ["article", "article-journal"],
  ["book", "book"],
  ["mvbook", "book"],
  ["inbook", "chapter"],
  ["bookinbook", "chapter"],
  ["suppbook", "chapter"],
  ["booklet", "pamphlet"],
  ["collection", "book"],
  ["mvcollection", "book"],
  ["incollection", "chapter"],
  ["suppcollection", "chapter"],
  ["dataset", "dataset"],
  ["manual", "book"],
  ["misc", "document"],
  ["online", "webpage"],
  ["electronic", "webpage"],
  ["www", "webpage"],
  ["patent", "patent"],
  ["periodical", "periodical"],
  ["suppperiodical", "article-journal"],
  ["proceedings", "book"],
  ["mvproceedings", "book"],
  ["inproceedings", "paper-conference"],
  ["conference", "paper-conference"],
  ["reference", "book"],
  ["mvreference", "book"],
  ["inreference", "entry-encyclopedia"],
  ["report", "report"],
  ["techreport", "report"],
  ["software", "software"],
  ["thesis", "thesis"],
  ["phdthesis", "thesis"],
  ["mastersthesis", "thesis"],
  ["unpublished", "manuscript"],
  ["standard", "standard"],
  ["artwork", "graphic"],
  ["image", "graphic"],
  ["audio", "song"],
  ["music", "song"],
  ["movie", "motion_picture"],
  ["video", "motion_picture"],
  ["performance", "performance"],
  ["jurisdiction", "legal_case"],
  ["legislation", "legislation"],
  ["legal", "treaty"],
  ["letter", "personal_communication"],
  ["review", "review"],
]);

/** An `@article`'s `entrysubtype` → its CSL article type. */
const ARTICLE_SUBTYPES = HashMap.fromIterable<string, CslItemType>([
  ["magazine", "article-magazine"],
  ["newspaper", "article-newspaper"],
]);

/** Entry types that sit inside a container (a book, collection, proceedings or reference work). */
const CONTAINED_KINDS = HashSet.make(
  "inbook",
  "bookinbook",
  "suppbook",
  "incollection",
  "suppcollection",
  "inproceedings",
  "conference",
  "inreference",
);

/** Entry types whose `number` is an issue number. */
const SERIAL_KINDS = HashSet.make("article", "periodical", "suppperiodical");

/**
 * BibLaTeX's `type` keys → their English genre; any other `type` is kept as
 * written. The BibTeX writer reads it in reverse.
 *
 * @since 1.0.0
 */
export const GENRES = HashMap.fromIterable<string, string>([
  ["phdthesis", "PhD thesis"],
  ["mathesis", "Master's thesis"],
  ["mastersthesis", "Master's thesis"],
  ["candthesis", "Candidate thesis"],
  ["techreport", "Technical report"],
  ["resreport", "Research report"],
  ["software", "Computer software"],
  ["datacd", "CD-ROM"],
  ["audiocd", "Audio CD"],
]);

/** The genre an entry type implies when it has no `type` field. */
const DEFAULT_GENRES = HashMap.fromIterable<string, string>([
  ["phdthesis", "PhD thesis"],
  ["mastersthesis", "Master's thesis"],
]);

/**
 * Babel / polyglossia language names → BCP 47 tags. The BibTeX writer reads
 * it in reverse.
 *
 * @since 1.0.0
 */
export const LANGUAGES = HashMap.fromIterable<string, string>([
  ["english", "en-US"],
  ["american", "en-US"],
  ["usenglish", "en-US"],
  ["british", "en-GB"],
  ["ukenglish", "en-GB"],
  ["australian", "en-AU"],
  ["canadian", "en-CA"],
  ["newzealand", "en-NZ"],
  ["german", "de-DE"],
  ["ngerman", "de-DE"],
  ["austrian", "de-AT"],
  ["naustrian", "de-AT"],
  ["swissgerman", "de-CH"],
  ["nswissgerman", "de-CH"],
  ["french", "fr-FR"],
  ["spanish", "es-ES"],
  ["italian", "it-IT"],
  ["dutch", "nl-NL"],
  ["portuguese", "pt-PT"],
  ["brazil", "pt-BR"],
  ["brazilian", "pt-BR"],
  ["russian", "ru-RU"],
  ["polish", "pl-PL"],
  ["swedish", "sv-SE"],
  ["danish", "da-DK"],
  ["norsk", "nb-NO"],
  ["norwegian", "nb-NO"],
  ["nynorsk", "nn-NO"],
  ["finnish", "fi-FI"],
  ["greek", "el-GR"],
  ["czech", "cs-CZ"],
  ["hungarian", "hu-HU"],
  ["japanese", "ja-JP"],
  ["chinese", "zh-CN"],
  ["korean", "ko-KR"],
  ["latin", "la"],
  ["catalan", "ca-AD"],
  ["turkish", "tr-TR"],
  ["hebrew", "he-IL"],
  ["arabic", "ar"],
]);

/** Fields whose value is not LaTeX text: only the escaped specials are unescaped. */
const VERBATIM_FIELDS = HashSet.make("url", "doi", "eprint", "pdf", "verba", "verbb", "verbc");

/** Fields dropped outright: `file` is a path on the exporting machine. */
const IGNORED_FIELDS = HashSet.make("file");

/** An entry being mapped: its fields, and the ones a mapping has used. */
interface Reader {
  readonly kind: string;
  readonly limits: BibtexLimits;
  readonly inherited: HashSet.HashSet<string>;
  readonly budget: Budget;
  readonly fields: HashMap.HashMap<string, string>;
  readonly consumed: MutableHashSet.MutableHashSet<string>;
}

/**
 * A field's source clamped to {@link MAX_SOURCE_LENGTH}. An inherited field
 * is charged to the document's budget and dropped once it is spent; an
 * entry's own fields are bounded by the input already.
 */
function budgeted(reader: Reader, key: string, source: string): Option.Option<string> {
  const clamped = source.slice(0, Math.max(MAX_SOURCE_LENGTH, reader.limits.maxFieldLength));
  const covered = !HashSet.has(reader.inherited, key) || spend(reader.budget, clamped.length);
  return covered ? Option.some(clamped) : Option.none();
}

/** Decodes LaTeX field source to sanitised text. */
const decodeText =
  (reader: Reader, key: string) =>
  (source: string): Option.Option<string> =>
    Option.flatMap(budgeted(reader, key, source), (clamped) =>
      sanitiseText(
        reader.limits.cslMarkup ? decodeLatexMarkup(clamped) : decodeLatex(clamped),
        reader.limits.maxFieldLength,
      ),
    );

/**
 * A verbatim value without the brace groups that wrap all of it
 * (`{10.1000/x}` → `10.1000/x`), as exporters write `doi = {{…}}`. Only
 * groups that span the whole value are removed: `{a}{b}` stays as it is. One
 * pass over the value whatever the nesting.
 */
function ungroup(value: string): string {
  const trimmed = value.trim();
  const wrapped = Math.min(
    /^\{*/.exec(trimmed)?.[0].length ?? 0,
    /\}*$/.exec(trimmed)?.[0].length ?? 0,
  );
  if (wrapped === 0 || wrapped * 2 > trimmed.length) return trimmed;
  const inner = trimmed.slice(wrapped, trimmed.length - wrapped);
  const lowest = Array.reduce(inner, { depth: 0, lowest: 0 }, (state, char) => {
    const depth = char === "{" ? state.depth + 1 : char === "}" ? state.depth - 1 : state.depth;
    return { depth, lowest: Math.min(state.lowest, depth) };
  }).lowest;
  const layers = wrapped + Math.max(lowest, -wrapped);
  return layers === 0 ? trimmed : trimmed.slice(layers, trimmed.length - layers).trim();
}

/**
 * Sanitises a verbatim field: the brace groups that wrap the whole value
 * removed, and `\_`, `\%`, `\#`, `\&`, `\$` and `\~` unescaped.
 */
const decodeVerbatim =
  (reader: Reader, key: string) =>
  (source: string): Option.Option<string> =>
    Option.flatMap(budgeted(reader, key, source), (clamped) =>
      sanitiseText(ungroup(clamped).replace(/\\([_%#&$~])/g, "$1"), reader.limits.maxFieldLength),
    );

/** A field's source, without marking it used. */
const peek = (reader: Reader, key: string): Option.Option<string> =>
  HashMap.get(reader.fields, key);

/** A field's source, marking it used. */
function take(reader: Reader, key: string): Option.Option<string> {
  const value = peek(reader, key);
  if (Option.isSome(value)) MutableHashSet.add(reader.consumed, key);
  return value;
}

/** A field as decoded text, marking it used. */
const text = (reader: Reader, key: string): Option.Option<string> =>
  Option.flatMap(take(reader, key), decodeText(reader, key));

/** The first present field of `keys` as decoded text; only that field is marked used. */
const firstText = (reader: Reader, keys: readonly string[]): Option.Option<string> =>
  Option.flatMap(
    Array.findFirst(keys, (key) => HashMap.has(reader.fields, key)),
    (key) => text(reader, key),
  );

/** Joins a title with its subtitle (`: `) and its addon (`. `). */
function joinTitle(
  title: Option.Option<string>,
  subtitle: Option.Option<string>,
  addon: Option.Option<string>,
): Option.Option<string> {
  return Option.map(title, (main) => {
    const withSubtitle = Option.match(subtitle, {
      onNone: () => main,
      onSome: (sub) => `${main}: ${sub}`,
    });
    return Option.match(addon, {
      onNone: () => withSubtitle,
      onSome: (add) => `${withSubtitle}. ${add}`,
    });
  });
}

/**
 * A `title`-family field group (`<prefix>title`, `<prefix>subtitle`,
 * `<prefix>titleaddon`) as one title; without its title, the subtitle and
 * addon are left for `extra`.
 */
const titleGroup = (reader: Reader, prefix: string): Option.Option<string> =>
  Option.isSome(peek(reader, `${prefix}title`))
    ? joinTitle(
        text(reader, `${prefix}title`),
        text(reader, `${prefix}subtitle`),
        text(reader, `${prefix}titleaddon`),
      )
    : Option.none();

/** The title, container and collection titles of an entry. */
interface Titles {
  readonly title: Option.Option<string>;
  readonly containerTitle: Option.Option<string>;
  readonly collectionTitle: Option.Option<string>;
}

/**
 * Reads the titles. The container is the journal, else the book (`booktitle`),
 * else, for a contained entry, the multi-volume work (`maintitle`). A
 * `maintitle` that is not the container is the collection title when there
 * is no `series`.
 */
function readTitles(reader: Reader): Titles {
  const title = titleGroup(reader, "");
  const journal = Option.orElse(
    Option.isSome(
      Array.findFirst(["journaltitle", "journal"], (key) => HashMap.has(reader.fields, key)),
    )
      ? joinTitle(
          firstText(reader, ["journaltitle", "journal"]),
          text(reader, "journalsubtitle"),
          Option.none(),
        )
      : Option.none(),
    () => titleGroup(reader, "book"),
  );
  const mainIsContainer = Option.isNone(journal) && HashSet.has(CONTAINED_KINDS, reader.kind);
  const series = text(reader, "series");
  const main =
    mainIsContainer || Option.isNone(series) ? titleGroup(reader, "main") : Option.none<string>();
  return {
    title,
    containerTitle: mainIsContainer ? Option.orElse(journal, () => main) : journal,
    collectionTitle: Option.orElse(series, () => (mainIsContainer ? Option.none() : main)),
  };
}

/** An entry's `number` and `issue`, placed by its type. */
interface Numbering {
  readonly issue: Option.Option<string>;
  readonly number: Option.Option<string>;
  readonly collectionNumber: Option.Option<string>;
}

/**
 * Places `number`: a serial's issue, a series volume's collection number, or
 * otherwise the item's own number (a report's or a standard's).
 */
function readNumbering(reader: Reader, inSeries: boolean): Numbering {
  if (HashSet.has(SERIAL_KINDS, reader.kind)) {
    return {
      issue: firstText(reader, ["number", "issue"]),
      number: Option.none(),
      collectionNumber: Option.none(),
    };
  }
  const number = text(reader, "number");
  return {
    issue: text(reader, "issue"),
    number: inSeries ? Option.none() : number,
    collectionNumber: inSeries ? number : Option.none(),
  };
}

/** The first checksum-valid token of an ISBN / ISSN field that may list several. */
function firstValid(
  reader: Reader,
  key: string,
  isValid: (candidate: string) => boolean,
): Option.Option<string> {
  return Option.flatMap(Option.flatMap(take(reader, key), decodeVerbatim(reader, key)), (value) =>
    Option.orElse(Array.findFirst(value.split(/[\s,;]+/), isValid), () => Option.some(value)),
  );
}

/** A name field, structured; records the field in `others` when it ends in `and others`. */
function readNames(
  reader: Reader,
  key: string,
  usePrefix: boolean,
  others: string[],
): readonly CslName[] {
  return Option.match(take(reader, key), {
    onNone: () => [],
    onSome: (source) => {
      return Option.match(budgeted(reader, key, source), {
        onNone: () => [],
        onSome: (clamped) => {
          const list = parseBibtexNames(clamped, usePrefix, reader.limits.maxAuthors);
          if (list.others) others.push(key);
          return list.names;
        },
      });
    },
  });
}

/** The CSL item type of an entry, refined by an `@article`'s `entrysubtype`. */
function itemType(reader: Reader): CslItemType {
  const base = Option.getOrElse(
    HashMap.get(ENTRY_TYPES, reader.kind),
    (): CslItemType => "document",
  );
  if (reader.kind !== "article") return base;
  return Option.getOrElse(
    Option.flatMap(take(reader, "entrysubtype"), (subtype) =>
      HashMap.get(ARTICLE_SUBTYPES, subtype.trim().toLowerCase()),
    ),
    () => base,
  );
}

/** True when the entry's `options` set `useprefix` (bare or `=true`). */
const usesPrefix = (reader: Reader): boolean =>
  Option.exists(peek(reader, "options"), (options) =>
    /(?:^|,)\s*useprefix\s*(?:=\s*true\s*)?(?:,|$)/i.test(options),
  );

/** The issued date: `date`, else `year` refined by `month` and `day`. */
function readIssued(reader: Reader): Option.Option<CslDate> {
  const date = Option.flatMap(take(reader, "date"), readBibtexDate);
  if (Option.isSome(date)) return date;
  return Option.flatMap(take(reader, "year"), (year) => {
    const month = Option.flatMap(peek(reader, "month"), readMonth);
    if (Option.isSome(month)) MutableHashSet.add(reader.consumed, "month");
    const day = Option.isSome(month)
      ? Option.flatMap(peek(reader, "day"), readDay)
      : Option.none<number>();
    if (Option.isSome(day)) MutableHashSet.add(reader.consumed, "day");
    return dateFromParts(year, month, day);
  });
}

/** A BibLaTeX date field (`urldate`, `origdate`, `eventdate`). */
const dateField = (reader: Reader, key: string): Option.Option<CslDate> =>
  Option.flatMap(take(reader, key), readBibtexDate);

/** The language as a BCP 47 tag: a Babel name mapped, a tag kept; any other value stays in `extra`. */
function readLanguage(reader: Reader): Option.Option<string> {
  return Option.flatMap(
    Array.findFirst(["langid", "language"], (key) =>
      Option.exists(peek(reader, key), (value) => Option.isSome(languageTag(value))),
    ),
    (key) => Option.flatMap(take(reader, key), languageTag),
  );
}

/** A language value as a BCP 47 tag, or `None`. */
function languageTag(value: string): Option.Option<string> {
  const clean = value.trim();
  return Option.orElse(HashMap.get(LANGUAGES, clean.toLowerCase()), () =>
    /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(clean) ? Option.some(clean) : Option.none(),
  );
}

/** The genre: the `type` field (a BibLaTeX key in English), else the entry type's default. */
function readGenre(reader: Reader): Option.Option<string> {
  const declared = Option.flatMap(text(reader, "type"), (value) =>
    Option.some(Option.getOrElse(HashMap.get(GENRES, value.toLowerCase()), () => value)),
  );
  return Option.orElse(declared, () => HashMap.get(DEFAULT_GENRES, reader.kind));
}

/** The note, with the `addendum` appended. */
function readNote(reader: Reader): Option.Option<string> {
  const note = text(reader, "note");
  const addendum = text(reader, "addendum");
  if (Option.isNone(note)) return addendum;
  return Option.some(
    Option.match(addendum, {
      onNone: () => note.value,
      onSome: (add) =>
        /[.?!]$/.test(note.value) ? `${note.value} ${add}` : `${note.value}. ${add}`,
    }),
  );
}

/** A `howpublished` value that is a link: a `\url{…}` or a bare `http(s)` URL. */
function howPublishedUrl(reader: Reader): Option.Option<string> {
  return Option.flatMap(peek(reader, "howpublished"), (value) => {
    const match = /^\s*(?:\\url\s*\{([^{}]*)\}|(https?:\/\/\S+))\s*$/.exec(value);
    if (match === null) return Option.none();
    MutableHashSet.add(reader.consumed, "howpublished");
    return decodeVerbatim(reader, "howpublished")(match[1] ?? match[2]);
  });
}

/** An `eprint` and how it maps: an arXiv id or a PubMed id. */
interface Eprint {
  readonly arxiv: Option.Option<string>;
  readonly pmid: Option.Option<string>;
}

/**
 * Reads `eprint` by its `eprinttype` (or BibTeX's `archiveprefix`) as a
 * valid arXiv or PubMed id; an unmapped kind or an invalid id stays in
 * `extra`.
 */
function readEprint(reader: Reader): Eprint {
  const kind = Option.map(
    Option.orElse(peek(reader, "eprinttype"), () => peek(reader, "archiveprefix")),
    (value) => value.trim().toLowerCase(),
  );
  const id = Option.flatMap(peek(reader, "eprint"), decodeVerbatim(reader, "eprint"));
  const as = (wanted: string, isValid: (value: string) => boolean): Option.Option<string> => {
    const valid = Option.filter(
      Option.filter(id, () => Option.exists(kind, (value) => value === wanted)),
      isValid,
    );
    if (Option.isSome(valid)) {
      Array.forEach(["eprint", "eprinttype", "archiveprefix"], (key) => {
        if (HashMap.has(reader.fields, key)) MutableHashSet.add(reader.consumed, key);
      });
    }
    return valid;
  };
  return {
    arxiv: as("arxiv", (value) => Option.isSome(decodeArxiv(value))),
    pmid: as("pubmed", (value) => Option.isSome(decodePmid(value))),
  };
}

/** A verbatim identifier field, consumed only when `isValid` accepts it (else it stays in `extra`). */
function validField(
  reader: Reader,
  key: string,
  isValid: (value: string) => boolean,
): Option.Option<string> {
  const value = Option.filter(
    Option.flatMap(peek(reader, key), decodeVerbatim(reader, key)),
    isValid,
  );
  if (Option.isSome(value)) MutableHashSet.add(reader.consumed, key);
  return value;
}

/** The further CSL text variables a BibLaTeX field fills, as `[variable, value]`. */
function cslVariables(reader: Reader, genre: Option.Option<string>, numbering: Numbering) {
  return [
    ["title-short", text(reader, "shorttitle")],
    ["container-title-short", text(reader, "shortjournal")],
    ["collection-number", numbering.collectionNumber],
    ["number-of-volumes", text(reader, "volumes")],
    ["number-of-pages", text(reader, "pagetotal")],
    ["chapter-number", text(reader, "chapter")],
    ["version", text(reader, "version")],
    ["genre", genre],
    ["keyword", text(reader, "keywords")],
    ["event-title", text(reader, "eventtitle")],
    ["event-place", text(reader, "venue")],
    ["original-title", text(reader, "origtitle")],
    ["original-publisher", text(reader, "origpublisher")],
    ["original-publisher-place", text(reader, "origlocation")],
    ["status", text(reader, "pubstate")],
    ["annote", firstText(reader, ["annotation", "annote"])],
  ] as const;
}

/** Every field no mapping used, as `tex.<field>` (decoded, or verbatim for a link field). */
function leftovers(reader: Reader): ReadonlyArray<readonly [string, string]> {
  return Array.filterMap(
    Array.fromIterable(reader.fields),
    ([key, source]): Result.Result<readonly [string, string], void> => {
      if (MutableHashSet.has(reader.consumed, key) || HashSet.has(IGNORED_FIELDS, key))
        return Result.failVoid;
      const value = HashSet.has(VERBATIM_FIELDS, key)
        ? decodeVerbatim(reader, key)(source)
        : decodeText(reader, key)(source);
      return Option.match(value, {
        onNone: () => Result.failVoid,
        onSome: (clean) => Result.succeed([`tex.${key}`, clean] as const),
      });
    },
  );
}

/** Sets each present value on the accumulator. */
function assignAll<K extends string, V>(
  target: Types.Mutable<Partial<Record<K, V>>>,
  values: ReadonlyArray<readonly [K, Option.Option<V>]>,
): void {
  Array.forEach(values, ([key, value]) => {
    if (Option.isSome(value)) target[key] = value.value;
  });
}

/** The record members beyond the shared field bag. */
function readAdditions(
  reader: Reader,
  titles: Titles,
  numbering: Numbering,
  arxiv: Option.Option<string>,
  others: string[],
): BibtexAdditions {
  const usePrefix = usesPrefix(reader);
  const additions: Types.Mutable<BibtexAdditions> = {};
  const translator = readNames(reader, "translator", usePrefix, others);
  const containerAuthor = readNames(reader, "bookauthor", usePrefix, others);
  if (Array.isReadonlyArrayNonEmpty(translator)) additions.translator = translator;
  if (Array.isReadonlyArrayNonEmpty(containerAuthor))
    additions["container-author"] = containerAuthor;
  assignAll(additions, [
    ["collection-title", titles.collectionTitle],
    ["number", Option.orElse(numbering.number, () => Option.map(arxiv, (id) => `arXiv:${id}`))],
    ["publisher-place", firstText(reader, ["location", "address"])],
    ["edition", text(reader, "edition")],
    ["abstract", text(reader, "abstract")],
    ["language", readLanguage(reader)],
    ["note", readNote(reader)],
  ]);
  assignAll(additions, [
    [
      "URL",
      Option.firstSomeOf([
        Option.flatMap(take(reader, "url"), decodeVerbatim(reader, "url")),
        howPublishedUrl(reader),
        Option.map(arxiv, (id) => `https://arxiv.org/abs/${id}`),
      ]),
    ],
  ]);
  assignAll(additions, [
    ["issued", readIssued(reader)],
    ["accessed", dateField(reader, "urldate")],
    ["original-date", dateField(reader, "origdate")],
    ["event-date", dateField(reader, "eventdate")],
  ]);
  assignAll(additions, cslVariables(reader, readGenre(reader), numbering));
  const extra: Types.Mutable<Record<string, unknown>> = {};
  if (Array.isArrayNonEmpty(others)) extra["tex.others"] = others;
  Array.forEach(leftovers(reader), ([key, value]) => {
    extra[key] = value;
  });
  if (!Record.isEmptyRecord(extra)) additions.extra = extra;
  return additions;
}

/** Maps one resolved entry, decoding against the document's budget. */
function mapEntry(entry: BibtexEntry, limits: BibtexLimits, budget: Budget): BibtexMapped {
  const reader: Reader = {
    kind: entry.kind,
    limits,
    inherited: entry.inherited,
    budget,
    fields: entry.fields,
    consumed: MutableHashSet.empty(),
  };
  const type = itemType(reader);
  const usePrefix = usesPrefix(reader);
  const others: string[] = [];
  const titles = readTitles(reader);
  const numbering = readNumbering(reader, Option.isSome(peek(reader, "series")));
  const eprint = readEprint(reader);
  const key = sanitiseText(entry.key, limits.maxFieldLength);
  const fields: RawFields = {
    type: Option.some(type),
    title: titles.title,
    subtitle: Option.none(),
    year: Option.none(),
    publisher: Option.orElse(
      firstText(reader, ["publisher", "institution", "school", "organization"]),
      () => (Option.isNone(howPublishedUrl(reader)) ? text(reader, "howpublished") : Option.none()),
    ),
    containerTitle: titles.containerTitle,
    volume: text(reader, "volume"),
    issue: numbering.issue,
    page: Option.flatMap(take(reader, "pages"), (pages) =>
      decodeText(reader, "pages")(pages.replace(/-{2,3}/g, "-")),
    ),
    isbn: firstValid(reader, "isbn", (candidate) => Option.isSome(decodeIsbn(candidate))),
    issn: firstValid(reader, "issn", (candidate) => Option.isSome(decodeIssn(candidate))),
    doi: Option.flatMap(take(reader, "doi"), decodeVerbatim(reader, "doi")),
    pmid: Option.orElse(eprint.pmid, () =>
      validField(reader, "pmid", (value) => Option.isSome(decodePmid(value))),
    ),
    pmcid: validField(reader, "pmcid", (value) => Option.isSome(decodePmcid(value))),
    arxiv: eprint.arxiv,
    id: key,
    citationKey: key,
    names: readNames(reader, "author", usePrefix, others),
    editors: readNames(reader, "editor", usePrefix, others),
  };
  return { fields, additions: readAdditions(reader, titles, numbering, eprint.arxiv, others) };
}

/**
 * Maps a document's resolved BibTeX / BibLaTeX entries to the shared field
 * bag and the further record members, under the caller's limits. Every
 * field is consumed by a mapping or kept in `extra`, except `file`;
 * decoding shares one budget across the document (or the `budget` a caller
 * shares across documents).
 *
 * @since 0.1.0
 */
export function mapBibtexEntries(
  entries: readonly BibtexEntry[],
  limits: BibtexLimits,
  budget: Budget = { remaining: DECODED_SOURCE_FACTOR * limits.maxInputLength },
): BibtexMapped[] {
  return Array.map(entries, (entry) => mapEntry(entry, limits, budget));
}
