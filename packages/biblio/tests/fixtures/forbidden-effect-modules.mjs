/**
 * The single list of Effect modules the root entry must never reach: those
 * that sat under `effect/unstable/*` before rc.118, and every directory or
 * `effect/encoding` module that `effect` has added since (4.1: `crypto`,
 * `graphql`, `jose`; `Csv`, `JsonArray`, `Json5`, `Jsonc`, `Tar`, `Xml`,
 * `Zip`), so the browser-safe root admits only the stable core. Shared by
 * `entry-points.test.ts` (the import-graph walker) and `forbid-http-peer.mjs`
 * (the resolver hooks), and checked against the installed `effect` by a drift
 * test so a new directory in a later release cannot slip past it. The check is
 * containment: on an older 4.x (down to the 4.0.0 peer floor) the list names
 * modules that release does not have yet.
 *
 * `effect/testing` is left out (always stable), and so are the stable
 * `effect/encoding/{Base64,Base64Url,Hex,EncodingError}` modules; the rest of
 * `effect/encoding` came from `effect/unstable/encoding` or was added later.
 */

/** Directories of `effect/` (`effect/<dir>` and `effect/<dir>/*`) that were unstable or are newer. */
export const FORBIDDEN_DIRECTORIES = [
  "ai",
  "cli",
  "cluster",
  "crypto",
  "devtools",
  "eventlog",
  "graphql",
  "http",
  "http-api",
  "jose",
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

/** Modules of `effect/encoding/` that were unstable or are newer. */
export const FORBIDDEN_ENCODING_MODULES = [
  "Csv",
  "Ini",
  "Json5",
  "JsonArray",
  "Jsonc",
  "Ndjson",
  "SchemaBinary",
  "Sse",
  "Tar",
  "Toml",
  "Xml",
  "Yaml",
  "Zip",
];

/** Matches a module specifier that resolves into the forbidden set. */
export const FORBIDDEN_SPECIFIER = new RegExp(
  `^effect/(?:(?:${FORBIDDEN_DIRECTORIES.join("|")})(?:/|$)|encoding/(?:${FORBIDDEN_ENCODING_MODULES.join("|")})$)`,
);
