---
"@thomasfosterau/effect-bib": minor
---

Add a `./record` entry point exporting the record model alone (`BiblioRecord` and its CSL schemas, provenance, the identifier brands and decoders, `toCslJson` / `fromCslJson` and the name, date and sanitising helpers), whose module graph reaches `effect` and nothing else. `@thomasfosterau/effect-parse` is now an optional peer dependency with the range `^0.4.1 || ^0.5.0` instead of an exact dependency: install it alongside to use the root entry's parsers; a consumer of `./record` alone needs no effect-parse. The BibTeX scanner imports effect-parse's `/Parser`, `/Token` and `/Compiler` subpaths instead of its root barrel.
