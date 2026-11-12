/**
 * @copyright Thomas Foster
 *
 * Narrowing assertion helpers for this package's unit suite.
 *
 * They stand in for the `!` non-null assertion and `Option.getOrThrow` at
 * test call sites: a missing value fails the assertion with a message that
 * names what was expected, instead of surfacing later as a bare `TypeError`
 * on a property access (or an untyped `Option.getOrThrow` throw).
 *
 * @module effect-bib/tests/assert
 */

import * as Option from "effect/Option";
import { expect } from "vite-plus/test";

/** The value inside a `Some`; fails the test when the Option is `None`. */
export function expectSome<A>(option: Option.Option<A>, what = "a value"): A {
  return Option.match(option, {
    onNone: () => expect.fail(`expected Option.some(${what}), got Option.none()`),
    onSome: (value) => value,
  });
}
