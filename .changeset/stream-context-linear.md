---
"@thomasfosterau/biblio": patch
---

`parseBibliographicStream` finds a BibTeX entry's context (the `@string` macros it uses and the parents it cross-references) by name rather than by scanning every definition, finds it once per distinct reference set in a batch, and charges the search to the stream's context budget, so a file with many macros or a large shared parent streams in linear time.
