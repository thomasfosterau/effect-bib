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
 * @module biblio/tests/assert
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

/*
 * NOT migrated to `Option`: this helper exists precisely to bridge the plain
 * nullable values a test still meets — array/string indexing (`T | undefined`)
 * and the deliberately-unmigrated cross-slice helpers (`makeCslName`,
 * `parsePersonName`). Taking an `Option` here would make it `expectSome`.
 */
/** `value` narrowed to non-nullish; fails the test when it is `null`/`undefined`. */
// oxlint-disable-next-line effect/prefer-option-over-null -- the helper's whole job is the plain-nullable seam
export function expectPresent<A>(value: A | null | undefined, what = "a value"): A {
  if (value === null || value === undefined) {
    expect.fail(`expected ${what}, got ${String(value)}`);
  }
  return value;
}
