---
"@thomasfosterau/biblio": patch
---

Depends on `@thomasfosterau/effect-parse` 0.2.0 (was 0.1.0): the BibTeX grammars compile with `Compiler.closure` (still no `new Function`, so a Content Security Policy is unaffected), and `parseBibtex` stops scanning a document once it reaches the record cap instead of reading to the end. Output is unchanged.
