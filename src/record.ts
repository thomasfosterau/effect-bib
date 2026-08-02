/**
 * @copyright Thomas Foster
 *
 * The CSL-aligned bibliographic record — the neutral centre of the
 * toolkit (biblio B2, issue #1069; design in
 * docs/decisions/bibliographic-toolkit.md).
 *
 * A {@link BiblioRecord} is a typed **superset of CSL-JSON**: its core is
 * the closed CSL 1.0.2 vocabulary (item types, standard/name/date
 * variables) modelled as Effect Schema, and its additions are strictly
 * additive — first-class **checksummed identifiers**
 * ({@link module:biblio/identifiers}), a **source provenance** envelope,
 * and a **passthrough** map that carries CSL variables we don't model
 * verbatim. Two total functions at the interop boundary make "typed
 * superset" precise: {@link toCslJson} projects a record to plain,
 * schema-valid CSL-JSON (dropping provenance, re-merging the passthrough),
 * and {@link fromCslJson} leniently decodes any CSL-JSON item into a record
 * (validating identifiers where present, capturing unknown keys), never
 * throwing on partial or hostile input.
 *
 * The **CSL → WEMI lift is not this module's job** — mapping a record onto
 * the site's FRBR/LRM spine is apps/api business logic (B4, #1071, landed).
 * The package stops at the CSL record.
 *
 * Everything here is pure and persistence-free.
 *
 * @module biblio/record
 */

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
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

// ── Field bounds & untrusted-text sanitisers (survive from pre-B2) ────

/**
 * Upper bound on any single free-text field copied from an untrusted
 * source. Clamped before persistence so a hostile or malformed value
 * can't push an unbounded blob downstream (defence in depth).
 */
export const MAX_TEXT_FIELD_LENGTH = 2000;

/** Cap on how many contributors we extract from a single record. */
export const MAX_AUTHORS = 100;

/** The narrowest plausible publication year we accept. */
const MIN_PUBLICATION_YEAR = 1;
/** Guard against absurd future years. */
const MAX_PUBLICATION_YEAR = 2200;

/**
 * Trims, collapses, and length-clamps an untrusted free-text value.
 * Returns `null` for empty / whitespace-only or non-string input.
 */
// reason: this clamp is duplicated verbatim in the sibling extraction-
// trajectory packages (e.g. wikidata's candidate.ts) by design — the
// `.fallowrc.json` zone rule `{ from: "biblio", allow: [] }` forbids biblio
// depending on any website-internal package, so each self-contained package
// must carry its own untrusted-text sanitiser. Consolidating would break the
// extraction property the whole package is built around.
export function sanitiseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, MAX_TEXT_FIELD_LENGTH);
}

/**
 * Coerces an untrusted value to a plausible publication year, or `null`.
 * Accepts a number or a numeric string; rejects non-integers and years
 * outside {@link MIN_PUBLICATION_YEAR} … {@link MAX_PUBLICATION_YEAR}.
 */
export function sanitiseYear(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n)) return null;
  if (n < MIN_PUBLICATION_YEAR || n > MAX_PUBLICATION_YEAR) return null;
  return n;
}

/** Sanitises a CSL string variable that upstreams may send as a number (e.g. `volume`). */
function sanitiseCslString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return sanitiseText(String(value));
  return sanitiseText(value);
}

// ── CSL vocabulary (modelled from the spec, not invented) ─────────────

/**
 * The CSL 1.0.2 item types, a closed enumeration. The site handles a
 * subset as first-class; the rest are carried so a round-trip never loses
 * an external tool's type. `document` is the neutral fallback
 * {@link fromCslJson} assigns to an unknown or missing type.
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
export type CslItemType = typeof CslItemType.Type;

const CSL_ITEM_TYPES: ReadonlySet<string> = new Set(CslItemType.literals);

/** Narrows an arbitrary string to a known CSL item type. */
export function isCslItemType(value: string): value is CslItemType {
  return CSL_ITEM_TYPES.has(value);
}

