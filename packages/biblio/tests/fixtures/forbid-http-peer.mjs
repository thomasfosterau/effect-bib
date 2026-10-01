/**
 * Node module-resolution hooks that make the modules formerly under
 * `effect/unstable/*` (`effect/http`, `effect/sql`, ...) unresolvable.
 *
 * Registered by `tests/entry-points.test.ts` in a child process so the built
 * entry points can be loaded against a dependency set where the HTTP surface
 * simply is not there. That is a stronger statement than reading imports out
 * of the source: it exercises the real artifact, so it also catches a graph
 * that only reaches `effect/http` through `effect`'s own internals.
 * Copied from the effect-jsonapi library.
 */
import { register } from "node:module";

register(
  `data:text/javascript,
    export async function resolve (specifier, context, next) {
      if (/^effect\\/(?:ai|cli|cluster|devtools|eventlog|http|http-api|net|observability|persistence|process|reactivity|rpc|schema|socket|sql|workers|workflow)(?:\\/|$)/.test(specifier)) {
        throw new Error("FORBIDDEN_PEER:" + specifier)
      }
      return next(specifier, context)
    }`,
  import.meta.url,
);
