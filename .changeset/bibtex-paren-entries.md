---
"@thomasfosterau/biblio": patch
---

`parseBibtex` and `parseBibliographicFile` read entries delimited by parentheses (`@article(key, …)`), which BibTeX and biber accept, as they read the braced form. This covers `@string(…)` and `@comment(…)` too. Before this change such an entry lost its fields. A parenthesised entry ends at the first `)` outside a brace group, as the stream's entry splitter already read it.
