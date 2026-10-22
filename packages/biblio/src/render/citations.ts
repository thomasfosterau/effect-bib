/**
 * In-text citation rendering: a whole document's citation clusters,
 * rendered in one pass with its bibliography.
 *
 * A pass over every cluster at once is what disambiguation needs: two works
 * by "Smith et al." in 2004 can only be told apart (more names, an initial,
 * or a year suffix `2004a` / `2004b` that the bibliography repeats) once
 * every citation is known. The pass also numbers a numeric style's sources
 * in order of first citation, and tracks each cite's position (first,
 * subsequent, ibid) for note styles.
 *
 * @copyright Thomas Foster
 * @module biblio/render/citations
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import { constant, constVoid } from "effect/Function";
import * as HashMap from "effect/HashMap";
import * as HashSet from "effect/HashSet";
import * as MutableHashMap from "effect/MutableHashMap";
import * as MutableHashSet from "effect/MutableHashSet";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as String from "effect/String";
import * as Struct from "effect/Struct";
import type { BiblioRecord, CslName } from "../record.ts";
import { citationName, givenInitials, issuedYearWithSuffix, plainField } from "./format.ts";
import { stripCslMarkup } from "./markup.ts";
import { enLocale } from "./locale.ts";
import { styleReference } from "./render.ts";
import { bold, concat, italic, joinRich, type RichText, text, toPlainText } from "./rich.ts";
import type {
  CitationStyle,
  Locale,
  LocatorLabel,
  RenderContext,
  RenderedBibliography,
  RenderOptions,
} from "./types.ts";

// ── Public types ──────────────────────────────────────────────────────

/**
 * How a cite shows its source: `normal` (`(Ray, 2004)`), `suppress-author`
 * (`(2004)`, when the text already names the author), `author-only` (`Ray`),
 * or `author-in-text` (`Ray (2004)`, a narrative citation).
 *
 * @since 0.1.0
 */
export type CiteMode = "normal" | "suppress-author" | "author-only" | "author-in-text";

/**
 * One cite in a citation cluster: the id of the record it cites, and an
 * optional locator, prefix, suffix and mode.
 *
 * @since 0.1.0
 */
export interface Cite {
  /** The id the record is keyed by in the records passed to {@link renderCitations}. */
  readonly id: string;
  /** The pinpoint, e.g. `"23"` or `"23-25"`. */
  readonly locator?: string;
  /** What the locator counts (default `"page"`). */
  readonly label?: LocatorLabel;
  /** Text before the cite, e.g. `"see"`. */
  readonly prefix?: string;
  /** Text after the cite, e.g. `"for a review"`. */
  readonly suffix?: string;
  /** Default `"normal"`. */
  readonly mode?: CiteMode;
}

/**
 * A citation cluster: the cites of one in-text citation (or one note), in
 * the order written.
 *
 * @since 0.1.0
 */
export interface CitationCluster {
  readonly cites: readonly Cite[];
}

/**
 * Where a cite falls relative to earlier cites of the same source: its
 * `first` citation, a `subsequent` one, or `ibid` (the same source as the
 * cite just before, `ibid-with-locator` when only the locator differs).
 *
 * @since 0.1.0
 */
export type CitePosition = "first" | "subsequent" | "ibid" | "ibid-with-locator";

/**
 * One rendered cluster.
 *
 * @since 0.1.0
 */
export interface RenderedCitation {
  /** The citation as rich text. */
  readonly rich: RichText;
  /** The citation as plain text. */
  readonly text: string;
  /** Each cite's position, in the cluster's order. */
  readonly positions: readonly CitePosition[];
}

/**
 * Options for {@link renderCitations}: the style and locale, and the records
 * to list in the bibliography without citing them.
 *
 * @since 0.1.0
 */
export interface RenderCitationsOptions extends RenderOptions {
  /** Ids to add to the bibliography uncited, or `"*"` for every record. */
  readonly nocite?: readonly string[] | "*";
}

/**
 * The output of a citation pass: one rendering per cluster, the
 * bibliography of everything cited (and `nocite`d), and the cited ids that
 * matched no record.
 *
 * @since 0.1.0
 */
export interface RenderedCitations {
  readonly citations: readonly RenderedCitation[];
  readonly bibliography: RenderedBibliography;
  readonly missing: readonly string[];
}

