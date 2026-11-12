/**
 * The RFC-4180 row break, shared by the whole-file CSV reader and the
 * streaming splitter: a line break ends a row unless a `"…"` quote is open.
 * Internal; not exported from `.`.
 *
 * @copyright Thomas Foster
 * @module effect-bib/csv-rows
 * @since 0.1.0
 */

import * as Iterable from "effect/Iterable";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

/**
 * A quoted span (to its closing quote, or to the end of the text while it is
 * still open) or a line break. A `""` escape is two adjacent spans, which
 * leaves the quote state where reading it quote by quote would. Linear: the
 * spans are unambiguous (`[^"]*` stops at the first quote or the end), so
 * nothing backtracks over them.
 */
const SPAN_OR_BREAK = /"[^"]*(?:"|$)|\r\n|\r|\n/g;

/**
 * The row break at or after `from`: the index it starts at and the index
 * after it (CRLF, CR and LF each end a row), or `None` while a quote is
 * still open or no break has arrived. The scan is lazy over the spans and
 * breaks only (never the characters between them, and never an element per
 * character) and stops at the first break outside a quote.
 *
 * @since 0.1.0
 */
export function rowBreak(
  text: string,
  from: number,
): Option.Option<readonly [start: number, end: number]> {
  SPAN_OR_BREAK.lastIndex = from;
  return Iterable.head(
    Iterable.filterMap(
      text.matchAll(SPAN_OR_BREAK),
      (token): Result.Result<readonly [start: number, end: number], void> =>
        token[0].startsWith('"')
          ? Result.failVoid
          : Result.succeed([token.index, token.index + token[0].length] as const),
    ),
  );
}
