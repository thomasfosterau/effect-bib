/**
 * The pure, network-free half of the toolkit: the CSL-aligned
 * {@link BiblioRecord} and its interop boundary, the branded checksummed
 * identifiers, the bibliographic-file parsers and writers, same-work dedup
 * scoring and citation rendering. Depends on `effect` and, for the BibTeX parser,
 * `@thomasfosterau/effect-parse`, never on `effect/http`, so a browser
 * bundle that imports it never loads the lookup sources (those are the
 * `./sources` entry point).
 *
 * @module biblio
 * @since 0.1.0
 */

export * from "./dedup-match.ts";
export * from "./detect.ts";
export * from "./embedded.ts";
export * from "./identifiers.ts";
// Named, not `export *`: `parse.ts` also exports the streaming front end's
// internal `parseBibtexDocument`, which is not part of the package's API.
export {
  type ImportFormat,
  MAX_INPUT_LENGTH,
  MAX_RECORDS,
  parseBibliographicFile,
  parseBibtex,
  parseCslYaml,
  parseCsv,
  type ParsedEntry,
  type ParseMode,
  type ParseOptions,
  type ParseOutcome,
  parseRis,
  parseZoteroJson,
  type SkippedEntry,
  type SkipReason,
  type SourcePosition,
} from "./parse.ts";
export * from "./record.ts";
export * from "./render/index.ts";
export * from "./streaming.ts";
export * from "./write/index.ts";
