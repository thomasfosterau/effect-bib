---
"@thomasfosterau/biblio": minor
---

Two new input formats:

- `parseMedline(content, options?)` reads PubMed / MEDLINE files (PubMed's `.nbib` export).
- `parseRefer(content, options?)` reads Refer / EndNote tagged files.

Each record carries its position. Both formats join `ImportFormat` (`"medline"`, `"refer"`), `parseBibliographicFile` and `detectFormat`, and `parseBibliographicStream` reads them record by record. `ProvenanceSource` gains `"medline"` and `"refer"`. Code that switches exhaustively over `ImportFormat` or `ProvenanceSource` must handle the new members.
