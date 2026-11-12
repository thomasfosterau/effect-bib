---
"@thomasfosterau/effect-bib": patch
---

`parseBibliographicStream` now reads a CRLF line break that falls between two chunks as one break, so the later entries' `SourcePosition.line` matches the whole-file parse (it counted the `\r` and the `\n` as two breaks before). A chunk's trailing `\r` is held until the next chunk or the end of the stream.
