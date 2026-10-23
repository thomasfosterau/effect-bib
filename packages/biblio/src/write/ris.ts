/**
 * Records as an RIS document, the inverse of `parseRis`.
 *
 * @copyright Thomas Foster
 * @module biblio/write/ris
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as String from "effect/String";
import type { BiblioRecord, CslDate, CslItemType, CslName } from "../record.ts";
import { stripCslMarkup } from "../render/markup.ts";
import { ownKey } from "./keys.ts";

/** CSL item type → RIS `TY`; an unlisted type is `GEN`. */
const RIS_TYPES = HashMap.fromIterable<CslItemType, string>([
  ["book", "BOOK"],
  ["article-journal", "JOUR"],
  ["article-magazine", "MGZN"],
  ["article-newspaper", "NEWS"],
  ["chapter", "CHAP"],
  ["paper-conference", "CPAPER"],
  ["thesis", "THES"],
  ["report", "RPRT"],
  ["webpage", "ELEC"],
  ["dataset", "DATA"],
  ["entry-encyclopedia", "ENCYC"],
  ["entry-dictionary", "DICT"],
  ["software", "COMP"],
  ["patent", "PAT"],
  ["manuscript", "MANSCPT"],
  ["map", "MAP"],
  ["motion_picture", "MPCT"],
  ["song", "SOUND"],
  ["standard", "STAND"],
  ["legal_case", "CASE"],
  ["legislation", "STAT"],
  ["bill", "BILL"],
  ["hearing", "HEAR"],
  ["graphic", "ART"],
  ["pamphlet", "PAMP"],
  ["personal_communication", "PCOMM"],
  ["post-weblog", "BLOG"],
]);

/** One RIS line, or none: a value is one line of plain text. */
const tag = (name: string, value: Option.Option<string>): Option.Option<string> =>
  Option.map(
    Option.filter(value, (text) => String.isNonEmpty(text.trim())),
    (text) => `${name}  - ${stripCslMarkup(text).replace(/\s+/g, " ").trim()}`,
  );

/** One name in RIS's `Last, First, Suffix` form (a literal name as written). */
function risName(name: CslName): string {
  if (name.literal !== undefined) return name.literal;
  const particle = name["non-dropping-particle"] ?? name["dropping-particle"];
  const family = particle === undefined ? (name.family ?? "") : `${particle} ${name.family ?? ""}`;
  return [family, name.given ?? "", ...(name.suffix === undefined ? [] : [name.suffix])].join(", ");
}

/** A name list, one tag per name. */
const names = (name: string, list: Option.Option<readonly CslName[]>): Option.Option<string>[] =>
  Option.getOrElse(list, (): readonly CslName[] => []).map((entry) =>
    tag(name, Option.some(risName(entry))),
  );

/** A date as RIS's `YYYY/MM/DD/` (with the parts it has), or its literal or raw text. */
function risDate(date: CslDate): Option.Option<string> {
  const parts = date["date-parts"]?.[0] ?? [];
  if (Array.isReadonlyArrayEmpty(parts)) return Option.fromUndefinedOr(date.literal ?? date.raw);
  const two = (index: number): string =>
    Option.match(Array.get(parts, index), {
      onNone: () => "",
      onSome: (value) => value.toString().padStart(2, "0"),
    });
  return Option.some(`${parts[0].toString().padStart(4, "0")}/${two(1)}/${two(2)}/`);
}

/** The first and last page of a CSL `page` range. */
function pages(page: Option.Option<string>): Option.Option<string>[] {
  if (Option.isNone(page)) return [];
  const [first, ...rest] = page.value.split(/\s*[-–]+\s*/);
  return [tag("SP", Option.some(first)), tag("EP", Option.some(rest.join("-")))];
}