// ── Locators and affixes ─────────────────────────────────────────────

/** No term, for a label neither the locale nor US English names. */
const NO_TERMS: readonly [string, string] = ["", ""];

/** The locale's term for a locator label, plural for a range or list. */
function locatorTerm(locale: Locale, label: LocatorLabel, locator: string): string {
  const plural = /[-–,&]/.test(locator);
  const fromLocale = (terms: Locale["locators"]): Option.Option<readonly [string, string]> =>
    Option.flatMap(Option.fromNullishOr(terms), (map) => {
      const table: Readonly<Record<string, readonly [string, string]>> = map;
      return Record.get(table, label);
    });
  const terms = Option.getOrElse(
    Option.orElse(fromLocale(locale.locators), () => fromLocale(enLocale.locators)),
    constant(NO_TERMS),
  );
  if (label === "page") return plural ? locale.pages : locale.page;
  return plural ? terms[1] : terms[0];
}

/** `"p. 23"` for a cite with a locator (`"23"` when page labels are omitted), else `None`. */
function locatorText(cite: Cite, locale: Locale, omitPageLabel = false): Option.Option<string> {
  return Option.map(
    Option.filter(Option.fromNullishOr(cite.locator), (locator) =>
      String.isNonEmpty(locator.trim()),
    ),
    (locator) => {
      const label = cite.label ?? "page";
      const term =
        label === "page" && omitPageLabel ? "" : locatorTerm(locale, label, locator.trim());
      return String.isEmpty(term) ? locator.trim() : `${term} ${locator.trim()}`;
    },
  );
}

/** Wraps a rendered cite in its prefix and suffix. */
function withAffixes(cite: Cite, body: RichText): RichText {
  const prefix = (cite.prefix ?? "").trim();
  const suffix = (cite.suffix ?? "").trim();
  return concat(
    String.isEmpty(prefix) ? [] : text(`${prefix} `),
    body,
    String.isEmpty(suffix) ? [] : text(/^[,;.:]/.test(suffix) ? suffix : ` ${suffix}`),
  );
}

/** True when a cite carries a prefix or suffix. */
const hasAffix = (cite: Cite): boolean =>
  String.isNonEmpty((cite.prefix ?? "").trim()) || String.isNonEmpty((cite.suffix ?? "").trim());

// ── Names ─────────────────────────────────────────────────────────────

/** The first name with its initials (`J. Smith`), for given-name disambiguation. */
function initialledName(name: CslName): string {
  if (name.literal !== undefined || name.given === undefined) return citationName(name);
  return `${givenInitials(name.given, { periods: true, spaced: true })} ${citationName(name)}`;
}

/** How a record's names show in a citation. */
interface NameForm {
  /** How many names show before "et al."; every name when at least the list's length. */
  readonly shown: number;
  /** Whether the first name carries its initials. */
  readonly initials: boolean;
}

/** The resolved in-text settings of a style. */
interface InText {
  readonly etAlMin: number;
  readonly etAlUseFirst: number;
  readonly open: string;
  readonly close: string;
  readonly delimiter: string;
  readonly and: string;
  readonly locale: Locale;
}

/** A style's in-text settings with the category defaults filled in. */
function inTextSettings(style: CitationStyle, locale: Locale): InText {
  const format = style.citation ?? {};
  const numeric = style.category === "numeric";
  return {
    etAlMin: format.etAlMin ?? 3,
    etAlUseFirst: format.etAlUseFirst ?? 1,
    open: format.open ?? (numeric ? "[" : style.category === "note" ? "" : "("),
    close: format.close ?? (numeric ? "]" : style.category === "note" ? "" : ")"),
    delimiter: format.delimiter ?? (numeric ? ", " : "; "),
    and: format.and ?? "&",
    locale,
  };
}

/** The default name form: elided past `etAlMin`. */
const defaultForm = (names: readonly CslName[], settings: InText): NameForm => ({
  shown: names.length >= settings.etAlMin ? settings.etAlUseFirst : names.length,
  initials: false,
});

/** Joins every name: `A`, `A & B`, `A, B, & C`. */
function joinAll(forms: readonly string[], and: string): string {
  if (forms.length <= 2) return forms.join(` ${and} `);
  return `${forms.slice(0, -1).join(", ")}, ${and} ${forms[forms.length - 1]}`;
}

