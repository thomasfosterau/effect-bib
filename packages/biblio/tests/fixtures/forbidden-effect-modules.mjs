/**
 * The single list of Effect modules the root entry must never reach: those
 * that sat under `effect/unstable/*` before rc.118. Shared by
 * `entry-points.test.ts` (the import-graph walker) and `forbid-http-peer.mjs`
 * (the resolver hooks), and checked against the installed `effect` by a drift
 * test so a new directory in a later rc cannot slip past it.
 *
 * `effect/testing` is left out (always stable), and so are the stable
 * `effect/encoding/{Base64,Base64Url,Hex,EncodingError}` modules; the rest of
 * `effect/encoding` came from `effect/unstable/encoding`.
 */

/** Directories of `effect/` (`effect/<dir>` and `effect/<dir>/*`) that were unstable. */
export const FORBIDDEN_DIRECTORIES = [
  "ai",
  "cli",
  "cluster",
  "devtools",
  "eventlog",
  "http",
  "http-api",
  "net",
  "observability",
  "persistence",
  "process",
  "reactivity",
  "rpc",
  "schema",
  "socket",
  "sql",
  "workers",
  "workflow",
];

/** Modules of `effect/encoding/` that were unstable. */
export const FORBIDDEN_ENCODING_MODULES = ["Ini", "Ndjson", "SchemaBinary", "Sse", "Toml", "Yaml"];

/** Matches a module specifier that resolves into the forbidden set. */
export const FORBIDDEN_SPECIFIER = new RegExp(
  `^effect/(?:(?:${FORBIDDEN_DIRECTORIES.join("|")})(?:/|$)|encoding/(?:${FORBIDDEN_ENCODING_MODULES.join("|")})$)`,
);
