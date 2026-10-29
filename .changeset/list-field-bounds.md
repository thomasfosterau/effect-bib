---
"@thomasfosterau/biblio": patch
---

A BibLaTeX list field (`publisher`, `location` / `address`, `institution`, `organization`) is now clamped and charged to the decoding budget once, as a whole, before it is split. At most `maxAuthors` items are kept, and the joined text is clamped to the field length. The split is a single linear pass. Before this change a huge list field was split before any bound applied, and long runs of blanks could make the separator pattern backtrack quadratically.
