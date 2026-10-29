---
"@thomasfosterau/biblio": patch
---

A BibTeX verbatim field wrapped in extra brace groups, as some exporters write `doi = {{10.1016/…}}`, no longer loses its identifier. The groups that wrap the whole value are removed before `doi`, `issn`, `url` and the other verbatim fields are validated. A value such as `{a}{b}`, where no group wraps the whole value, is kept as written.
