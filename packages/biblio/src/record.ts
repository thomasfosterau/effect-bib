/**
 * The CSL-aligned bibliographic record — the neutral centre of the toolkit.
 *
 * A {@link BiblioRecord} is a typed **superset of CSL-JSON**: its core is
 * the closed CSL 1.0.2 vocabulary (item types, standard/name/date
 * variables) modelled as Effect Schema, and its additions are strictly
 * additive — first-class **validated identifiers** (the {@link Isbn} /
 * {@link Doi} / {@link Issn} / {@link Orcid} / {@link Pmid} / {@link Pmcid} /
 * {@link Arxiv} brands), a **source
 * provenance** envelope, and an `extra` map that passes through CSL
 * variables the model does not consume. Two total functions at the interop
 * boundary make "typed superset" precise: {@link toCslJson} projects a
 * record to plain, schema-valid CSL-JSON (dropping provenance, re-merging
 * `extra`), and {@link fromCslJson} leniently decodes any CSL-JSON item into
 * a record (validating identifiers where present, capturing unknown keys),
 * never throwing on partial or hostile input.
 *
 * The package stops at the CSL record: mapping it onto an application's own
 * data model is the application's job. Everything here is pure and
 * persistence-free.
 *
 * @copyright Thomas Foster
 * @module biblio/record
 * @since 0.1.0
 */

// See website#1069.

import * as Array from "effect/Array";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as String from "effect/String";
import * as Struct from "effect/Struct";
import type * as Types from "effect/Types";
import {
  Arxiv,
  Doi,
  decodeArxiv,
  decodeDoi,
  decodeIsbn,
  decodeIssn,
  decodeOrcid,
  decodePmcid,
  decodePmid,
  Isbn,
  Issn,
  Orcid,
  Pmcid,
  Pmid,
} from "./identifiers.ts";
import { limitOr } from "./limits.ts";

// ── Field bounds & untrusted-text sanitisers ────────────────────────

/**
 * The default upper bound, in UTF-16 code units, on any free-text field
 * taken from untrusted input; longer values are truncated, so a hostile or
 * malformed value can't push an unbounded blob downstream. A caller raises
 * it per call with {@link RecordLimits}.
 *
 * @since 0.1.0
 */
export const MAX_TEXT_FIELD_LENGTH = 2000;

/**
 * The default cap on how many names one name variable keeps (the rest are
 * dropped). A caller raises it per call with {@link RecordLimits}.
 *
 * @since 0.1.0
 */
export const MAX_AUTHORS = 100;

/** The most `categories` one record keeps. */
const MAX_CATEGORIES = 100;

/**
 * The bounds a decoder applies to one record, each defaulting to today's
 * constant: `maxFieldLength` ({@link MAX_TEXT_FIELD_LENGTH}) clamps every
 * free-text value, `maxAuthors` ({@link MAX_AUTHORS}) every name list. Raise
 * them for a document's bibliography, where an abstract runs long or a
 * collaboration lists hundreds of authors; a non-positive or non-integer
 * value falls back to the default.
 *
 * @since 1.0.0
 */
export interface RecordLimits {
  readonly maxFieldLength?: number;
  readonly maxAuthors?: number;
}

/** The narrowest plausible publication year we accept. */
const MIN_PUBLICATION_YEAR = 1;
/** Guard against absurd future years. */
const MAX_PUBLICATION_YEAR = 2200;

/**
 * Trims an untrusted free-text value, collapses its whitespace and clamps
 * it to `maxLength` (default {@link MAX_TEXT_FIELD_LENGTH}).
 * `Option.none()` for empty / whitespace-only or non-string input.
 *
 * @since 0.1.0
 */
export function sanitiseText(
  // oxlint-disable-next-line effect/no-unknown-parameters -- untrusted-input boundary: a total sanitiser over any upstream value (see "The untrusted-input boundary" in packages/biblio/CLAUDE.md)
  value: unknown,
  maxLength: number = MAX_TEXT_FIELD_LENGTH,
): Option.Option<string> {
  if (!Predicate.isString(value)) return Option.none();
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (String.isEmpty(collapsed)) return Option.none();
  return Option.some(collapsed.slice(0, limitOr(Option.some(maxLength), MAX_TEXT_FIELD_LENGTH)));
}

/**
 * Coerces an untrusted value to a plausible publication year, or
 * `Option.none()`. Accepts a number or a numeric string; rejects
 * non-integers and years outside {@link MIN_PUBLICATION_YEAR} …
 * {@link MAX_PUBLICATION_YEAR}.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line effect/no-unknown-parameters -- untrusted-input boundary: a total sanitiser over any upstream value (see "The untrusted-input boundary" in packages/biblio/CLAUDE.md)
export function sanitiseYear(value: unknown): Option.Option<number> {
  const n = Predicate.isNumber(value) ? value : Predicate.isString(value) ? Number(value) : NaN;
  if (!Number.isInteger(n)) return Option.none();
  if (n < MIN_PUBLICATION_YEAR || n > MAX_PUBLICATION_YEAR) return Option.none();
  return Option.some(n);
}

/** A CSL string variable as upstreams send it: text, or a finite number (e.g. `volume`). */
const decodeCslStringValue = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Finite]),
);

/** Sanitises a CSL string variable that upstreams may send as a number (e.g. `volume`). */
function sanitiseCslString(
  value: Option.Option<string | number>,
  maxLength: number,
): Option.Option<string> {
  return Option.flatMap(value, (text) => sanitiseText(text.toString(), maxLength));
}

// ── CSL vocabulary (modelled from the spec, not invented) ─────────────

