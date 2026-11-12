---
"@thomasfosterau/effect-bib": patch
---

The schema-backed errors (`InputTooLarge`, `InvalidIdentifier`, `LookupFailed`, `RefusedUrl`) are branded, so a structurally similar object no longer type-checks as one. A CSL `season` or `circa` and an OpenAlex `publication_year` decode only as finite numbers.
