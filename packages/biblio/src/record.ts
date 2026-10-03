/**
 * The CSL-aligned bibliographic record — the neutral centre of the toolkit
 * (#1069).
 *
 * A {@link BiblioRecord} is a typed **superset of CSL-JSON**: its core is
 * the closed CSL 1.0.2 vocabulary (item types, standard/name/date
 * variables) modelled as Effect Schema, and its additions are strictly
 * additive — first-class **checksummed identifiers** (the {@link Isbn} /
 * {@link Doi} / {@link Issn} / {@link Orcid} brands), a **source
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

import * as Array from "effect/Array";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as String from "effect/String";
import {
  Doi,
  decodeDoi,
  decodeIsbn,
  decodeIssn,
  decodeOrcid,
  Isbn,
  Issn,
  Orcid,
} from "./identifiers.ts";

// ── Field bounds & untrusted-text sanitisers ────────────────────────

/**
 * Upper bound, in UTF-16 code units, on any free-text field taken from
 * untrusted input; longer values are truncated, so a hostile or malformed
 * value can't push an unbounded blob downstream.
 *
 * @since 0.1.0
 */
export const MAX_TEXT_FIELD_LENGTH = 2000;

/**
 * Cap on how many contributors we extract from a single record.
 *
 * @since 0.1.0
 */
export const MAX_AUTHORS = 100;

/** The narrowest plausible publication year we accept. */
const MIN_PUBLICATION_YEAR = 1;
/** Guard against absurd future years. */
const MAX_PUBLICATION_YEAR = 2200;

/**
 * Trims an untrusted free-text value, collapses its whitespace and clamps
 * it to {@link MAX_TEXT_FIELD_LENGTH}.
 * `Option.none()` for empty / whitespace-only or non-string input.
 *
 * @since 0.1.0
 */
export function sanitiseText(value: unknown): Option.Option<string> {
  if (!Predicate.isString(value)) return Option.none();
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (String.isEmpty(collapsed)) return Option.none();
  return Option.some(collapsed.slice(0, MAX_TEXT_FIELD_LENGTH));
}

/**
 * Coerces an untrusted value to a plausible publication year, or
 * `Option.none()`. Accepts a number or a numeric string; rejects
 * non-integers and years outside {@link MIN_PUBLICATION_YEAR} …
 * {@link MAX_PUBLICATION_YEAR}.
 *
 * @since 0.1.0
 */
export function sanitiseYear(value: unknown): Option.Option<number> {
  const n = Predicate.isNumber(value) ? value : Predicate.isString(value) ? Number(value) : NaN;
  if (!Number.isInteger(n)) return Option.none();
  if (n < MIN_PUBLICATION_YEAR || n > MAX_PUBLICATION_YEAR) return Option.none();
  return Option.some(n);
}

/** Sanitises a CSL string variable that upstreams may send as a number (e.g. `volume`). */
function sanitiseCslString(value: unknown): Option.Option<string> {
  if (Predicate.isNumber(value) && Number.isFinite(value)) return sanitiseText(value.toString());
  return sanitiseText(value);
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
});
/**
 * @since 0.1.0
 */
export type RecordIdentifiers = typeof RecordIdentifiers.Type;

/**
 * The external authority (or channel) a record came from.
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
 * The neutral bibliographic record. Its CSL core (item type + standard /
 * name / date variables, keyed by their CSL-JSON names) projects
 * losslessly to CSL-JSON; `identifiers`, `provenance`, and `extra` are the
 * strictly-additive superset. Every string field is sanitised before it
 * lands here — consumers treat these as trusted application values.
 *
 * @since 0.1.0
 */
