---
"@thomasfosterau/biblio": minor
---

Writers and CSL YAML. `toBibtex(records, { dialect })` writes BibLaTeX (the default) or classic BibTeX: the CSL → entry-type mapping in reverse, LaTeX escaping, CSL markup as LaTeX commands with `nocase` spans as `{…}` case protection, accent commands in the ASCII `bibtex` dialect, and citation keys kept or generated (`authorYEARword`, letter suffixes on collision). `toRis(records)` writes RIS and `toCslYaml(records)` CSL YAML; `parseCslYaml` reads CSL YAML (Pandoc bibliography files and Markdown front matter), and `ImportFormat` gains `"csl-yaml"`. `detectFormat(content)` sniffs a file's format. `parseZoteroJson` now reads every item in full with `fromCslJson` in `import` mode too (full dates, every CSL variable), applying the import policy on top, and `fromCslJson` takes the first valid ISBN of a space- or comma-separated list. `parseRis` reads an RIS name's suffix (`Last, First, Suffix`).
