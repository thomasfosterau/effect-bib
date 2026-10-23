---
"@thomasfosterau/biblio": patch
---

`parseBibliographicStream` bounds its work across the whole stream: BibTeX macro expansion and inherited-field decoding spend one shared budget (growing with the input read) instead of a fresh one per batch, each parsed document stays within `maxInputLength` (a batch is split, and an entry whose context would not fit is read without it), the macros and parents re-read with each batch are limited to the ones its entries use and to a context budget of four times the input read, the cross-reference window is bounded by length as well as by count, and a CSL-JSON or CSL YAML stream fails with `InputTooLarge` as soon as it passes the cap rather than after reading everything.
