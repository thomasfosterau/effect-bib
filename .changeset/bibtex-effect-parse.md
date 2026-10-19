---
"@thomasfosterau/biblio": patch
---

`parseBibtex` scans entries and fields with an `@thomasfosterau/effect-parse` grammar instead of a hand-rolled scanner, adding that package as a dependency. Output is unchanged, except that brace nesting deeper than 32 levels now stops the scan like an unbalanced tail.
