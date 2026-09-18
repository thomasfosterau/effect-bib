/**
 * Node module-resolution hooks that make `effect/unstable/*` unresolvable.
 *
 * Registered by `tests/entry-points.test.ts` in a child process so the built
 * entry points can be loaded against a dependency set where the HTTP surface
 * simply is not there. That is a stronger statement than reading imports out
 * of the source: it exercises the real artifact, so it also catches a graph
 * that only reaches `effect/unstable/http` through `effect`'s own internals.
 * Copied from the effect-jsonapi library.
 */
import { register } from "node:module";

register(
  `data:text/javascript,
    export async function resolve (specifier, context, next) {
      if (specifier === "effect/unstable" || specifier.startsWith("effect/unstable/")) {
        throw new Error("FORBIDDEN_PEER:" + specifier)
      }
      return next(specifier, context)
    }`,
  import.meta.url,
);