/** A record's names in a citation, joined with `and` (`"&"` in parentheses, the locale's word in prose). */
function citeNames(record: BiblioRecord, form: NameForm, and: string, locale: Locale): string {
  const names = record.author ?? record.editor ?? [];
  if (Array.isReadonlyArrayEmpty(names)) return stripCslMarkup(record.title ?? "");
  const forms = names.map((name, index) =>
    index === 0 && form.initials ? initialledName(name) : citationName(name),
  );
  if (form.shown >= forms.length) return joinAll(forms, and);
  const shown = forms.slice(0, Math.max(form.shown, 1));
  return shown.length === 1 ? `${shown[0]} ${locale.etAl}` : `${shown.join(", ")}, ${locale.etAl}`;
}

// ── Disambiguation ────────────────────────────────────────────────────

/** How one record is told apart from the others in its citations. */
interface Distinction {
  readonly form: NameForm;
  readonly suffix: string;
}

/** The year-suffix letters: `a` … `z`, then `aa`, `ab`, …. */
function suffixLetter(index: number): string {
  const letter = (n: number): string => "abcdefghijklmnopqrstuvwxyz".charAt(n);
  return index < 26 ? letter(index) : `${letter(Math.floor(index / 26) - 1)}${letter(index % 26)}`;
}

/** The citation form two records are compared by: their names and their year. */
function ambiguityKey(record: BiblioRecord, form: NameForm, settings: InText): string {
  return `${citeNames(record, form, settings.and, settings.locale)}\u0000${issuedYearWithSuffix(record, { locale: settings.locale })}`;
}

/** Groups ids by their citation form under `forms`, keeping the bibliography order. */
function ambiguousGroups(
  ids: readonly string[],
  records: HashMap.HashMap<string, BiblioRecord>,
  forms: (id: string) => NameForm,
  settings: InText,
): string[][] {
  const groups = Array.reduce(ids, HashMap.empty<string, string[]>(), (map, id) => {
    const key = ambiguityKey(HashMap.getUnsafe(records, id), forms(id), settings);
    return HashMap.set(map, key, [...Option.getOrElse(HashMap.get(map, key), () => []), id]);
  });
  return Array.filter(Array.fromIterable(HashMap.values(groups)), (group) => group.length > 1);
}

/** The number of distinct citation forms a group has under `forms`. */
function distinctCount(
  group: readonly string[],
  records: HashMap.HashMap<string, BiblioRecord>,
  forms: (id: string) => NameForm,
  settings: InText,
): number {
  return HashSet.size(
    HashSet.fromIterable(
      group.map((id) => ambiguityKey(HashMap.getUnsafe(records, id), forms(id), settings)),
    ),
  );
}

/** The form of an id with no record (never reached: every id has one). */
const NO_NAMES: NameForm = { shown: 0, initials: false };

/** The largest of some counts (0 for none), without spreading them into arguments. */
const maximum = (values: readonly number[]): number =>
  Array.reduce(values, 0, (largest, value) => Math.max(largest, value));

/**
 * Disambiguates a document's records the way CSL's author-date styles do:
 * first show more names (the fewest that tell the most records apart), then
 * the first author's initials, then give the records still alike year
 * suffixes in bibliography order.
 */