/**
 * A CSL structured name. Replaces the pre-B2 bare `{ name: string }` — a
 * name is a structure, and rendering, dedup, and the WEMI lift all need
 * its parts. The `orcid` field is the superset addition (a first-class
 * contributor identity, checksum-validated).
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
export type CslName = typeof CslName.Type;

/**
 * A CSL structured date. Replaces the pre-B2 lone `publicationYear` — the
 * year is `issued["date-parts"][0][0]`, but month / day / range / `raw`
 * are no longer discarded.
 */
export const CslDate = Schema.Struct({
  "date-parts": Schema.optional(Schema.Array(Schema.Array(Schema.Finite))),
  season: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
  circa: Schema.optional(Schema.Union([Schema.Boolean, Schema.Finite, Schema.String])),
  literal: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.String),
});
export type CslDate = typeof CslDate.Type;

/**
 * The first-class, checksum-validated identifiers of a record. Plain
 * CSL-JSON carries these as free strings; the superset lifts them into
 * branded values so "a string that looks like an ISBN" and "a proven
 * ISBN" are different types at every call site.
 */
export const RecordIdentifiers = Schema.Struct({
  isbn: Schema.optional(Isbn),
  doi: Schema.optional(Doi),
  issn: Schema.optional(Issn),
});
export type RecordIdentifiers = typeof RecordIdentifiers.Type;

/** The external authority (or channel) a record came from. */
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
export type ProvenanceSource = typeof ProvenanceSource.Type;

/**
 * Where a record came from and by what retrieval identity. Replaces the
 * pre-B2 overloaded `source` + `authorityId` pair (which conflated "which
 * API" with "the dedup key"). This envelope is dropped by {@link toCslJson}
 * — it is not part of CSL — and is what lets dedup weigh cross-source
 * agreement and the B4 lift stamp created-Entity provenance.
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
export type Provenance = typeof Provenance.Type;

/**
 * The neutral bibliographic record. Its CSL core (item type + standard /
 * name / date variables, keyed by their CSL-JSON names) projects
 * losslessly to CSL-JSON; `identifiers`, `provenance`, and `extra` are the
 * strictly-additive superset. Every string field is sanitised before it
 * lands here — consumers treat these as trusted application values.
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
const KNOWN_CSL_KEYS: ReadonlySet<string> = new Set<string>([
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

/**
 * Builds a sanitised {@link CslName} from loose parts, dropping empty
 * fields and validating an ORCID where present. Returns `null` when the
 * result carries nothing usable.
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
  if (family !== null) name.family = family;
  const given = sanitiseText(parts.given);
  if (given !== null) name.given = given;
  const dropping = sanitiseText(parts.droppingParticle);
  if (dropping !== null) name["dropping-particle"] = dropping;
  const nonDropping = sanitiseText(parts.nonDroppingParticle);
  if (nonDropping !== null) name["non-dropping-particle"] = nonDropping;
  const suffix = sanitiseText(parts.suffix);
  if (suffix !== null) name.suffix = suffix;
  const literal = sanitiseText(parts.literal);
  if (literal !== null) name.literal = literal;
  if (typeof parts.orcid === "string") {
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
 */
export function parsePersonName(raw: string): CslName | null {
  const cleaned = sanitiseText(raw);
  if (cleaned === null) return null;
  const comma = cleaned.indexOf(",");
  if (comma >= 0) {
    return makeCslName({ family: cleaned.slice(0, comma), given: cleaned.slice(comma + 1) });
  }
  const tokens = cleaned.split(" ").filter((t) => t.length > 0);
  if (tokens.length <= 1) return makeCslName({ family: cleaned });
  return makeCslName({ family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(" ") });
}

/**
 * The display form of a {@link CslName}: the CSL `literal` verbatim, else
 * `"Given Family"`, else the family name alone. `null` when empty.
 */
export function cslNameDisplay(name: CslName): string | null {
  if (name.literal !== undefined) return name.literal;
  if (name.family !== undefined) {
    return name.given !== undefined ? `${name.given} ${name.family}` : name.family;
  }
  return name.given ?? null;
}