/**
 * The CSL 1.0.2 item types, a closed enumeration. Every type round-trips,
 * even those the render styles treat generically, so an external tool's
 * type is never lost. `document` is the fallback
 * {@link fromCslJson} assigns to an unknown or missing type.
 *
 * @since 0.1.0
 */
export const CslItemType = Schema.Literals([
  "article",
  "article-journal",
  "article-magazine",
  "article-newspaper",
  "bill",
  "book",
  "broadcast",
  "chapter",
  "classic",
  "collection",
  "dataset",
  "document",
  "entry",
  "entry-dictionary",
  "entry-encyclopedia",
  "event",
  "figure",
  "graphic",
  "hearing",
  "interview",
  "legal_case",
  "legislation",
  "manuscript",
  "map",
  "motion_picture",
  "musical_score",
  "pamphlet",
  "paper-conference",
  "patent",
  "performance",
  "periodical",
  "personal_communication",
  "post",
  "post-weblog",
  "regulation",
  "report",
  "review",
  "review-book",
  "software",
  "song",
  "speech",
  "standard",
  "thesis",
  "treaty",
  "webpage",
]);
/**
 * @since 0.1.0
 */
export type CslItemType = typeof CslItemType.Type;

const CSL_ITEM_TYPES: HashSet.HashSet<string> = HashSet.fromIterable(CslItemType.literals);

/**
 * Narrows an arbitrary string to a known CSL item type.
 *
 * @since 0.1.0
 */
export function isCslItemType(value: string): value is CslItemType {
  return HashSet.has(CSL_ITEM_TYPES, value);
}

/**
 * A CSL structured name, plus the superset `orcid` (a checksum-validated
 * contributor identity).
 *
 * @since 0.1.0
 */
export const CslName = Schema.Struct({
  family: Schema.optional(Schema.String),
  given: Schema.optional(Schema.String),
  "dropping-particle": Schema.optional(Schema.String),
  "non-dropping-particle": Schema.optional(Schema.String),
  suffix: Schema.optional(Schema.String),
  literal: Schema.optional(Schema.String),
  orcid: Schema.optional(Orcid),
});
/**
 * @since 0.1.0
 */
export type CslName = typeof CslName.Type;

/**
 * A CSL structured date: `date-parts` (the year is `[0][0]`; month, day
 * and ranges are kept), season, circa, literal or raw.
 *
 * @since 0.1.0
 */
export const CslDate = Schema.Struct({
  "date-parts": Schema.optional(Schema.Array(Schema.Array(Schema.Finite))),
  season: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
  circa: Schema.optional(Schema.Union([Schema.Boolean, Schema.Finite, Schema.String])),
  literal: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.String),
});
/**
 * @since 0.1.0
 */
export type CslDate = typeof CslDate.Type;

/**
 * The first-class, checksum-validated identifiers of a record. Plain
 * CSL-JSON carries these as free strings; the superset lifts them into
 * branded values so "a string that looks like an ISBN" and "a proven
 * ISBN" are different types at every call site.
 *
 * @since 0.1.0
 */
export const RecordIdentifiers = Schema.Struct({
  isbn: Schema.optional(Isbn),
  doi: Schema.optional(Doi),
  issn: Schema.optional(Issn),
  pmid: Schema.optional(Pmid),
  pmcid: Schema.optional(Pmcid),
  arxiv: Schema.optional(Arxiv),
});
/**
 * @since 0.1.0
 */
export type RecordIdentifiers = typeof RecordIdentifiers.Type;

/**
 * The external authority (or channel) a record came from. `html` (citation
 * metadata embedded in a web page) was added in 1.0.0.
 *
 * @since 0.1.0
 */
export const ProvenanceSource = Schema.Literals([
  "openlibrary",
  "crossref",
  "openalex",
  "bibtex",
  "csl-json",
  "ris",
  "csv",
  "html",
  "manual",
]);
/**
 * @since 0.1.0
 */
export type ProvenanceSource = typeof ProvenanceSource.Type;

/**
 * Where a record came from and by what retrieval identity. Not part of
 * CSL: {@link toCslJson} drops it. It lets a consumer weigh cross-source
 * agreement and stamp its own provenance.
 *
 * @since 0.1.0
 */
export const Provenance = Schema.Struct({
  source: ProvenanceSource,
  retrievedBy: Schema.optional(
    Schema.Struct({
      identifierType: Schema.optional(Schema.String),
      identifier: Schema.optional(Schema.String),
      endpoint: Schema.optional(Schema.String),
    }),
  ),
  retrievedAt: Schema.optional(Schema.String),
});
/**
 * @since 0.1.0
 */
export type Provenance = typeof Provenance.Type;

/**
 * The neutral bibliographic record. Its CSL core (item type, the CSL-JSON
 * item `id` and every CSL 1.0.2 standard / name / date variable, keyed by
 * their CSL-JSON names) projects losslessly to CSL-JSON; `identifiers`,
 * `provenance`, and `extra` are the strictly-additive superset. Every string
 * field is sanitised before it lands here — consumers treat these as
 * trusted application values. A text variable may carry CSL's rich-text
 * markup (`<i>`, `<b>`, `<sup>`, `<sub>`, the small-caps and `nocase`
 * spans), which {@link parseCslMarkup} reads.
 *
 * The CSL identifier variables `DOI`, `ISBN`, `ISSN`, `PMID` and `PMCID`
 * live, checksummed, in `identifiers`; the citation-time variables
 * (`citation-number`, `first-reference-note-number`, `locator`,
 * `year-suffix`) belong to a rendering, not a record, and stay in `extra`.
 * Every member typed here beyond the 0.1.0 set (`id`, `citation-key`,
 * `categories` and the rest of the CSL variables) was added in 1.0.0.
 *
 * @since 0.1.0
 */