function disambiguate(
  ids: readonly string[],
  records: HashMap.HashMap<string, BiblioRecord>,
  settings: InText,
): HashMap.HashMap<string, Distinction> {
  const namesOf = (id: string) =>
    HashMap.getUnsafe(records, id).author ?? HashMap.getUnsafe(records, id).editor ?? [];
  const forms = MutableHashMap.fromIterable(
    ids.map((id) => [id, defaultForm(namesOf(id), settings)] as const),
  );
  const formOf = (id: string): NameForm =>
    Option.getOrElse(MutableHashMap.get(forms, id), constant(NO_NAMES));
  Array.forEach(ambiguousGroups(ids, records, formOf, settings), (group) => {
    const longest = maximum(group.map((id) => namesOf(id).length));
    const counts = Array.makeBy(longest + 1, (shown) =>
      distinctCount(
        group,
        records,
        (id) => ({ ...formOf(id), shown: Math.max(formOf(id).shown, shown) }),
        settings,
      ),
    );
    const best = counts.indexOf(maximum(counts));
    if (counts[best] > distinctCount(group, records, formOf, settings)) {
      Array.forEach(group, (id) =>
        MutableHashMap.set(forms, id, { ...formOf(id), shown: Math.max(formOf(id).shown, best) }),
      );
    }
  });
  Array.forEach(ambiguousGroups(ids, records, formOf, settings), (group) => {
    const withInitials = (id: string): NameForm => ({ ...formOf(id), initials: true });
    if (
      distinctCount(group, records, withInitials, settings) >
      distinctCount(group, records, formOf, settings)
    ) {
      Array.forEach(group, (id) => MutableHashMap.set(forms, id, withInitials(id)));
    }
  });
  const suffixes = MutableHashMap.empty<string, string>();
  Array.forEach(ambiguousGroups(ids, records, formOf, settings), (group) =>
    Array.forEach(group, (id, index) => MutableHashMap.set(suffixes, id, suffixLetter(index))),
  );
  return HashMap.fromIterable(
    ids.map(
      (id) =>
        [
          id,
          {
            form: formOf(id),
            suffix: Option.getOrElse(MutableHashMap.get(suffixes, id), () => ""),
          },
        ] as const,
    ),
  );
}

// ── Positions ─────────────────────────────────────────────────────────

/** What position tracking remembers: the cite just made, and the size of the cluster it ended. */
interface PositionState {
  previous: Option.Option<Cite>;
  previousClusterSize: number;
}

/** The positions of every cite in every cluster, per CSL 1.0.2. */
function citePositions(clusters: readonly CitationCluster[]): CitePosition[][] {
  const seen = MutableHashSet.empty<string>();
  const state: PositionState = {
    previous: Option.none(),
    previousClusterSize: 0,
  };
  return clusters.map((cluster) => {
    const positions = cluster.cites.map((cite, index): CitePosition => {
      const position = positionOf(
        cite,
        index === 0 ? state.previousClusterSize : 1,
        state.previous,
        seen,
      );
      MutableHashSet.add(seen, cite.id);
      state.previous = Option.some(cite);
      return position;
    });
    state.previousClusterSize = cluster.cites.length;
    if (Array.isReadonlyArrayEmpty(cluster.cites)) state.previous = Option.none();
    return positions;
  });
}

/**
 * One cite's position. It is `ibid` when the cite just before (in this
 * cluster, or alone in the cluster before) cites the same source: plain
 * `ibid` when their locators match, `ibid-with-locator` when this one adds
 * or changes a locator, and `subsequent` when only the earlier one had a
 * locator.
 */
function positionOf(
  cite: Cite,
  precedingCount: number,
  previous: Option.Option<Cite>,
  seen: MutableHashSet.MutableHashSet<string>,
): CitePosition {
  if (!MutableHashSet.has(seen, cite.id)) return "first";
  const before = Option.filter(previous, (prior) => prior.id === cite.id && precedingCount === 1);
  if (Option.isNone(before)) return "subsequent";
  const locator = (cite.locator ?? "").trim();
  const priorLocator = (before.value.locator ?? "").trim();
  if (locator === priorLocator) return "ibid";
  return String.isEmpty(locator) ? "subsequent" : "ibid-with-locator";
}

// ── Rendering clusters ────────────────────────────────────────────────

/** Everything a cluster renderer reads. */
interface Pass {
  readonly style: CitationStyle;
  readonly settings: InText;
  readonly records: HashMap.HashMap<string, BiblioRecord>;
  readonly distinctions: HashMap.HashMap<string, Distinction>;
  readonly numbers: HashMap.HashMap<string, number>;
}

/** The render context of one record: the locale and its year suffix. */
function contextOf(pass: Pass, id: string): RenderContext {
  const suffix = Option.getOrElse(
    Option.map(HashMap.get(pass.distinctions, id), (d) => d.suffix),
    () => "",
  );
  return String.isEmpty(suffix)
    ? { locale: pass.settings.locale }
    : { locale: pass.settings.locale, yearSuffix: suffix };
}

/** A record's names in the citation, in its disambiguated form. */
function namesOf(pass: Pass, record: BiblioRecord, id: string, and: string): string {
  const form = Option.getOrElse(
    Option.map(HashMap.get(pass.distinctions, id), (d) => d.form),
    () => defaultForm(record.author ?? record.editor ?? [], pass.settings),
  );
  return citeNames(record, form, and, pass.settings.locale);
}