/** A structured {@link CslDate} carrying just a year in `date-parts`. */
export function dateFromYear(year: number): CslDate {
  return { "date-parts": [[year]] };
}

/** The year of a {@link CslDate} — `date-parts[0][0]`, sanitised — or `null`. */
export function yearOf(date: CslDate | undefined): number | null {
  const first = date?.["date-parts"]?.[0]?.[0];
  return first === undefined ? null : sanitiseYear(first);
}

// ── CSL-JSON interop ──────────────────────────────────────────────────

/** A plain CSL-JSON item object (the interchange shape). */
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
 */
export function toCslJson(record: BiblioRecord): CslJsonItem {
  const out: CslJsonItem = {};
  // Passthrough first so modelled fields win over any stale carried key.
  if (record.extra !== undefined) {
    for (const [key, value] of Object.entries(record.extra)) out[key] = value;
  }
  out.type = record.type;
  for (const key of CSL_STRING_VARS) {
    const value = record[key as CslStringVar];
    if (value !== undefined) out[key] = value;
  }
  for (const key of CSL_NAME_VARS) {
    const value = record[key as CslNameVar];
    if (value !== undefined) out[key] = value.map(nameToCsl);
  }
  for (const key of CSL_DATE_VARS) {
    const value = record[key as CslDateVar];
    if (value !== undefined) out[key] = dateToCsl(value);
  }
  const { isbn, doi, issn } = record.identifiers;
  if (isbn !== undefined) out.ISBN = isbn as string;
  if (doi !== undefined) out.DOI = doi;
  if (issn !== undefined) out.ISSN = issn;
  return out;
}

/**
 * Reads one CSL name value into a structured {@link CslName}, or `null`.
 * Tolerates the Zotero single-field `name` as a `literal` fallback. Shared
 * by the CSL-JSON parser so name structuring lives in one place.
 */
export function readCslName(entry: unknown): CslName | null {
  if (typeof entry !== "object" || entry === null) return null;
  const obj = entry as Record<string, unknown>;
  return makeCslName({
    family: obj.family,
    given: obj.given,
    droppingParticle: obj["dropping-particle"],
    nonDroppingParticle: obj["non-dropping-particle"],
    suffix: obj.suffix,
    literal: obj.literal ?? obj.name,
    orcid: obj.orcid,
  });
}

/**
 * Reads a bounded list of CSL names, dropping non-object / empty entries.
 * Shared by the CSL-JSON parser so the name-list bound lives in one place.
 */
export function readCslNameArray(value: unknown): CslName[] {
  if (!Array.isArray(value)) return [];
  const names: CslName[] = [];
  for (const entry of value) {
    if (names.length >= MAX_AUTHORS) break;
    const name = readCslName(entry);
    if (name !== null) names.push(name);
  }
  return names;
}

/** As {@link readCslNameArray}, but folds an empty list to `undefined` for the record spread. */
function fromCslNameList(value: unknown): readonly CslName[] | undefined {
  const names = readCslNameArray(value);
  return names.length > 0 ? names : undefined;
}

