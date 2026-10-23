---
"@thomasfosterau/biblio": minor
---

Effect and `Stream` front ends for the file parsers. `parseBibliographic(content, format, options)` returns the outcomes as an `Effect` that fails with the new typed `InputTooLarge` error instead of a `too-large` outcome. `parseBibliographicStream(chunks, format, options)` reads a `Stream` of text chunks and emits each entry's outcome as soon as it is complete — BibTeX (macros carried forward, `crossref` / `xdata` parents from a bounded window or awaited when they come later), RIS and CSV entry by entry with the whole-file parse's positions; CSL-JSON and CSL YAML whole. The pure parsers are unchanged.