/** A cite whose id matches no record: its id and a question mark, in bold. */
const missingCite = (cite: Cite): RichText => bold(text(`${cite.id}?`));

/** The narrative names of a cite (`Ray`, `Smith and Jones`). */
function narrativeNames(pass: Pass, cite: Cite): RichText {
  return Option.match(HashMap.get(pass.records, cite.id), {
    onNone: () => missingCite(cite),
    onSome: (record) => text(namesOf(pass, record, cite.id, pass.settings.locale.and)),
  });
}

/** An author-date cite in parentheses: `Ray, 2004, p. 5`, or `2004, p. 5` without the author. */
function authorDateCite(
  pass: Pass,
  cite: Cite,
  withAuthor: boolean,
): { readonly names: string; readonly rest: RichText } {
  return Option.match(HashMap.get(pass.records, cite.id), {
    onNone: () => ({ names: "", rest: missingCite(cite) }),
    onSome: (record) => {
      const year = issuedYearWithSuffix(record, contextOf(pass, cite.id));
      const rest = joinRich(
        [Option.some(text(year)), Option.map(locatorText(cite, pass.settings.locale), text)],
        ", ",
      );
      return { names: withAuthor ? namesOf(pass, record, cite.id, pass.settings.and) : "", rest };
    },
  });
}

/**
 * The inside of an author-date parenthesis: cites by the same author run
 * together (`Smith, 2001, 2004`), and groups are joined by the delimiter.
 */
function authorDateGroups(
  pass: Pass,
  cites: readonly Cite[],
  withAuthor: (cite: Cite) => boolean,
): RichText {
  const rendered = cites.map((cite) => ({ cite, ...authorDateCite(pass, cite, withAuthor(cite)) }));
  const start: (typeof rendered)[number][][] = [];
  const groups = Array.reduce(rendered, start, (all, item) => {
    const last = all[all.length - 1];
    const previous = last?.[last.length - 1];
    const joins =
      previous !== undefined &&
      String.isNonEmpty(item.names) &&
      item.names === previous.names &&
      !hasAffix(item.cite) &&
      !hasAffix(previous.cite);
    if (joins) last.push(item);
    else all.push([item]);
    return all;
  });
  return joinRich(
    groups.map((group) => {
      const years = joinRich(
        group.map((item) => Option.some(item.rest)),
        ", ",
      );
      const body = String.isEmpty(group[0].names)
        ? years
        : concat(text(`${group[0].names}, `), years);
      return Option.some(withAffixes(group[0].cite, body));
    }),
    pass.settings.delimiter,
  );
}

/** Wraps a citation body in the style's open and close affixes. */
const enclose = (pass: Pass, body: RichText): RichText =>
  concat(text(pass.settings.open), body, text(pass.settings.close));

/** Sorts a parenthetical cluster's cites by the style's sort key (stable). */
function sortCites(pass: Pass, cites: readonly Cite[]): readonly Cite[] {
  return Array.sortWith(
    cites,
    (cite) =>
      Option.getOrElse(
        Option.map(HashMap.get(pass.records, cite.id), pass.style.sortKey),
        () => cite.id,
      ),
    Order.String,
  );
}

/**
 * An author-date cluster. A leading `author-only` cite is its names, then
 * the rest in parentheses; a leading `author-in-text` cite is its names,
 * then its year and the rest in parentheses (`Ray (2004; Smith, 2010)`).
 */
function renderAuthorDate(pass: Pass, cites: readonly Cite[]): RichText {
  const [first, ...rest] = cites;
  const mode = first?.mode ?? "normal";
  if (first !== undefined && (mode === "author-only" || mode === "author-in-text")) {
    const inParentheses =
      mode === "author-in-text"
        ? [{ ...Struct.omit(first, ["prefix"]), mode: "suppress-author" as const }, ...rest]
        : rest;
    const lead = withAffixes(Struct.omit(first, ["suffix"]), narrativeNames(pass, first));
    const tail = Array.isReadonlyArrayEmpty(inParentheses)
      ? []
      : concat(
          text(" "),
          enclose(
            pass,
            authorDateGroups(pass, inParentheses, (cite) => cite.mode !== "suppress-author"),
          ),
        );
    return concat(lead, tail);
  }
  const ordered = cites.some(hasAffix) ? cites : sortCites(pass, cites);
  return enclose(
    pass,
    authorDateGroups(pass, ordered, (cite) => cite.mode !== "suppress-author"),
  );
}

