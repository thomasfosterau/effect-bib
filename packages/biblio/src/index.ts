/**
 * The pure, network-free half of the toolkit: the CSL-aligned
 * {@link BiblioRecord} and its interop boundary, the branded checksummed
 * identifiers, the bibliographic-file parsers, same-work dedup scoring and
 * citation rendering. Depends on `effect` and, for the BibTeX parser,
 * `@thomasfosterau/effect-parse`, never on `effect/http`, so a browser
 * bundle that imports it never loads the lookup sources (those are the
 * `./sources` entry point).
 *
 * @module biblio
 * @since 0.1.0
 */

export * from "./dedup-match.ts";
export * from "./identifiers.ts";
export * from "./parse.ts";
export * from "./record.ts";
export * from "./render/index.ts";
