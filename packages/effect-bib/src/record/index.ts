/**
 * The record model alone: {@link BiblioRecord} and its CSL Schema, the
 * validated identifier brands and their decoders, the provenance envelope,
 * and the CSL-JSON interop boundary (`toCslJson` / `fromCslJson`). Its module
 * graph reaches `effect` and nothing else, so a consumer that stores or
 * passes records without parsing a bibliography file need not install
 * `@thomasfosterau/effect-parse`, which only the root entry's parsers use.
 * Every name here is also exported from the root entry.
 *
 * @module effect-bib/record
 * @since 0.2.0
 */

export * from "../identifiers.ts";
export * from "../record.ts";