/** A numeric cite: its number and locator (`1, p. 5`). */
function numericCite(pass: Pass, cite: Cite): RichText {
  return Option.match(HashMap.get(pass.numbers, cite.id), {
    onNone: () => missingCite(cite),
    onSome: (number) =>
      withAffixes(
        cite,
        joinRich(
          [
            Option.some(text(`${number}`)),
            Option.map(locatorText(cite, pass.settings.locale), text),
          ],
          ", ",
        ),
      ),
  });
}

/** Compresses sorted numbers into runs: `1–3, 5` (a run needs three numbers). */
function compressNumbers(numbers: readonly number[]): string[] {
  const start: number[][] = [];
  const runs = Array.reduce(numbers, start, (all, number) => {
    const last = all[all.length - 1];
    if (last !== undefined && number === last[last.length - 1] + 1) last.push(number);
    else if (last === undefined || number !== last[last.length - 1]) all.push([number]);
    return all;
  });
  return runs.flatMap((run) =>
    run.length >= 3 ? [`${run[0]}–${run[run.length - 1]}`] : run.map((number) => `${number}`),
  );
}

/**
 * A numeric cluster: plain cites sorted and compressed (`[1–3, 5]`), cites
 * with a locator or affix kept as written; an `author-only` cite is its
 * names, and an `author-in-text` cite its names then its number.
 */
function renderNumeric(pass: Pass, cites: readonly Cite[]): RichText {
  const [first, ...rest] = cites;
  const mode = first?.mode ?? "normal";
  if (first !== undefined && (mode === "author-only" || mode === "author-in-text")) {
    const inBrackets = mode === "author-in-text" ? [Struct.omit(first, ["prefix"]), ...rest] : rest;
    const tail = Array.isReadonlyArrayEmpty(inBrackets)
      ? []
      : concat(text(" "), numericCluster(pass, inBrackets));
    return concat(withAffixes(Struct.omit(first, ["suffix"]), narrativeNames(pass, first)), tail);
  }
  return numericCluster(pass, cites);
}

/** The bracketed part of a numeric cluster. */
function numericCluster(pass: Pass, cites: readonly Cite[]): RichText {
  const plain = cites.filter(
    (cite) => !hasAffix(cite) && Option.isNone(locatorText(cite, pass.settings.locale)),
  );
  const plainNumbers = Array.sortWith(
    Array.getSomes(plain.map((cite) => HashMap.get(pass.numbers, cite.id))),
    (number) => number,
    Order.Number,
  );
  const unnumbered = plain.filter((cite) => !HashMap.has(pass.numbers, cite.id));
  const parts = [
    ...compressNumbers(plainNumbers).map((run) => Option.some(text(run))),
    ...unnumbered.map((cite) => Option.some(missingCite(cite))),
    ...cites
      .filter((cite) => !plain.includes(cite))
      .map((cite) => Option.some(numericCite(pass, cite))),
  ];
  return enclose(pass, joinRich(parts, pass.settings.delimiter));
}

/** Drops one trailing period, so a locator can follow a reference. */
function withoutFinalPeriod(rich: RichText): RichText {
  const plain = toPlainText(rich);
  if (!plain.endsWith(".")) return rich;
  const last = rich[rich.length - 1];
  if (last?._tag !== "Text") return rich;
  return [...rich.slice(0, -1), ...text(last.text.slice(0, -1))];
}

/** A note style's short form: the first author's name and the title before any colon. */
function defaultShort(record: BiblioRecord): RichText {
  const first = Array.head(record.author ?? record.editor ?? []);
  const title = Option.map(plainField(record, "title"), (value) =>
    italic(text(value.split(":")[0].trim())),
  );
  return joinRich([Option.map(first, (name) => text(citationName(name))), title], ", ");
}

/**
 * Appends a punctuation mark to a note's form, inside a closing quotation
 * mark as US style puts it (`“Title,”`), and not at all after a form that
 * already ends in punctuation.
 */
