# BibTeX / BibLaTeX oracle corpus

The inputs and the reference output for `tests/bibtex-oracle.test.ts` (#91), which checks `parseBibtex` against Pandoc's own BibLaTeX → CSL reading, entry by entry.

## Corpora

| Directory | Source | Licence | Vendored |
| --- | --- | --- | --- |
| `biber/` | every `.bib` in [plk/biber](https://github.com/plk/biber) `t/tdata/` at `c8da51282dfa196fbbd593caad423e7f0abc2230` | Artistic License 2.0 (`biber/LICENSE`), copied verbatim | yes |
| `better-bibtex/` | the `.bib` import fixtures under 12 KB in [retorquere/zotero-better-bibtex](https://github.com/retorquere/zotero-better-bibtex) `test/fixtures/import/` at `6c581839df9b1ae3fd944445c9d54a48c124ab42` | MIT (`better-bibtex/LICENSE`), copied verbatim | yes |
| (fetched) | Pandoc's `test/command/biblatex-*.md` and `bibtex-*.md` cases in [jgm/pandoc](https://github.com/jgm/pandoc) at `66fcaff9258133aa5d2e918abb7b7d5e5c4a39fd` | GPL-2.0-or-later | **no**: `vp run oracles:fetch` clones them into the git-ignored `.oracles/` |

Pandoc's cases are GPL, so they are used as an oracle only: their inputs are read from the fetched checkout at test time and never committed. CI fetches them before the tests; locally the comparison skips them until `vp run oracles:fetch` has run (the totality check and the two vendored corpora run regardless).

## The oracle

`oracle/<corpus>/<file>.json` is Pandoc's CSL-JSON reading of each input (`pandoc -f biblatex -t csljson`), generated with **pandoc 3.1.3** by `scripts/pandoc-oracle.sh`. A file Pandoc could not read within the script's time and memory bounds has no oracle (biber's `crossrefs`, `encoding1`, `full-dot`, `xdata`; three Better BibTeX fixtures; Pandoc's `pandoc-citeproc-chicago-fullnote-bibliography`); it is still checked for totality. Regenerate after moving a pinned commit or upgrading pandoc, then rewrite the divergence list (below) and review its diff.

964 entries have an oracle; 578 agree with Pandoc in every compared field.

## Divergences

`divergences.json` lists every entry (`<corpus>/<file>#<key>`) that still differs from Pandoc after normalisation, with the fields that differ. The test pins it exactly, so a change that introduces a divergence fails, and so does one that removes one: shrink the list with `ORACLE_BASELINE=write vp test run tests/bibtex-oracle.test.ts` and review the diff. `(missing)` is an entry Pandoc reads and we do not; `(extra)` the reverse.

**Normalised away** (presentation, not reading): titles (`title`, `title-short`, `container-title`, `collection-title`, `event-title`, `original-title`) and `genre` compare case-insensitively, since Pandoc sentence-cases English titles; CSL markup is stripped; Pandoc's smart quotes (`’`, `“”`) compare as straight quotes; page ranges compare with one kind of dash; run-together initials (`T.S.` / `T. S.`); an ISBN compares as its canonical ISBN-13 (ours is the first valid ISBN of the field, made canonical); an entry Pandoc leaves untyped compares as `document`.

**Gaps in `parseBibtex`**, each an issue (fixing one shrinks the list):

- BibLaTeX list fields, localisation keys, `hyphenation` / `langidopts`, multi-volume books (`maintitle`, `volume` + `part`), `\hyphen` / `\mkbibquote`: #102. Most of the `publisher`, `publisher-place`, `language`, `genre`, `status`, `collection-title`, `container-title`, `volume` and `title` entries.
- BibLaTeX's extended name format (`family=…, given=…`): #103. Most `author` / `editor` entries.
- Dates beyond EDTF level 0 (era years, times, open starts, unspecified digits): #104. Most `issued`, `accessed`, `original-date`, `event-date` entries.
- A doubly-braced verbatim field (`doi = {{…}}`) loses its identifier: #105.
- A parenthesised entry (`@article(…)`) loses its fields: #100.

**Deliberate differences** (stay listed):

- `title-short`: Pandoc derives one from a title with a subtitle when there is no `shorttitle`; we keep only a declared one (#102 tracks the decision).
- `number`: we write an arXiv `eprint` as `number: "arXiv:<id>"` (as Zotero does); Pandoc writes no number.
- `@set` entries yield no record (ours), where Pandoc reads them: the `(missing)` entries in biber's `sets.bib`, `skips.bib` and `examples.bib`.
- `issue`: an `@article` with both `number` and `issue` takes `number` as its issue; Pandoc joins them (`number, issue`).
- `ISSN`: we keep the first valid ISSN of a list; Pandoc the text.
- `type`: `@periodical` is CSL `periodical` (ours), Pandoc writes `article-journal`.
- Pandoc honours an entry's `options = {url=false}`; we keep the URL.
- `and others` ends a name list as `extra["tex.others"]` (ours); Pandoc writes a literal name `others`.
- biber's `encoding*.bib` are deliberately not UTF-8: `parseBibtex` takes a string, so decoding the bytes is the caller's (the test reads every file as UTF-8).