/** One record as an RIS record, from its `TY` line to its `ER` line. */
function writeRecord(record: BiblioRecord): string {
  const { isbn, issn, doi } = record.identifiers;
  const year = Option.flatMap(
    Option.fromUndefinedOr(record.issued?.["date-parts"]?.[0]?.[0]),
    (value) => Option.some(value.toString()),
  );
  const lines = Array.getSomes([
    tag("TY", Option.some(Option.getOrElse(HashMap.get(RIS_TYPES, record.type), () => "GEN"))),
    tag("ID", ownKey(record)),
    tag("TI", Option.fromUndefinedOr(record.title)),
    tag("ST", Option.fromUndefinedOr(record["title-short"])),
    ...names("AU", Option.fromUndefinedOr(record.author)),
    ...names("ED", Option.fromUndefinedOr(record.editor)),
    ...names("A4", Option.fromUndefinedOr(record.translator)),
    tag("T2", Option.fromUndefinedOr(record["container-title"])),
    tag("J2", Option.fromUndefinedOr(record["container-title-short"])),
    tag("T3", Option.fromUndefinedOr(record["collection-title"])),
    tag("PY", year),
    tag("DA", Option.flatMap(Option.fromUndefinedOr(record.issued), risDate)),
    tag("VL", Option.fromUndefinedOr(record.volume)),
    tag("IS", Option.fromUndefinedOr(record.issue)),
    ...pages(Option.fromUndefinedOr(record.page)),
    tag("ET", Option.fromUndefinedOr(record.edition)),
    tag("PB", Option.fromUndefinedOr(record.publisher)),
    tag("CY", Option.fromUndefinedOr(record["publisher-place"])),
    tag("SN", Option.fromUndefinedOr(isbn)),
    tag("SN", Option.fromUndefinedOr(issn)),
    tag("DO", Option.fromUndefinedOr(doi)),
    tag("UR", Option.fromUndefinedOr(record.URL)),
    tag("LA", Option.fromUndefinedOr(record.language)),
    tag("M3", Option.fromUndefinedOr(record.genre)),
    ...(record.keyword ?? "").split(/\s*[,;]\s*/).map((keyword) => tag("KW", Option.some(keyword))),
    tag("AB", Option.fromUndefinedOr(record.abstract)),
    tag("N1", Option.fromUndefinedOr(record.note)),
  ]);
  return [...lines, "ER  - "].join("\r\n");
}

/**
 * Writes records as an RIS document, the inverse of {@link parseRis}: one
 * record per item, from its `TY` line (the CSL item type mapped to an RIS
 * type, `GEN` when RIS has none) to its `ER` line, with CRLF line ends as
 * the format specifies. Names are written `Last, First, Suffix`, a literal
 * (corporate) name as written; the date as `PY` (the year) and `DA`
 * (`YYYY/MM/DD/`); the page range as `SP` / `EP`; the ISBN and ISSN each as
 * an `SN`; the record's own key as `ID`. Text variables are written plain,
 * their CSL markup dropped, since RIS has none. Pure and total.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { fromCslJson, parseRis, toRis } from "@thomasfosterau/biblio"
 *
 * const record = fromCslJson({
 *   id: "kuhn1962",
 *   type: "book",
 *   title: "The Structure of Scientific Revolutions",
 *   author: [{ family: "Kuhn", given: "Thomas S." }],
 *   issued: { "date-parts": [[1962]] },
 *   ISBN: "9780226458083",
 * })
 *
 * const ris = toRis([record])
 * assert.deepStrictEqual(ris.split("\r\n").slice(0, 4), [
 *   "TY  - BOOK",
 *   "ID  - kuhn1962",
 *   "TI  - The Structure of Scientific Revolutions",
 *   "AU  - Kuhn, Thomas S.",
 * ])
 *
 * const [parsed] = parseRis(ris)
 * assert.strictEqual(parsed.outcome === "parsed" ? parsed.record.identifiers.isbn : undefined, "9780226458083")
 * ```
 *
 * @since 1.0.0
 */
export function toRis(records: readonly BiblioRecord[]): string {
  return Array.isReadonlyArrayEmpty(records)
    ? ""
    : `${records.map(writeRecord).join("\r\n\r\n")}\r\n`;
}