function punctuate(rich: RichText, mark: string): RichText {
  const plain = toPlainText(rich);
  const last = rich[rich.length - 1];
  if (plain.endsWith("”") && last?._tag === "Text") {
    const inner = last.text.slice(0, -1);
    return /[.,?!]$/.test(inner) ? rich : [...rich.slice(0, -1), ...text(`${inner}${mark}”`)];
  }
  return /[.?!]$/.test(plain) && mark === "." ? rich : concat(rich, text(mark));
}

/** The ibid term, capitalised at the start of a note. */
function ibidTerm(locale: Locale, atStart: boolean): string {
  const term = locale.ibid ?? enLocale.ibid ?? "ibid.";
  return atStart ? `${term.charAt(0).toUpperCase()}${term.slice(1)}` : term;
}

/** One cite in a note, in the form its position calls for. */
function noteCite(pass: Pass, cite: Cite, position: CitePosition, atStart: boolean): RichText {
  if ((cite.mode ?? "normal") === "author-only")
    return withAffixes(cite, narrativeNames(pass, cite));
  return Option.match(HashMap.get(pass.records, cite.id), {
    onNone: () => withAffixes(cite, missingCite(cite)),
    onSome: (record) => {
      const ctx = contextOf(pass, cite.id);
      const format = pass.style.citation ?? {};
      const locator = Option.map(
        locatorText(cite, pass.settings.locale, format.omitPageLabel ?? false),
        text,
      );
      const isIbid = position === "ibid" || position === "ibid-with-locator";
      const form = isIbid
        ? text(ibidTerm(pass.settings.locale, atStart && !hasAffix(cite)))
        : withoutFinalPeriod(
            position === "first"
              ? (format.noteFull ?? ((r, c) => styleReference(pass.style, r, c)))(record, ctx)
              : (format.noteShort ?? defaultShort)(record, ctx),
          );
      const body = Option.match(position === "ibid" ? Option.none() : locator, {
        onNone: () => form,
        onSome: (pinpoint) => concat(punctuate(form, ","), text(" "), pinpoint),
      });
      return withAffixes(cite, body);
    },
  });
}

/** A note: its cites by position, joined by the delimiter and ended with a period. */
function renderNote(
  pass: Pass,
  cites: readonly Cite[],
  positions: readonly CitePosition[],
): RichText {
  const parts = cites.map((cite, index) =>
    Option.some(noteCite(pass, cite, positions[index] ?? "first", index === 0)),
  );
  return punctuate(joinRich(parts, pass.settings.delimiter), ".");
}

// ── The pass ──────────────────────────────────────────────────────────

/** Ids in first-appearance order, each once. */
function uniqueInOrder(ids: Iterable<string>): string[] {
  const seen = MutableHashSet.empty<string>();
  return Array.filter(Array.fromIterable(ids), (id) => {
    if (MutableHashSet.has(seen, id)) return false;
    MutableHashSet.add(seen, id);
    return true;
  });
}

/**
 * The bibliography's ids in display order: cited then `nocite`d, numbered in
 * that order for a numeric style, sorted by the style's key otherwise.
 */
function bibliographyIds(
  cited: readonly string[],
  allIds: readonly string[],
  options: RenderCitationsOptions,
  records: HashMap.HashMap<string, BiblioRecord>,
): string[] {
  const extra = options.nocite === "*" ? allIds : (options.nocite ?? []);
  const ids = uniqueInOrder([...cited, ...extra.filter((id) => HashMap.has(records, id))]);
  if (options.style.category === "numeric") return ids;
  return Array.sortWith(
    ids,
    (id) => options.style.sortKey(HashMap.getUnsafe(records, id)),
    Order.String,
  );
}

