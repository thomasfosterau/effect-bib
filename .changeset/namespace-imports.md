---
"@thomasfosterau/effect-bib": minor
---

`CslJsonItem` is now also a schema (`Schema.Record(Schema.String, Schema.Unknown)`), and its type is that schema's `Type`: a readonly string-keyed object, so `toCslJson`'s result is readonly. Internally, Effect's helper modules are imported under their canonical aliases (`Arr`, `P`, `R`, `Str`), with no other change in behaviour.
