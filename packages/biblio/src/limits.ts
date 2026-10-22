/**
 * The shared reading of a caller-supplied bound: a positive integer is used
 * as given, anything else falls back to the default.
 *
 * @copyright Thomas Foster
 * @module biblio/limits
 * @since 1.0.0
 */

import * as Option from "effect/Option";

/**
 * A limit as given, when it is a positive safe integer, else `fallback`.
 *
 * @since 1.0.0
 */
export function limitOr(value: Option.Option<number>, fallback: number): number {
  return Option.getOrElse(
    Option.filter(value, (limit) => Number.isSafeInteger(limit) && limit > 0),
    () => fallback,
  );
}