export const BiblioRecord = Schema.Struct({
  type: CslItemType,
  /** The CSL-JSON item id: a string or a number, as the exporting tool wrote it. */
  id: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
  /** CSL-JSON's free-form tags. */
  categories: Schema.optional(Schema.Array(Schema.String)),
  // Standard variables (CSL-keyed; numeric variables as their text).
  abstract: Schema.optional(Schema.String),
  annote: Schema.optional(Schema.String),
  archive: Schema.optional(Schema.String),
  archive_collection: Schema.optional(Schema.String),
  archive_location: Schema.optional(Schema.String),
  "archive-place": Schema.optional(Schema.String),
  authority: Schema.optional(Schema.String),
  "call-number": Schema.optional(Schema.String),
  "chapter-number": Schema.optional(Schema.String),
  "citation-key": Schema.optional(Schema.String),
  "citation-label": Schema.optional(Schema.String),
  "collection-number": Schema.optional(Schema.String),
  "collection-title": Schema.optional(Schema.String),
  "container-title": Schema.optional(Schema.String),
  "container-title-short": Schema.optional(Schema.String),
  dimensions: Schema.optional(Schema.String),
  division: Schema.optional(Schema.String),
  edition: Schema.optional(Schema.String),
  "event-title": Schema.optional(Schema.String),
  "event-place": Schema.optional(Schema.String),
  genre: Schema.optional(Schema.String),
  issue: Schema.optional(Schema.String),
  jurisdiction: Schema.optional(Schema.String),
  keyword: Schema.optional(Schema.String),
  language: Schema.optional(Schema.String),
  license: Schema.optional(Schema.String),
  medium: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  number: Schema.optional(Schema.String),
  "number-of-pages": Schema.optional(Schema.String),
  "number-of-volumes": Schema.optional(Schema.String),
  "original-publisher": Schema.optional(Schema.String),
  "original-publisher-place": Schema.optional(Schema.String),
  "original-title": Schema.optional(Schema.String),
  page: Schema.optional(Schema.String),
  "page-first": Schema.optional(Schema.String),
  part: Schema.optional(Schema.String),
  "part-title": Schema.optional(Schema.String),
  printing: Schema.optional(Schema.String),
  publisher: Schema.optional(Schema.String),
  "publisher-place": Schema.optional(Schema.String),
  references: Schema.optional(Schema.String),
  "reviewed-genre": Schema.optional(Schema.String),
  "reviewed-title": Schema.optional(Schema.String),
  scale: Schema.optional(Schema.String),
  section: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  supplement: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  "title-short": Schema.optional(Schema.String),
  URL: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  volume: Schema.optional(Schema.String),
  "volume-title": Schema.optional(Schema.String),
  "volume-title-short": Schema.optional(Schema.String),
  // Name variables.
  author: Schema.optional(Schema.Array(CslName)),
  chair: Schema.optional(Schema.Array(CslName)),
  "collection-editor": Schema.optional(Schema.Array(CslName)),
  compiler: Schema.optional(Schema.Array(CslName)),
  composer: Schema.optional(Schema.Array(CslName)),
  "container-author": Schema.optional(Schema.Array(CslName)),
  contributor: Schema.optional(Schema.Array(CslName)),
  curator: Schema.optional(Schema.Array(CslName)),
  director: Schema.optional(Schema.Array(CslName)),
  editor: Schema.optional(Schema.Array(CslName)),
  "editorial-director": Schema.optional(Schema.Array(CslName)),
  "executive-producer": Schema.optional(Schema.Array(CslName)),
  guest: Schema.optional(Schema.Array(CslName)),
  host: Schema.optional(Schema.Array(CslName)),
  interviewer: Schema.optional(Schema.Array(CslName)),
  illustrator: Schema.optional(Schema.Array(CslName)),
  narrator: Schema.optional(Schema.Array(CslName)),
  organizer: Schema.optional(Schema.Array(CslName)),
  "original-author": Schema.optional(Schema.Array(CslName)),
  performer: Schema.optional(Schema.Array(CslName)),
  producer: Schema.optional(Schema.Array(CslName)),
  recipient: Schema.optional(Schema.Array(CslName)),
  "reviewed-author": Schema.optional(Schema.Array(CslName)),
  "script-writer": Schema.optional(Schema.Array(CslName)),
  "series-creator": Schema.optional(Schema.Array(CslName)),
  translator: Schema.optional(Schema.Array(CslName)),
  // Date variables.
  accessed: Schema.optional(CslDate),
  "available-date": Schema.optional(CslDate),
  "event-date": Schema.optional(CslDate),
  issued: Schema.optional(CslDate),
  "original-date": Schema.optional(CslDate),
  submitted: Schema.optional(CslDate),
  // Superset additions.
  identifiers: RecordIdentifiers,
  provenance: Provenance,
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
/**
 * @since 0.1.0
 */
export type BiblioRecord = typeof BiblioRecord.Type;

/** The record's CSL variable slots whose values are `V` (the item type and the superset members aside). */
type SlotsOf<V> = Exclude<
  {
    [K in keyof BiblioRecord]-?: NonNullable<BiblioRecord[K]> extends V ? K : never;
  }[keyof BiblioRecord],
  "type" | "identifiers" | "provenance" | "extra"
>;

// The CSL-key groupings that drive the interop loops. Each is written as an
// object keyed by every slot of its kind, so adding a variable to the schema
// without listing it here fails to compile.
const CSL_STRING_VARS = Struct.keys({
  abstract: true,
  annote: true,
  archive: true,
  archive_collection: true,
  archive_location: true,
  "archive-place": true,
  authority: true,
  "call-number": true,
  "chapter-number": true,
  "citation-key": true,
  "citation-label": true,
  "collection-number": true,
  "collection-title": true,
  "container-title": true,
  "container-title-short": true,
  dimensions: true,
  division: true,
  edition: true,
  "event-title": true,
  "event-place": true,
  genre: true,
  issue: true,
  jurisdiction: true,
  keyword: true,
  language: true,
  license: true,
  medium: true,
  note: true,
  number: true,
  "number-of-pages": true,
  "number-of-volumes": true,
  "original-publisher": true,
  "original-publisher-place": true,
  "original-title": true,
  page: true,
  "page-first": true,
  part: true,
  "part-title": true,
  printing: true,
  publisher: true,
  "publisher-place": true,
  references: true,
  "reviewed-genre": true,
  "reviewed-title": true,
  scale: true,
  section: true,
  source: true,
  status: true,
  supplement: true,
  title: true,
  "title-short": true,
  URL: true,
  version: true,
  volume: true,
  "volume-title": true,
  "volume-title-short": true,
} satisfies { readonly [K in SlotsOf<string>]: true });
type CslStringVar = SlotsOf<string>;

const CSL_NAME_VARS = Struct.keys({
  author: true,
  chair: true,
  "collection-editor": true,
  compiler: true,
  composer: true,
  "container-author": true,
  contributor: true,
  curator: true,
  director: true,
  editor: true,
  "editorial-director": true,
  "executive-producer": true,
  guest: true,
  host: true,
  interviewer: true,
  illustrator: true,
  narrator: true,
  organizer: true,
  "original-author": true,
  performer: true,
  producer: true,
  recipient: true,
  "reviewed-author": true,
  "script-writer": true,
  "series-creator": true,
  translator: true,
} satisfies { readonly [K in SlotsOf<readonly CslName[]>]: true });
type CslNameVar = SlotsOf<readonly CslName[]>;

const CSL_DATE_VARS = Struct.keys({
  accessed: true,
  "available-date": true,
  "event-date": true,
  issued: true,
  "original-date": true,
  submitted: true,
} satisfies { readonly [K in SlotsOf<CslDate>]: true });
type CslDateVar = SlotsOf<CslDate>;

/**
 * Zotero's and CSL's legacy aliases, read into their CSL 1.0.2 variable when
 * that variable is absent: `[alias, variable]`.
 */
const CSL_ALIASES = [
  ["event", "event-title"],
  ["journalAbbreviation", "container-title-short"],
  ["shortTitle", "title-short"],
] as const satisfies ReadonlyArray<readonly [string, CslStringVar]>;

/** CSL keys the model consumes into typed slots; everything else is passthrough. */
const KNOWN_CSL_KEYS: HashSet.HashSet<string> = HashSet.fromIterable<string>([
  "type",
  "id",
  "categories",
  "ISBN",
  "DOI",
  "ISSN",
  "PMID",
  "PMCID",
  ...CSL_STRING_VARS,
  ...CSL_NAME_VARS,
  ...CSL_DATE_VARS,
]);

// ── Name & date construction helpers ──────────────────────────────────

/** True when a {@link CslName} carries no usable content. */
function isEmptyName(name: CslName): boolean {
  return (
    name.family === undefined &&
    name.given === undefined &&
    name.literal === undefined &&
    name["dropping-particle"] === undefined &&
    name["non-dropping-particle"] === undefined &&
    name.suffix === undefined
  );
}

/*
 * The four `null`-returning helpers below (`makeCslName`, `parsePersonName`,
 * `cslNameDisplay`, `yearOf`) return `null`, not `Option`, by contract:
 * website's `apps/api/src/biblio/*` consumes them as plain nullables. See
 * "The plain-nullable seams stay" in packages/biblio/CLAUDE.md. The bodies
 * use the `Option`-returning sanitisers and convert at the return.
 */
/* oxlint-disable effect/prefer-option-over-null -- cross-slice: consumed as plain nullables by apps/api */

/**
 * Builds a sanitised {@link CslName} from loose parts, dropping empty
 * fields and validating an ORCID where present. Returns `null` when the
 * result carries nothing usable.
 *
 * @since 0.1.0
 */
export function makeCslName(parts: {
  readonly family?: unknown;
  readonly given?: unknown;
  readonly droppingParticle?: unknown;
  readonly nonDroppingParticle?: unknown;
  readonly suffix?: unknown;
  readonly literal?: unknown;
  readonly orcid?: unknown;
}): CslName | null {
  const name: Types.Mutable<CslName> = {};
  const family = sanitiseText(parts.family);
  if (Option.isSome(family)) name.family = family.value;
  const given = sanitiseText(parts.given);
  if (Option.isSome(given)) name.given = given.value;
  const dropping = sanitiseText(parts.droppingParticle);
  if (Option.isSome(dropping)) name["dropping-particle"] = dropping.value;
  const nonDropping = sanitiseText(parts.nonDroppingParticle);
  if (Option.isSome(nonDropping)) name["non-dropping-particle"] = nonDropping.value;
  const suffix = sanitiseText(parts.suffix);
  if (Option.isSome(suffix)) name.suffix = suffix.value;
  const literal = sanitiseText(parts.literal);
  if (Option.isSome(literal)) name.literal = literal.value;
  if (Predicate.isString(parts.orcid)) {
    const orcid = decodeOrcid(parts.orcid);
    if (Option.isSome(orcid)) name.orcid = orcid.value;
  }
  return isEmptyName(name) ? null : name;
}

/**
 * Parses a display-form personal name into a structured {@link CslName}.
 * Handles both orderings: `"Family, Given"` (the text before the first
 * comma is the family name) and `"Given Family"` (the family name is the
 * last token). Returns `null` for an empty name.
 *
 * @since 0.1.0
 */
export function parsePersonName(raw: string): CslName | null {
  const sanitised = sanitiseText(raw);
  if (Option.isNone(sanitised)) return null;
  const cleaned = sanitised.value;
  const comma = cleaned.indexOf(",");
  if (comma >= 0) {
    return makeCslName({ family: cleaned.slice(0, comma), given: cleaned.slice(comma + 1) });
  }
  const tokens = cleaned.split(" ").filter(String.isNonEmpty);
  if (tokens.length <= 1) return makeCslName({ family: cleaned });
  return makeCslName({ family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(" ") });
}

/**
 * The display form of a {@link CslName}: the CSL `literal` verbatim, else
 * `"Given Family"`, else the family name alone. `null` when empty.
 *
 * @since 0.1.0
 */
export function cslNameDisplay(name: CslName): string | null {
  if (name.literal !== undefined) return name.literal;
  if (name.family !== undefined) {
    return name.given !== undefined ? `${name.given} ${name.family}` : name.family;
  }
  return name.given ?? null;
}

/**
 * A structured {@link CslDate} carrying just a year in `date-parts`.
 *
 * @since 0.1.0
 */
export function dateFromYear(year: number): CslDate {
  return { "date-parts": [[year]] };
}

/**
 * The year of a {@link CslDate} — `date-parts[0][0]` (a range's start),
 * else the first four-digit year of its `raw` form, sanitised — or `null`.
 * A season (CSL's `season`, or a month of 21–24) never changes the year.
 *
 * @since 0.1.0
 */
export function yearOf(date: CslDate | undefined): number | null {
  const first = date?.["date-parts"]?.[0]?.[0];
  if (first !== undefined) return Option.getOrNull(sanitiseYear(first));
  const raw = date?.raw === undefined ? null : /\b(\d{4})\b/.exec(date.raw);
  return raw === null ? null : Option.getOrNull(sanitiseYear(raw[1]));
}

/* oxlint-enable effect/prefer-option-over-null */

/**
 * The last year of a {@link CslDate} range — the year of its second
 * `date-parts` entry — when it differs from {@link yearOf}'s, else
 * `Option.none()`.
 *
 * @since 1.0.0
 */
export function endYearOf(date: CslDate): Option.Option<number> {
  const last = date["date-parts"]?.[1]?.[0];
  if (last === undefined) return Option.none();
  return Option.filter(sanitiseYear(last), (end) => end !== yearOf(date));
}

// ── CSL-JSON interop ──────────────────────────────────────────────────

/**
 * A plain CSL-JSON item object (the interchange shape).
 *
 * @since 0.1.0
 */
export type CslJsonItem = Record<string, unknown>;

/** Serialises a {@link CslName} to a plain CSL name object, dropping empty keys. */
function nameToCsl(name: CslName): Record<string, unknown> {
  return { ...name };
}

/** Serialises a {@link CslDate} to a plain CSL date object. */
function dateToCsl(date: CslDate): Record<string, unknown> {
  const parts = date["date-parts"];
  return parts === undefined
    ? { ...date }
    : { ...date, "date-parts": parts.map((part) => [...part]) };
}

/**
 * Projects a record to plain, schema-valid CSL-JSON: drops the provenance
 * envelope, serialises each branded identifier back to its canonical
 * string in the standard CSL variable (`isbn → ISBN`, `doi → DOI`,
 * `issn → ISSN`, `pmid → PMID`, `pmcid → PMCID`; an arXiv id becomes
 * `number: "arXiv:<id>"` when the record has no `number`, as Zotero writes
 * it), and re-merges the passthrough map. Any CSL consumer (Zotero,
 * citeproc) reads the result directly.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { fromCslJson, toCslJson } from "@thomasfosterau/biblio"
 *
 * const record = fromCslJson({ type: "book", title: "Sapiens", ISBN: "9780062316097", "custom-key": "kept" })
 *
 * // Provenance is dropped, the identifier lands back in `ISBN`, the
 * // passthrough is re-merged: plain CSL-JSON any citation tool reads.
 * assert.deepStrictEqual(toCslJson(record), { "custom-key": "kept", type: "book", title: "Sapiens", ISBN: "9780062316097" })
 * ```
 *
 * @since 0.1.0
 */
export function toCslJson(record: BiblioRecord): CslJsonItem {
  const { isbn, doi, issn, pmid, pmcid, arxiv } = record.identifiers;
  const identifiers: Types.Mutable<CslJsonIdentifiers> = {};
  if (isbn !== undefined) identifiers.ISBN = isbn;
  if (doi !== undefined) identifiers.DOI = doi;
  if (issn !== undefined) identifiers.ISSN = issn;
  if (pmid !== undefined) identifiers.PMID = pmid;
  if (pmcid !== undefined) identifiers.PMCID = pmcid;
  if (arxiv !== undefined && record.number === undefined) identifiers.number = `arXiv:${arxiv}`;
  const item: Types.Mutable<Pick<BiblioRecord, "id" | "categories">> = {};
  if (record.id !== undefined) item.id = record.id;
  if (record.categories !== undefined) item.categories = [...record.categories];
  return {
    // Passthrough first so modelled fields win over any stale carried key.
    ...record.extra,
    type: record.type,
    ...item,
    ...definedFields(CSL_STRING_VARS, (key: CslStringVar) => Option.fromUndefinedOr(record[key])),
    ...definedFields(CSL_NAME_VARS, (key: CslNameVar) =>
      Option.map(Option.fromUndefinedOr(record[key]), (names) => names.map(nameToCsl)),
    ),
    ...definedFields(CSL_DATE_VARS, (key: CslDateVar) =>
      Option.map(Option.fromUndefinedOr(record[key]), dateToCsl),
    ),
    ...identifiers,
  };
}

/** The CSL-JSON identifier variables {@link toCslJson} writes back from the branded slots. */
interface CslJsonIdentifiers {
  readonly ISBN?: Isbn;
  readonly DOI?: Doi;
  readonly ISSN?: Issn;
  readonly PMID?: Pmid;
  readonly PMCID?: Pmcid;
  readonly number?: `arXiv:${Arxiv}`;
}

/** `{ key: projected }` for every key whose projected value is present. */
function definedFields<K extends string, V>(
  keys: readonly K[],
  project: (key: K) => Option.Option<V>,
): Readonly<Record<string, V>> {
  return Record.fromEntries(
    Array.filterMap(keys, (key): Result.Result<readonly [K, V], void> =>
      Option.match(project(key), {
        onNone: () => Result.failVoid,
        onSome: (value) => Result.succeed([key, value] as const),
      }),
    ),
  );
}

/**
 * A CSL name object as found in the wild: the CSL name parts, plus the
 * Zotero single-field `name`. Every part is still untrusted.
 */
const CslNameInput = Schema.Struct({
  family: Schema.optional(Schema.Unknown),
  given: Schema.optional(Schema.Unknown),
  "dropping-particle": Schema.optional(Schema.Unknown),
  "non-dropping-particle": Schema.optional(Schema.Unknown),
  suffix: Schema.optional(Schema.Unknown),
  literal: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
  orcid: Schema.optional(Schema.Unknown),
});
const decodeCslNameInput = Schema.decodeUnknownOption(CslNameInput);

/** Any array, its elements still untrusted. */
const decodeUnknownArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

/**
 * Reads one CSL name value into a structured {@link CslName}, or
 * `Option.none()`. Tolerates the Zotero single-field `name` as a `literal`
 * fallback. Shared by the CSL-JSON parser so name structuring lives in one
 * place.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line effect/no-unknown-parameters -- untrusted-input boundary: a total decoder over any CSL name value (see "The untrusted-input boundary" in packages/biblio/CLAUDE.md)
export function readCslName(entry: unknown): Option.Option<CslName> {
  return Option.flatMap(decodeCslNameInput(entry), (obj) =>
    Option.fromNullishOr(
      makeCslName({
        family: obj.family,
        given: obj.given,
        droppingParticle: obj["dropping-particle"],
        nonDroppingParticle: obj["non-dropping-particle"],
        suffix: obj.suffix,
        literal: obj.literal ?? obj.name,
        orcid: obj.orcid,
      }),
    ),
  );
}

/**
 * Reads a bounded list of CSL names, dropping non-object / empty entries,
 * keeping at most `maxNames` (default {@link MAX_AUTHORS}). Shared by the
 * CSL-JSON parser so the name-list bound lives in one place.
 *
 * @since 0.1.0
 */
export function readCslNameArray(
  // oxlint-disable-next-line effect/no-unknown-parameters -- untrusted-input boundary: a total decoder over any CSL name-list value (see "The untrusted-input boundary" in packages/biblio/CLAUDE.md)
  value: unknown,
  maxNames: number = MAX_AUTHORS,
): CslName[] {
  const cap = limitOr(Option.some(maxNames), MAX_AUTHORS);
  return Option.match(decodeUnknownArray(value), {
    onNone: (): CslName[] => [],
    onSome: (entries) =>
      // Scans no further than the cap: a hostile list cannot make every entry cost.
      Array.filterMap(entries, (entry): Result.Result<CslName, void> => {
        const name = readCslName(entry);
        return Option.isNone(name) ? Result.failVoid : Result.succeed(name.value);
      }).slice(0, cap),
  });
}

/** Folds an empty name list to `None` for the record spread. */
function fromCslNameList(names: readonly CslName[]): Option.Option<readonly CslName[]> {
  return Array.isReadonlyArrayNonEmpty(names) ? Option.some(names) : Option.none();
}

/** Cleans untrusted CSL `date-parts` lists to their finite numeric parts, or `None`. */
function cleanDateParts(parts: readonly unknown[]): Option.Option<number[][]> {
  const cleaned = Array.filterMap(parts, (part): Result.Result<number[], void> =>
    Option.match(decodeUnknownArray(part), {
      onNone: () => Result.failVoid,
      onSome: (values) => {
        const nums = values.filter((n): n is number => Predicate.isNumber(n) && Number.isFinite(n));
        return Array.isReadonlyArrayNonEmpty(nums) ? Result.succeed(nums) : Result.failVoid;
      },
    }),
  );
  return Array.isArrayNonEmpty(cleaned) ? Option.some(cleaned) : Option.none();
}

/** A CSL `season` is a string or a number (1–4), else absent. */
const decodeSeason = Schema.decodeUnknownOption(Schema.Union([Schema.String, Schema.Number]));

/** A CSL `circa` flag is a boolean, number, or string, else absent. */
const decodeCirca = Schema.decodeUnknownOption(
  Schema.Union([Schema.Boolean, Schema.Number, Schema.String]),
);

/** A CSL date object as found in the wild; every member is still untrusted. */
const CslDateInput = Schema.Struct({
  "date-parts": Schema.optional(Schema.Unknown),
  season: Schema.optional(Schema.Unknown),
  circa: Schema.optional(Schema.Unknown),
  literal: Schema.optional(Schema.Unknown),
  raw: Schema.optional(Schema.Unknown),
});
const decodeCslDateInput = Schema.decodeUnknownOption(CslDateInput);

/** Reads one CSL date object into a structured {@link CslDate}, or `None`. */
function fromCslDateValue(obj: typeof CslDateInput.Type): Option.Option<CslDate> {
  const date: Types.Mutable<CslDate> = {};
  const parts = Option.flatMap(decodeUnknownArray(obj["date-parts"]), cleanDateParts);
  if (Option.isSome(parts)) date["date-parts"] = parts.value;
  const season = decodeSeason(obj.season);
  if (Option.isSome(season)) date.season = season.value;
  const circa = decodeCirca(obj.circa);
  if (Option.isSome(circa)) date.circa = circa.value;
  const literal = sanitiseText(obj.literal);
  if (Option.isSome(literal)) date.literal = literal.value;
  const raw = sanitiseText(obj.raw);
  if (Option.isSome(raw)) date.raw = raw.value;
  return Array.isArrayEmpty(Struct.keys(date)) ? Option.none() : Option.some(date);
}

/**
 * Leniently decodes any CSL-JSON item into a {@link BiblioRecord}. Never
 * throws: a non-object, partial, or hostile item decodes to a thinner
 * record (item type `document`, empty identifiers), never an error.
 * Identifiers are validated where present — a checksum failure drops the
 * identifier rather than the record; an arXiv id is read from a
 * `number: "arXiv:…"` or an arxiv.org `URL`. Every CSL 1.0.2 variable lands
 * in its typed slot, with the legacy aliases `event`, `journalAbbreviation`
 * and `shortTitle` read when their variable is absent; unknown CSL keys
 * survive in `extra`. The record is stamped `provenance.source: "csl-json"`.
 * `limits` raises the field-length and name-list bounds.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { fromCslJson } from "@thomasfosterau/biblio"
 *
 * const record = fromCslJson({
 *   id: "harari2015",
 *   "citation-key": "harari2015",
 *   type: "book",
 *   title: "Sapiens",
 *   "title-short": "Sapiens",
 *   ISBN: "0-06-231609-5",
 *   author: [{ family: "Harari", given: "Yuval Noah" }],
 *   issued: { "date-parts": [[2015]] },
 *   "custom-key": "kept",
 * })
 *
 * // The ISBN was checksummed and canonicalised into its branded slot; the
 * // citation key and short title are typed; the unknown key survived in
 * // `extra`; the record knows where it came from.
 * assert.strictEqual(record.identifiers.isbn, "9780062316097")
 * assert.strictEqual(record["citation-key"], "harari2015")
 * assert.strictEqual(record["title-short"], "Sapiens")
 * assert.deepStrictEqual(record.extra, { "custom-key": "kept" })
 * assert.deepStrictEqual(record.provenance, { source: "csl-json" })
 * ```
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line effect/no-unknown-parameters -- untrusted-input boundary: the lenient interop decoder takes any value by contract (see "The untrusted-input boundary" in packages/biblio/CLAUDE.md)
export function fromCslJson(item: unknown, limits: RecordLimits = {}): BiblioRecord {
  const provenance: Provenance = { source: "csl-json" };
  if (!Predicate.isObjectOrArray(item)) {
    return { type: "document", identifiers: {}, provenance };
  }
  // SAFETY: `isObjectOrArray` proved a non-null object or array; every key is
  // read as `unknown` and re-checked below, and an array reads as its index
  // keys (which land in `extra`), exactly as an object would.
  const obj = item as Readonly<Record<string, unknown>>;
  const rawType = obj.type;
  const type: CslItemType =
    Predicate.isString(rawType) && isCslItemType(rawType) ? rawType : "document";
  const maxFieldLength = limitOr(
    Option.fromUndefinedOr(limits.maxFieldLength),
    MAX_TEXT_FIELD_LENGTH,
  );
  const strings = readCslStrings(obj, maxFieldLength);
  const extra = collectCslExtra(obj, strings.aliased);
  const passthrough: Types.Mutable<Pick<BiblioRecord, "extra">> = {};
  if (!Record.isEmptyRecord(extra)) passthrough.extra = extra;
  return {
    type,
    ...readCslItemMembers(obj, maxFieldLength),
    ...strings.values,
    ...readCslNames(obj, limitOr(Option.fromUndefinedOr(limits.maxAuthors), MAX_AUTHORS)),
    ...readCslDates(obj),
    identifiers: readCslIdentifiers(obj, strings.values),
    provenance,
    ...passthrough,
  };
}

/** A CSL string value. */
const decodeString = Schema.decodeUnknownOption(Schema.String);

/** A CSL item `id`: text or a finite number. */
const decodeItemId = Schema.decodeUnknownOption(Schema.Union([Schema.String, Schema.Finite]));

/** Reads the item-level members: the `id` and the `categories` tags. */
function readCslItemMembers(
  obj: Readonly<Record<string, unknown>>,
  maxFieldLength: number,
): Pick<BiblioRecord, "id" | "categories"> {
  const members: Types.Mutable<Pick<BiblioRecord, "id" | "categories">> = {};
  const id = Option.flatMap(decodeItemId(obj.id), (value): Option.Option<string | number> =>
    Predicate.isNumber(value) ? Option.some(value) : sanitiseText(value, maxFieldLength),
  );
  if (Option.isSome(id)) members.id = id.value;
  const categories = Option.match(decodeUnknownArray(obj.categories), {
    onNone: (): string[] => [],
    onSome: (values) =>
      Array.getSomes(
        values.slice(0, MAX_CATEGORIES).map((value) => sanitiseText(value, maxFieldLength)),
      ),
  });
  if (Array.isArrayNonEmpty(categories)) members.categories = categories;
  return members;
}

/** The modelled CSL string variables read from an item, and the aliases that filled one. */
interface CslStrings {
  readonly values: Partial<Record<CslStringVar, string>>;
  readonly aliased: HashSet.HashSet<string>;
}

/** Reads the modelled CSL string variables, sanitised, falling back to their legacy aliases. */
function readCslStrings(
  obj: Readonly<Record<string, unknown>>,
  maxFieldLength: number,
): CslStrings {
  const read = (key: string): Option.Option<string> =>
    sanitiseCslString(decodeCslStringValue(obj[key]), maxFieldLength);
  const values: Types.Mutable<Partial<Record<CslStringVar, string>>> = Record.fromEntries(
    Array.filterMap(
      CSL_STRING_VARS,
      (key): Result.Result<readonly [CslStringVar, string], void> => {
        const value = read(key);
        return Option.isNone(value) ? Result.failVoid : Result.succeed([key, value.value] as const);
      },
    ),
  );
  const aliased = Array.filterMap(CSL_ALIASES, ([alias, key]): Result.Result<string, void> => {
    if (values[key] !== undefined) return Result.failVoid;
    const value = read(alias);
    if (Option.isNone(value)) return Result.failVoid;
    values[key] = value.value;
    return Result.succeed(alias);
  });
  return { values, aliased: HashSet.fromIterable(aliased) };
}

/** Reads the modelled CSL name variables into structured name lists. */
function readCslNames(
  obj: Readonly<Record<string, unknown>>,
  maxNames: number,
): Partial<Record<CslNameVar, readonly CslName[]>> {
  return Record.fromEntries(
    Array.filterMap(
      CSL_NAME_VARS,
      (key): Result.Result<readonly [CslNameVar, readonly CslName[]], void> => {
        const list = fromCslNameList(readCslNameArray(obj[key], maxNames));
        return Option.isNone(list) ? Result.failVoid : Result.succeed([key, list.value] as const);
      },
    ),
  );
}

/** Reads the modelled CSL date variables into structured dates. */
function readCslDates(
  obj: Readonly<Record<string, unknown>>,
): Partial<Record<CslDateVar, CslDate>> {
  return Record.fromEntries(
    Array.filterMap(CSL_DATE_VARS, (key): Result.Result<readonly [CslDateVar, CslDate], void> => {
      const date = Option.flatMap(decodeCslDateInput(obj[key]), fromCslDateValue);
      return Option.isNone(date) ? Result.failVoid : Result.succeed([key, date.value] as const);
    }),
  );
}

/**
 * Validates the free-string CSL identifiers into their branded slots
 * (checksum failures dropped), and reads an arXiv id from the record's
 * `number` (`arXiv:2101.01234`) or an arxiv.org `URL`.
 */
function readCslIdentifiers(
  obj: Readonly<Record<string, unknown>>,
  strings: Partial<Record<CslStringVar, string>>,
): RecordIdentifiers {
  const identifiers: Types.Mutable<RecordIdentifiers> = {};
  // Zotero writes several ISBNs as one space / comma separated list: the
  // first checksum-valid one is the record's.
  const isbn = Option.flatMap(decodeString(obj.ISBN), (value) =>
    Option.orElse(decodeIsbn(value), () =>
      Array.findFirst(value.split(/[\s,;]+/), (token) => decodeIsbn(token)),
    ),
  );
  if (Option.isSome(isbn)) identifiers.isbn = isbn.value;
  const doi = Option.flatMap(decodeString(obj.DOI), decodeDoi);
  if (Option.isSome(doi)) identifiers.doi = doi.value;
  const issn = Option.flatMap(decodeString(obj.ISSN), decodeIssn);
  if (Option.isSome(issn)) identifiers.issn = issn.value;
  const pmid = Option.flatMap(decodeCslStringValue(obj.PMID), (value) =>
    decodePmid(value.toString()),
  );
  if (Option.isSome(pmid)) identifiers.pmid = pmid.value;
  const pmcid = Option.flatMap(decodeString(obj.PMCID), decodePmcid);
  if (Option.isSome(pmcid)) identifiers.pmcid = pmcid.value;
  const arxiv = Option.orElse(
    Option.flatMap(
      Option.filter(Option.fromUndefinedOr(strings.number), (number) => /^arxiv:/i.test(number)),
      decodeArxiv,
    ),
    () =>
      Option.flatMap(
        Option.filter(Option.fromUndefinedOr(strings.URL), (url) =>
          /^https?:\/\/(?:www\.)?arxiv\.org\/abs\//i.test(url),
        ),
        decodeArxiv,
      ),
  );
  if (Option.isSome(arxiv)) identifiers.arxiv = arxiv.value;
  return identifiers;
}

/** Captures the CSL keys the model doesn't consume (nor read as an alias) into the passthrough map. */
function collectCslExtra(
  obj: Readonly<Record<string, unknown>>,
  aliased: HashSet.HashSet<string>,
): Record<string, unknown> {
  return Record.filter(
    obj,
    (_value, key) => !HashSet.has(KNOWN_CSL_KEYS, key) && !HashSet.has(aliased, key),
  );
}
