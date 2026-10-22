---
"@thomasfosterau/biblio": minor
---

`parseBibtex` reads BibTeX and BibLaTeX in full: `@string` macros and `#` concatenation (with the predefined month macros), LaTeX decoded to Unicode, BibTeX name rules (particles, `Jr`, braced corporate names as `literal`, `and others`), `crossref` / `xdata` inheritance with BibLaTeX's rules, the BibLaTeX field set (`journaltitle`, `location`, `urldate`, `series`, `edition`, `eprint`, `langid`, …), full `date-parts` from ISO 8601 / EDTF dates, and the BibTeX / BibLaTeX → CSL entry-type mapping Pandoc uses. Fields with no typed slot land in `extra` (CSL variables under their CSL name, the rest as `tex.<field>`). The import policy and `BiblioRecord`'s shape are unchanged, but parsed output changes: grouping braces are removed from values (`{Nested}` → `Nested`), a `von` part is a `dropping-particle` rather than part of the given name, pages read `1-20` for `1--20`, `@booklet` maps to `pamphlet`, and `@xdata` / `@set` entries yield no outcome.