/**
 * Renders a document's citation clusters and its bibliography in one pass.
 *
 * Records are keyed by the id each cite names (a `Map`, or any iterable of
 * `[id, record]` pairs); a cite of an unknown id renders as the id and a
 * question mark in bold, and is listed in `missing`. Author-date styles
 * group a cluster's cites by author (`Smith, 2001, 2004`) and disambiguate
 * across the document: more names, then initials, then a year suffix
 * (`2004a`) that the bibliography repeats. Numeric styles number sources in
 * order of first citation and compress runs (`[1–3, 5]`). Note styles render
 * a source's first note in full, later notes short, and a repeat of the
 * source just cited as "ibid.". `nocite` adds uncited records to the
 * bibliography.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { apaStyle, fromCslJson, renderCitations, vancouverStyle } from "@thomasfosterau/biblio"
 *
 * const records = new Map([
 *   ["ray2004", fromCslJson({ type: "article-journal", title: "Can loneliness be lethal?", author: [{ family: "Ray", given: "Oakley" }], issued: { "date-parts": [[2004]] } })],
 *   ["smith2001", fromCslJson({ type: "book", title: "First", author: [{ family: "Smith", given: "Jo" }], issued: { "date-parts": [[2001]] } })],
 *   ["smith2004a", fromCslJson({ type: "book", title: "Second", author: [{ family: "Smith", given: "Jo" }], issued: { "date-parts": [[2004]] } })],
 *   ["smith2004b", fromCslJson({ type: "book", title: "Third", author: [{ family: "Smith", given: "Jo" }], issued: { "date-parts": [[2004]] } })],
 * ])
 * const clusters = [
 *   { cites: [{ id: "smith2004b" }, { id: "ray2004", locator: "5" }, { id: "smith2001" }] },
 *   { cites: [{ id: "ray2004", mode: "author-in-text" as const }] },
 *   { cites: [{ id: "smith2004a" }] },
 * ]
 *
 * const apa = renderCitations(clusters, records, { style: apaStyle })
 * assert.deepStrictEqual(apa.citations.map((citation) => citation.text), [
 *   "(Ray, 2004, p. 5; Smith, 2001, 2004b)",
 *   "Ray (2004)",
 *   "(Smith, 2004a)",
 * ])
 * assert.strictEqual(apa.bibliography.entries[3]?.text, "Smith, J. (2004b). Third.")
 *
 * const vancouver = renderCitations(clusters, records, { style: vancouverStyle })
 * assert.deepStrictEqual(vancouver.citations.map((citation) => citation.text), ["[1, 3, 2, p. 5]", "Ray [2]", "[4]"])
 * ```
 *
 * @since 0.1.0
 */
export function renderCitations(
  clusters: readonly CitationCluster[],
  records: Iterable<readonly [string, BiblioRecord]>,
  options: RenderCitationsOptions,
): RenderedCitations {
  const entries = Array.fromIterable(records);
  const byId = HashMap.fromIterable(entries);
  const locale = options.locale ?? enLocale;
  const settings = inTextSettings(options.style, locale);
  const citedIds = uniqueInOrder(
    clusters.flatMap((cluster) => cluster.cites.map((cite) => cite.id)),
  );
  const cited = citedIds.filter((id) => HashMap.has(byId, id));
  const ids = bibliographyIds(cited, uniqueInOrder(entries.map(([id]) => id)), options, byId);
  const pass: Pass = {
    style: options.style,
    settings,
    records: byId,
    distinctions:
      options.style.category === "author-date"
        ? disambiguate(ids, byId, settings)
        : HashMap.empty(),
    numbers: HashMap.fromIterable(ids.map((id, index) => [id, index + 1] as const)),
  };
  const positions = citePositions(clusters);
  const citations = clusters.map((cluster, index): RenderedCitation => {
    const clusterPositions = positions[index] ?? [];
    const rich =
      options.style.category === "numeric"
        ? renderNumeric(pass, cluster.cites)
        : options.style.category === "note"
          ? renderNote(pass, cluster.cites, clusterPositions)
          : renderAuthorDate(pass, cluster.cites);
    return { rich, text: toPlainText(rich), positions: clusterPositions };
  });
  return {
    citations,
    bibliography: bibliographyOf(pass, ids),
    missing: citedIds.filter((id) => !HashMap.has(byId, id)),
  };
}

/** The bibliography of a pass: every id rendered with its year suffix, labelled for numeric styles. */
function bibliographyOf(pass: Pass, ids: readonly string[]): RenderedBibliography {
  const { style } = pass;
  return {
    style: style.id,
    entries: Array.filterMap(ids, (id, index) =>
      Result.fromOption(
        Option.map(HashMap.get(pass.records, id), (record) => {
          const ctx = contextOf(pass, id);
          const rich = styleReference(style, record, ctx);
          return {
            index: index + 1,
            label:
              style.category === "numeric" ? Option.some(`${index + 1}.`) : Option.none<string>(),
            text:
              style.reference !== undefined
                ? toPlainText(rich)
                : style.renderReference(record, ctx),
            rich,
            id,
          };
        }),
        constVoid,
      ),
    ),
  };
}
