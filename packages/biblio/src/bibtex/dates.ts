/**
 * BibTeX and BibLaTeX dates as CSL dates: BibLaTeX's ISO 8601 / EDTF
 * `date` fields (`2015-03-14`, ranges `2001/2004`, open ranges `2001/..`,
 * seasons `2015-21`, approximate `2015~`), and BibTeX's `year` / `month` /
 * `day` triple. A value that does not parse is kept as the date's `literal`.
 *
 * @copyright Thomas Foster
 * @module biblio/bibtex/dates
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as String from "effect/String";
import type * as Types from "effect/Types";
import { type CslDate, sanitiseText, sanitiseYear } from "../record.ts";

/** One EDTF / ISO 8601 date: a year of up to four digits, optional month (or season 21–24) and day, and a qualifier. */
const EDTF_DATE = /^(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?([?~%]?)$/;

/** A date's parts and whether it was qualified as approximate or uncertain. */
interface DatePoint {
  readonly parts: readonly number[];
  readonly season: Option.Option<number>;
  readonly circa: boolean;
}

/** Reads one EDTF date point, or `None` when its year, month or day is out of range. */
function readPoint(text: string): Option.Option<DatePoint> {
  const match = EDTF_DATE.exec(text.trim());
  if (match === null) return Option.none();
  const [, rawYear, rawMonth, rawDay, qualifier] = match;
  const year = sanitiseYear(rawYear);
  if (Option.isNone(year)) return Option.none();
  const circa = String.isNonEmpty(qualifier);
  if (rawMonth === undefined)
    return Option.some({ parts: [year.value], season: Option.none(), circa });
  const month = Number(rawMonth);
  if (month >= 21 && month <= 24 && rawDay === undefined) {
    return Option.some({ parts: [year.value], season: Option.some(month - 20), circa });
  }
  if (month < 1 || month > 12) return Option.none();
  if (rawDay === undefined)
    return Option.some({ parts: [year.value, month], season: Option.none(), circa });
  const day = Number(rawDay);
  if (day < 1 || day > 31) return Option.none();
  return Option.some({ parts: [year.value, month, day], season: Option.none(), circa });
}

/** True for the open end of an EDTF range (`2001/` or `2001/..`). */
const isOpenEnd = (text: string): boolean => text.trim() === "" || text.trim() === "..";

/** Builds a CSL date from a start point and an optional end point. */
function toCslDate(
  start: DatePoint,
  end: Option.Option<DatePoint>,
  raw: Option.Option<string>,
): CslDate {
  const date: Types.Mutable<CslDate> = {
    "date-parts": Option.match(end, {
      onNone: () => [[...start.parts]],
      onSome: (last) => [[...start.parts], [...last.parts]],
    }),
  };
  if (Option.isSome(start.season) && Option.isNone(end)) date.season = start.season.value;
  if (start.circa || Option.exists(end, (last) => last.circa)) date.circa = true;
  if (Option.isSome(raw)) date.raw = raw.value;
  return date;
}

/**
 * Parses an EDTF / ISO 8601 date or range into a CSL date with full
 * `date-parts`. An open range keeps its start in `date-parts` and the
 * original text in `raw`. `None` when the text is not such a date.
 */
function parseEdtf(text: string): Option.Option<CslDate> {
  const sides = text.split("/");
  if (sides.length > 2) return Option.none();
  const start = readPoint(sides[0]);
  if (Option.isNone(start)) return Option.none();
  if (sides.length === 1) return Option.some(toCslDate(start.value, Option.none(), Option.none()));
  if (isOpenEnd(sides[1]))
    return Option.some(toCslDate(start.value, Option.none(), Option.some(text.trim())));
  return Option.map(readPoint(sides[1]), (end) =>
    toCslDate(start.value, Option.some(end), Option.none()),
  );
}

/**
 * Reads a BibLaTeX date field: an EDTF date or range, else the sanitised text
 * as the date's `literal` (`forthcoming`, `in press`). `None` for an empty
 * value.
 *
 * @since 0.1.0
 */
export function readBibtexDate(text: string): Option.Option<CslDate> {
  const clean = sanitiseText(text);
  if (Option.isNone(clean)) return Option.none();
  return Option.orElse(parseEdtf(clean.value), () => Option.some({ literal: clean.value }));
}

/** English month names and abbreviations (lower-cased, without a period) → month number. */
const MONTHS = HashMap.fromIterable<string, number>(
  Array.flatMap(
    [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ],
    (name, index) => [
      [name, index + 1],
      [name.slice(0, 3), index + 1],
    ],
  ),
);

/**
 * Reads a BibTeX `month` value (a number, an English name or its
 * abbreviation, as the `jan` … `dec` macros expand to) as a month number.
 *
 * @since 0.1.0
 */
export function readMonth(text: string): Option.Option<number> {
  const clean = text.trim().toLowerCase().replace(/\.$/, "");
  const numeric = Number(clean);
  if (Number.isInteger(numeric) && String.isNonEmpty(clean)) {
    return numeric >= 1 && numeric <= 12 ? Option.some(numeric) : Option.none();
  }
  return HashMap.get(MONTHS, clean);
}

/**
 * Reads a BibTeX `day` value as a day number (1–31).
 *
 * @since 0.1.0
 */
export function readDay(text: string): Option.Option<number> {
  const day = Number(text.trim());
  return Number.isInteger(day) && day >= 1 && day <= 31 ? Option.some(day) : Option.none();
}

/**
 * Builds a date from BibTeX's `year`, `month` and `day`: the year is read
 * like a BibLaTeX date (so `2001/2004` is a range and `in press` a literal),
 * and a month and day refine a single plain year.
 *
 * @since 0.1.0
 */
export function dateFromParts(
  year: string,
  month: Option.Option<number>,
  day: Option.Option<number>,
): Option.Option<CslDate> {
  return Option.map(readBibtexDate(year), (date) => {
    const parts = date["date-parts"];
    if (parts === undefined || parts.length !== 1 || parts[0].length !== 1) return date;
    if (Option.isNone(month)) return date;
    const refined = Option.isSome(day)
      ? [parts[0][0], month.value, day.value]
      : [parts[0][0], month.value];
    return { ...date, "date-parts": [refined] };
  });
}
