---
"@thomasfosterau/effect-bib": minor
---

Every value that can be absent is now an `Option` (breaking). `makeCslName` and `parsePersonName` return `Option<CslName>`, `cslNameDisplay` returns `Option<string>`, `yearOf` returns `Option<number>` (and its date parameter is optional), `bestConfidentMatch` returns `Option<T>`, `getStyle` returns `Option<CitationStyle>`, and `IsbnForms.isbn10` is an `Option<string>`. They returned `null` / `undefined` before. Options objects and the `BiblioRecord` wire shape are unchanged.
