/**
 * Node module-resolution hooks that make the `effect` platform modules
 * (`effect/http`, `effect/sql`, ...) unresolvable; the set
 * is `forbidden-effect-modules.mjs`.
 *
 * Registered by `tests/entry-points.test.ts` in a child process, so loading
 * the built entries also catches a graph that reaches `effect/http` only
 * through `effect`'s own internals.
 */
import { register } from "node:module";
import { FORBIDDEN_SPECIFIER } from "./forbidden-effect-modules.mjs";

// The pattern reaches the hooks thread through `initialize`'s `data`, so no
// value is spliced into the hook source. `FORBID_ALSO`, when set, is a second
// pattern blocked alongside it: the `./record` cases pass
// `@thomasfosterau/effect-parse` there.
const also = process.env["FORBID_ALSO"];
const source =
  also === undefined ? FORBIDDEN_SPECIFIER.source : `(?:${FORBIDDEN_SPECIFIER.source})|(?:${also})`;
register(
  `data:text/javascript,
    let forbidden;
    export async function initialize ({ source }) {
      forbidden = new RegExp(source)
    }
    export async function resolve (specifier, context, next) {
      if (forbidden.test(specifier)) {
        throw new Error("FORBIDDEN_PEER:" + specifier)
      }
      return next(specifier, context)
    }`,
  { parentURL: import.meta.url, data: { source } },
);
