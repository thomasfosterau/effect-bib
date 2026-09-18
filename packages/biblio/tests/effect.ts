/**
 * Effect test helpers for this package's unit suite — the two functions the
 * website application's `@thomasfosterau/test-helpers/effect` provided, kept
 * here so the suite depends on nothing outside the package.
 *
 * Why not `@effect/vitest`: its `describe`/`it` wrappers read vitest
 * internals that the Vite+ vitest alias does not expose — importing it fails
 * at module evaluation with `TypeError: Cannot read properties of undefined
 * (reading 'config')` (website, June 2026). Provide layers per test with
 * `Effect.provide` at the call site, per the effect-solutions testing guide.
 *
 * @module biblio/tests/effect
 */

import { expect } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

/** Run a fully-provided Effect to a Promise of its success value. */
export const runTest = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(effect);

/**
 * Run a fully-provided Effect expected to fail with an instance of the
 * given error class; returns the failure so callers can assert on its
 * fields.
 */
export const expectFailureInstanceOf = async <A, E>(
  program: Effect.Effect<A, E, never>,
  errorClass: abstract new (...args: never[]) => unknown,
): Promise<E> => {
  const exit = await Effect.runPromiseExit(program);

  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) throw new Error("Expected a failure exit");
  const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(failure).toBeInstanceOf(errorClass);
  return failure;
};
