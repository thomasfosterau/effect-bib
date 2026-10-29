---
"@thomasfosterau/biblio": major
---

`parseBibtex` now reads BibLaTeX's field semantics as Pandoc does. Several fields of the records it produces change, so this is a breaking change for anyone who stores those records.

What changes:

- **List fields.**
  - `publisher`, `location` / `address`, `institution` and `organization` split at each top-level `and` and join with `; `: `Routledge and Kegan Paul` → `Routledge; Kegan Paul`.
  - The `publisher` is now every one of `school`, `institution`, `organization`, `howpublished` (unless it is a link) and `publisher` present, in that order, joined with `; `. It used to be the first present of `publisher`, `institution`, `school`, `organization`.
- **Multi-volume works.**
  - A `@book` (or any uncontained entry) with a `maintitle` now has the `maintitle` as its `title` and its own title as the new CSL `volume-title`. It used to keep its own `title` and put the `maintitle` in `collection-title`.
  - A contained entry (`@inbook`, `@incollection`, `@inproceedings`, `@inreference`, …) with a `maintitle` has the `maintitle` as its `container-title` and its `booktitle` as the `volume-title`.
  - `collection-title` is now the `series` alone.
  - The container of an uncontained entry is its journal only; a `booktitle` on, say, a `@misc` now stays in `extra` as `tex.booktitle`.
  - `volume` and `part` read as `7.2`.
- **Localisation keys** are spelled out:
  - `type` patent keys: `patentus` → `U.S. patent`, `patreqfr` → `French patent request`, …;
  - `pubstate`: `inpress` → `in press`, `inpreparation` → `in preparation`, …;
  - `series`: `newseries` → `new series`, and a bare number such as `3` → `3rd series`.
- **Language.**
  - The legacy `hyphenation` field (an alias of `langid`) sets the `language`.
  - A `langidopts` `variant` sets a Babel language's region: `english` with `variant=british` → `en-GB`.
- **LaTeX.** `\hyphen` decodes to `-`. `\mkbibquote` quotes its argument, as `\enquote` does, and `\mkbibemph` is italic under the `bibtexMarkup` option.

`toBibtex` writes a record with a `volume-title` back as BibLaTeX's `maintitle` / `title` (or, in a contained entry, `maintitle` / `booktitle`).

**Migration.** The `BiblioRecord` schema is unchanged; only the values `parseBibtex` produces from these fields change. Records already stored keep their old values: an old multi-volume book has `collection-title` set to its `maintitle` and no `volume-title`, and an old publisher list reads `X and Y`. To bring stored BibTeX imports in line, re-ingest them from their source `.bib`, or rewrite those fields. Code that reads `collection-title` as the multi-volume work should read `title` and `volume-title` (uncontained) or `container-title` (contained) instead.
