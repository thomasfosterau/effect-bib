---
"@thomasfosterau/biblio": patch
---

Upstream and file-import values are parsed with Effect Schema decoders instead of hand-rolled type checks; the decoded output is unchanged. Two fixes come with it: a type, style or reference-class lookup keyed by an inherited object key (`constructor`, `toString`, …) now falls back to the default instead of returning a function (`getStyle("toString")` is `undefined`; a Crossref / OpenAlex / RIS type of `"constructor"` maps to the fallback type). `isbnForms` now names its return type, `IsbnForms`, and `builtInStyles` is typed as its two entries (`apa`, `vancouver`) rather than an open string record; look a style up by arbitrary id with `getStyle`.