export const BiblioRecord = Schema.Struct({
  type: CslItemType,
  // Standard variables (CSL-keyed).
  title: Schema.optional(Schema.String),
  "container-title": Schema.optional(Schema.String),
  "collection-title": Schema.optional(Schema.String),
  publisher: Schema.optional(Schema.String),
  "publisher-place": Schema.optional(Schema.String),
  page: Schema.optional(Schema.String),
  volume: Schema.optional(Schema.String),
  issue: Schema.optional(Schema.String),
  number: Schema.optional(Schema.String),
  edition: Schema.optional(Schema.String),
  abstract: Schema.optional(Schema.String),
  language: Schema.optional(Schema.String),
  URL: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  // Name variables.
  author: Schema.optional(Schema.Array(CslName)),
  editor: Schema.optional(Schema.Array(CslName)),
  translator: Schema.optional(Schema.Array(CslName)),
  "container-author": Schema.optional(Schema.Array(CslName)),
  // Date variables.
  issued: Schema.optional(CslDate),
  accessed: Schema.optional(CslDate),
  "original-date": Schema.optional(CslDate),
  "event-date": Schema.optional(CslDate),
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

// The CSL-key groupings that drive the interop loops. Typed as keys of the
// record so indexing stays sound.
const CSL_STRING_VARS = [
  "title",
  "container-title",
  "collection-title",
  "publisher",
  "publisher-place",
  "page",
  "volume",
  "issue",
  "number",
  "edition",
  "abstract",
  "language",
  "URL",
  "note",
] as const satisfies readonly (keyof BiblioRecord)[];
type CslStringVar = (typeof CSL_STRING_VARS)[number];

const CSL_NAME_VARS = [
  "author",
  "editor",
  "translator",
  "container-author",
] as const satisfies readonly (keyof BiblioRecord)[];
type CslNameVar = (typeof CSL_NAME_VARS)[number];

const CSL_DATE_VARS = [
  "issued",
  "accessed",
  "original-date",
  "event-date",
  "submitted",
] as const satisfies readonly (keyof BiblioRecord)[];
type CslDateVar = (typeof CSL_DATE_VARS)[number];

/** CSL keys the model consumes into typed slots; everything else is passthrough. */
const KNOWN_CSL_KEYS: HashSet.HashSet<string> = HashSet.fromIterable<string>([
  "type",
  "ISBN",
  "DOI",
  "ISSN",
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
  const name: {
    family?: string;
    given?: string;
    "dropping-particle"?: string;
    "non-dropping-particle"?: string;
    suffix?: string;
    literal?: string;
    orcid?: Orcid;
  } = {};
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
 * The year of a {@link CslDate} — `date-parts[0][0]`, sanitised — or `null`.
 *
 * @since 0.1.0
 */
export function yearOf(date: CslDate | undefined): number | null {
  const first = date?.["date-parts"]?.[0]?.[0];
  return first === undefined ? null : Option.getOrNull(sanitiseYear(first));
}
/* oxlint-enable effect/prefer-option-over-null */

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
  return {
    ...date,
    ...(date["date-parts"] !== undefined
      ? { "date-parts": date["date-parts"].map((part) => [...part]) }
      : {}),
  };
}

/**
 * Projects a record to plain, schema-valid CSL-JSON: drops the provenance
 * envelope, serialises each branded identifier back to its canonical
 * string in the standard CSL variable (`isbn → ISBN`, `doi → DOI`,
 * `issn → ISSN`), and re-merges the passthrough map. Any CSL consumer
 * (Zotero, citeproc) reads the result directly.
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
  const { isbn, doi, issn } = record.identifiers;
  return {
    // Passthrough first so modelled fields win over any stale carried key.
    ...record.extra,
    type: record.type,
    ...definedFields(CSL_STRING_VARS, (key: CslStringVar) => record[key]),
    ...definedFields(CSL_NAME_VARS, (key: CslNameVar) => record[key]?.map(nameToCsl)),
    ...definedFields(CSL_DATE_VARS, (key: CslDateVar) => {
      const value = record[key];
      return value === undefined ? undefined : dateToCsl(value);
    }),
    ...(isbn === undefined ? {} : { ISBN: isbn }),
    ...(doi === undefined ? {} : { DOI: doi }),
    ...(issn === undefined ? {} : { ISSN: issn }),
  };
}

/** `{ key: projected }` for every key whose projected value is defined. */
function definedFields<K extends string>(
  keys: readonly K[],
  project: (key: K) => unknown,
): CslJsonItem {
  return Record.fromEntries(
    Array.filterMap(keys, (key): Result.Result<readonly [K, unknown], void> => {
      const value = project(key);
      return value === undefined ? Result.failVoid : Result.succeed([key, value] as const);
    }),
  );
}

/**
 * Reads one CSL name value into a structured {@link CslName}, or
 * `Option.none()`. Tolerates the Zotero single-field `name` as a `literal`
 * fallback. Shared by the CSL-JSON parser so name structuring lives in one
 * place.
 *
 * @since 0.1.0
 */
export function readCslName(entry: unknown): Option.Option<CslName> {
  if (!Predicate.isObjectOrArray(entry)) return Option.none();
  const obj = entry as Record<string, unknown>;
  return Option.fromNullishOr(
    makeCslName({
      family: obj.family,
      given: obj.given,
      droppingParticle: obj["dropping-particle"],
      nonDroppingParticle: obj["non-dropping-particle"],
      suffix: obj.suffix,
      literal: obj.literal ?? obj.name,
      orcid: obj.orcid,
    }),
  );
}

/**
 * Reads a bounded list of CSL names, dropping non-object / empty entries.
 * Shared by the CSL-JSON parser so the name-list bound lives in one place.
 *
 * @since 0.1.0
 */
export function readCslNameArray(value: unknown): CslName[] {
  if (!Array.isArray(value)) return [];
  return Array.filterMap(value, (entry): Result.Result<CslName, void> => {
    const name = readCslName(entry);
    return Option.isNone(name) ? Result.failVoid : Result.succeed(name.value);
  }).slice(0, MAX_AUTHORS);
}

/** As {@link readCslNameArray}, but folds an empty list to `None` for the record spread. */
function fromCslNameList(value: unknown): Option.Option<readonly CslName[]> {
  const names = readCslNameArray(value);
  return Array.isArrayNonEmpty(names) ? Option.some(names) : Option.none();
}

/** Cleans an untrusted CSL `date-parts` value to numeric parts, or `None`. */
function cleanDateParts(parts: unknown): Option.Option<number[][]> {
  if (!Array.isArray(parts)) return Option.none();
  const cleaned = Array.filterMap(parts, (part): Result.Result<number[], void> => {
    if (!Array.isArray(part)) return Result.failVoid;
    const nums = part.filter((n): n is number => Predicate.isNumber(n) && Number.isFinite(n));
    return Array.isReadonlyArrayNonEmpty(nums) ? Result.succeed(nums) : Result.failVoid;
  });
  return Array.isArrayNonEmpty(cleaned) ? Option.some(cleaned) : Option.none();
}

/** A CSL `season` is a string or a number (1–4), else absent. */
function readSeason(value: unknown): Option.Option<string | number> {
  return Predicate.isString(value) || Predicate.isNumber(value)
    ? Option.some(value)
    : Option.none();
}

/** A CSL `circa` flag is a boolean, number, or string, else absent. */
function readCirca(value: unknown): Option.Option<boolean | number | string> {
  return Predicate.isBoolean(value) || Predicate.isNumber(value) || Predicate.isString(value)
    ? Option.some(value)
    : Option.none();
}

/** Reads one CSL date value into a structured {@link CslDate}, or `None`. */
function fromCslDateValue(value: unknown): Option.Option<CslDate> {
  if (!Predicate.isObjectOrArray(value)) return Option.none();
  const obj = value as Record<string, unknown>;
  const date: {
    "date-parts"?: readonly (readonly number[])[];
    season?: string | number;
    circa?: boolean | number | string;
    literal?: string;
    raw?: string;
  } = {};
  const parts = cleanDateParts(obj["date-parts"]);
  if (Option.isSome(parts)) date["date-parts"] = parts.value;
  const season = readSeason(obj.season);
  if (Option.isSome(season)) date.season = season.value;
  const circa = readCirca(obj.circa);
  if (Option.isSome(circa)) date.circa = circa.value;
  const literal = sanitiseText(obj.literal);
  if (Option.isSome(literal)) date.literal = literal.value;
  const raw = sanitiseText(obj.raw);
  if (Option.isSome(raw)) date.raw = raw.value;
  // Widened for the emptiness probe only: `Record.isEmptyReadonlyRecord` cannot
  // take an object whose properties are optional under
  // `exactOptionalPropertyTypes`.
  return Record.isEmptyReadonlyRecord(date as Readonly<Record<string, unknown>>)
    ? Option.none()
    : Option.some(date);
}

/**
 * Leniently decodes any CSL-JSON item into a {@link BiblioRecord}. Never
 * throws: a non-object, partial, or hostile item decodes to a thinner
 * record (item type `document`, empty identifiers), never an error.
 * Identifiers are validated where present — a checksum failure drops the
 * identifier rather than the record. Unknown CSL keys survive in `extra`.
 * The record is stamped `provenance.source: "csl-json"`.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { fromCslJson } from "@thomasfosterau/biblio"
 *
 * const record = fromCslJson({
 *   type: "book",
 *   title: "Sapiens",
 *   ISBN: "0-06-231609-5",
 *   author: [{ family: "Harari", given: "Yuval Noah" }],
 *   issued: { "date-parts": [[2015]] },
 *   "custom-key": "kept",
 * })
 *
 * // The ISBN was checksummed and canonicalised into its branded slot; the
 * // unknown key survived in `extra`; the record knows where it came from.
 * assert.strictEqual(record.identifiers.isbn, "9780062316097")
 * assert.deepStrictEqual(record.extra, { "custom-key": "kept" })
 * assert.deepStrictEqual(record.provenance, { source: "csl-json" })
 * ```
 *
 * @since 0.1.0
 */
export function fromCslJson(item: unknown): BiblioRecord {
  const provenance: Provenance = { source: "csl-json" };
  if (!Predicate.isObjectOrArray(item)) {
    return { type: "document", identifiers: {}, provenance };
  }
  const obj = item as Record<string, unknown>;
  const rawType = obj.type;
  const type: CslItemType =
    Predicate.isString(rawType) && isCslItemType(rawType) ? rawType : "document";
  const extra = collectCslExtra(obj);
  return {
    type,
    ...readCslStrings(obj),
    ...readCslNames(obj),
    ...readCslDates(obj),
    identifiers: readCslIdentifiers(obj),
    provenance,
    ...(Record.isEmptyRecord(extra) ? {} : { extra }),
  };
}

/** Reads the modelled CSL string variables, sanitised. */
function readCslStrings(obj: Record<string, unknown>): Partial<Record<CslStringVar, string>> {
  return Record.fromEntries(
    Array.filterMap(
      CSL_STRING_VARS,
      (key): Result.Result<readonly [CslStringVar, string], void> => {
        const value = sanitiseCslString(obj[key]);
        return Option.isNone(value) ? Result.failVoid : Result.succeed([key, value.value] as const);
      },
    ),
  );
}

/** Reads the modelled CSL name variables into structured name lists. */
function readCslNames(
  obj: Record<string, unknown>,
): Partial<Record<CslNameVar, readonly CslName[]>> {
  return Record.fromEntries(
    Array.filterMap(
      CSL_NAME_VARS,
      (key): Result.Result<readonly [CslNameVar, readonly CslName[]], void> => {
        const list = fromCslNameList(obj[key]);
        return Option.isNone(list) ? Result.failVoid : Result.succeed([key, list.value] as const);
      },
    ),
  );
}

/** Reads the modelled CSL date variables into structured dates. */
function readCslDates(obj: Record<string, unknown>): Partial<Record<CslDateVar, CslDate>> {
  return Record.fromEntries(
    Array.filterMap(CSL_DATE_VARS, (key): Result.Result<readonly [CslDateVar, CslDate], void> => {
      const date = fromCslDateValue(obj[key]);
      return Option.isNone(date) ? Result.failVoid : Result.succeed([key, date.value] as const);
    }),
  );
}

/** Validates the free-string CSL identifiers into their branded slots (checksum failures dropped). */
function readCslIdentifiers(obj: Record<string, unknown>): RecordIdentifiers {
  const identifiers: { isbn?: Isbn; doi?: Doi; issn?: Issn } = {};
  if (Predicate.isString(obj.ISBN)) {
    const isbn = decodeIsbn(obj.ISBN);
    if (Option.isSome(isbn)) identifiers.isbn = isbn.value;
  }
  if (Predicate.isString(obj.DOI)) {
    const doi = decodeDoi(obj.DOI);
    if (Option.isSome(doi)) identifiers.doi = doi.value;
  }
  if (Predicate.isString(obj.ISSN)) {
    const issn = decodeIssn(obj.ISSN);
    if (Option.isSome(issn)) identifiers.issn = issn.value;
  }
  return identifiers;
}

/** Captures the CSL keys the model doesn't consume into the passthrough map. */
function collectCslExtra(obj: Record<string, unknown>): Record<string, unknown> {
  return Record.filter(obj, (_value, key) => !HashSet.has(KNOWN_CSL_KEYS, key));
}