/** Cleans an untrusted CSL `date-parts` value to numeric parts, or `undefined`. */
function cleanDateParts(parts: unknown): number[][] | undefined {
  if (!Array.isArray(parts)) return undefined;
  const cleaned: number[][] = [];
  for (const part of parts) {
    if (!Array.isArray(part)) continue;
    const nums = part.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    if (nums.length > 0) cleaned.push(nums);
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

/** A CSL `season` is a string or a number (1–4), else absent. */
function readSeason(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

/** A CSL `circa` flag is a boolean, number, or string, else absent. */
function readCirca(value: unknown): boolean | number | string | undefined {
  return typeof value === "boolean" || typeof value === "number" || typeof value === "string"
    ? value
    : undefined;
}

/** Reads one CSL date value into a structured {@link CslDate}, or `undefined`. */
function fromCslDateValue(value: unknown): CslDate | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  const date: {
    "date-parts"?: readonly (readonly number[])[];
    season?: string | number;
    circa?: boolean | number | string;
    literal?: string;
    raw?: string;
  } = {};
  const parts = cleanDateParts(obj["date-parts"]);
  if (parts !== undefined) date["date-parts"] = parts;
  const season = readSeason(obj.season);
  if (season !== undefined) date.season = season;
  const circa = readCirca(obj.circa);
  if (circa !== undefined) date.circa = circa;
  const literal = sanitiseText(obj.literal);
  if (literal !== null) date.literal = literal;
  const raw = sanitiseText(obj.raw);
  if (raw !== null) date.raw = raw;
  return Object.keys(date).length > 0 ? date : undefined;
}

/**
 * Leniently decodes any CSL-JSON item into a {@link BiblioRecord}. Never
 * throws: a non-object, partial, or hostile item decodes to a thinner
 * record (item type `document`, empty identifiers), never an error.
 * Identifiers are validated where present — a checksum failure drops the
 * identifier rather than the record. Unknown CSL keys survive in `extra`.
 * The record is stamped `provenance.source: "csl-json"`.
 */
export function fromCslJson(item: unknown): BiblioRecord {
  const provenance: Provenance = { source: "csl-json" };
  if (typeof item !== "object" || item === null) {
    return { type: "document", identifiers: {}, provenance };
  }
  const obj = item as Record<string, unknown>;
  const rawType = obj.type;
  const type: CslItemType =
    typeof rawType === "string" && CSL_ITEM_TYPES.has(rawType)
      ? (rawType as CslItemType)
      : "document";
  const extra = collectCslExtra(obj);
  return {
    type,
    ...readCslStrings(obj),
    ...readCslNames(obj),
    ...readCslDates(obj),
    identifiers: readCslIdentifiers(obj),
    provenance,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/** Reads the modelled CSL string variables, sanitised. */
function readCslStrings(obj: Record<string, unknown>): Partial<Record<CslStringVar, string>> {
  const strings: Partial<Record<CslStringVar, string>> = {};
  for (const key of CSL_STRING_VARS) {
    const value = sanitiseCslString(obj[key]);
    if (value !== null) strings[key] = value;
  }
  return strings;
}

/** Reads the modelled CSL name variables into structured name lists. */
function readCslNames(
  obj: Record<string, unknown>,
): Partial<Record<CslNameVar, readonly CslName[]>> {
  const names: Partial<Record<CslNameVar, readonly CslName[]>> = {};
  for (const key of CSL_NAME_VARS) {
    const list = fromCslNameList(obj[key]);
    if (list !== undefined) names[key] = list;
  }
  return names;
}

/** Reads the modelled CSL date variables into structured dates. */
function readCslDates(obj: Record<string, unknown>): Partial<Record<CslDateVar, CslDate>> {
  const dates: Partial<Record<CslDateVar, CslDate>> = {};
  for (const key of CSL_DATE_VARS) {
    const date = fromCslDateValue(obj[key]);
    if (date !== undefined) dates[key] = date;
  }
  return dates;
}

/** Validates the free-string CSL identifiers into their branded slots (checksum failures dropped). */
function readCslIdentifiers(obj: Record<string, unknown>): RecordIdentifiers {
  const identifiers: { isbn?: Isbn; doi?: Doi; issn?: Issn } = {};
  if (typeof obj.ISBN === "string") {
    const isbn = decodeIsbn(obj.ISBN);
    if (Option.isSome(isbn)) identifiers.isbn = isbn.value;
  }
  if (typeof obj.DOI === "string") {
    const doi = decodeDoi(obj.DOI);
    if (Option.isSome(doi)) identifiers.doi = doi.value;
  }
  if (typeof obj.ISSN === "string") {
    const issn = decodeIssn(obj.ISSN);
    if (Option.isSome(issn)) identifiers.issn = issn.value;
  }
  return identifiers;
}

/** Captures the CSL keys the model doesn't consume into the passthrough map. */
function collectCslExtra(obj: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!KNOWN_CSL_KEYS.has(key)) extra[key] = value;
  }
  return extra;
}
