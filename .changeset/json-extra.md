---
"@thomasfosterau/effect-bib": minor
---

`BiblioRecord.extra` and `toCslJson`'s `CslJsonItem` are now typed as JSON (`Record<string, Schema.Json>`) instead of `Record<string, unknown>`, so `fromCslJson(toCslJson(record))` type-checks with no decode step. Every stored `extra` came from JSON, so decoding is unchanged; code that wrote a non-JSON value (a function, a `Date`, `undefined`) into `extra` no longer compiles, and `fromCslJson` now drops such a member from a hostile input rather than carrying it.
