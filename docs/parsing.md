# Parsing and writing

Reading BibTeX, RIS, CSV, CSL-JSON, CSL YAML, MEDLINE and Refer files into records, and writing records back out. All from the root entry (`@thomasfosterau/effect-bib`).

Snippets are excerpts of JSDoc `@example`s in the source, which CI compiles and executes (`vp run -r docgen`); variables an example defines earlier (`record`, `outcomes`, `article`, …) are elided here. Per-export detail (signatures, defaults, bounds) is in the doc comments, which show on hover and ship in the package `.d.ts`.

## Formats, options and outcomes

**`parseBibliographicFile(content, format, options?): ParseOutcome[]`** — `format` is `ImportFormat` (`"bibtex" | "zotero-json" | "csl-yaml" | "csv" | "ris" | "medline" | "refer"`); the per-format parsers `parseBibtex`, `parseZoteroJson`, `parseCslYaml`, `parseCsv`, `parseRis`, `parseMedline`, `parseRefer` (each `(content, options?)`) are exported too, and **`detectFormat(content): Option<ImportFormat>`** guesses the format from the content. Pure and network-free; the BibTeX scanner is a grammar in [`@thomasfosterau/effect-parse`](https://github.com/thomasfosterau/effect-parse) combinators, with brace nesting capped at 32 levels (deeper nesting stops the scan like an unbalanced tail). One `ParseOutcome` per source entry: `{ outcome: "parsed", record, position? }` or `{ outcome: "skipped", reason: SkipReason, position? }`, where `position` is the entry's `SourcePosition` (`{ offset, line, column }` of a BibTeX entry's `@`, an RIS `TY` line, the first line of a MEDLINE or Refer record, or a CSV row; CSL-JSON has none). An entry's key (BibTeX's citation key, RIS `ID`, a CSV `key` / `citation key` / `id` column, CSL-JSON `id` / `citation-key`) is the record's `id` and `citation-key`.

`options` is a `ParseOptions`: `mode` (`ParseMode`) and the bounds. In the default `"import"` mode a record needs a title and at least one dedup identifier (ISBN or DOI), else it is skipped (`"no-title"` / `"no-identifier"`); in `"lenient"` mode every entry the format admits is a record, as a document's bibliography needs. CSL-JSON and CSL YAML items are read in full with `fromCslJson` in either mode (an item with no `type` takes one from its identifier in `"import"` mode). `maxRecords` (default `MAX_RECORDS`, 5000), `maxInputLength` (default `MAX_INPUT_LENGTH`, 8,000,000 code units), `maxFieldLength` and `maxAuthors` set the bounds; input over the input cap is one `"too-large"` outcome, and entries past the record cap one trailing `"truncated"` outcome. `"malformed"` marks an entry (or a whole JSON or CSV file) that could not be read.

```ts
const outcomes = parseBibliographicFile(bibtex, "bibtex");
assert.deepStrictEqual(
  outcomes.map((outcome) => outcome.outcome),
  ["parsed", "skipped"],
);
assert.strictEqual(outcomes[1].outcome === "skipped" ? outcomes[1].reason : undefined, "no-title");
```

## MEDLINE and Refer

**`parseMedline(content)`** reads a PubMed / MEDLINE file (PubMed's `.nbib` "Citation manager" export): one record per paragraph of `TAG - value` lines, a value continuing on indented lines. `TI` (or a book's `BTI`) is the title; `FAU` (else `AU`, `Family Initials`) and `CN` the authors, `FED` / `ED` the editors; `JT` (or `TA`) the journal; `VI`, `IP`, `PG` and the year of `DP` the volume, issue, pages and date; the `[doi]` of `LID` / `AID` the DOI; `IS` and `ISBN` the ISSN and ISBN; `PMID` the record's `id` and its `pmid`, with `PMC` its `pmcid`. A record with a journal is an `article-journal`, a titled one in a book (`BTI`) a `chapter`, a book alone a `book`. **`parseRefer(content)`** reads Refer / EndNote tagged files: one record per paragraph of `%X value` lines, an untagged line continuing the previous value. `%0` (EndNote's reference type, else inferred from `%J` or `%B`) is the type; `%T`, `%A`, `%E`, `%J` (or a book's `%B`), `%V`, `%N`, `%P`, the year of `%D`, `%I`, `%@` (ISBN and ISSN), `%R` (DOI) and `%F` (or `%L`) as the `id` and `citation-key`. Records are stamped `provenance.source` `"medline"` / `"refer"`, and both stream record by record in `parseBibliographicStream`.

## BibTeX

**`parseBibtex(content)`** reads BibTeX and BibLaTeX in full: `@string` macros (and the predefined `jan` … `dec`) with `#` concatenation; LaTeX decoded to Unicode (`{\"o}` → `ö`, `--` → `–`, `\emph{…}` → its text; grouping braces are removed, so `{DNA}`'s case protection is dropped, unless the `bibtexMarkup` option is on); BibTeX name rules (`von Last, Jr, First`, a braced corporate name as a `literal`, `and others` as `extra["tex.others"]`); `crossref` and `xdata` inheritance with BibLaTeX's rules (an `@inbook` takes its parent book's `title` as its container title); BibLaTeX's fields and dates (`journaltitle`, `location`, `urldate`, EDTF ranges as full `date-parts`, arXiv `eprint`s); and the BibTeX / BibLaTeX → CSL entry-type mapping Pandoc and citeproc-js use. BibLaTeX's field semantics follow Pandoc's reading: the list fields `publisher`, `location` / `address`, `institution` and `organization` split at each top-level `and` and join with `; ` (`Routledge and Kegan Paul` → `Routledge; Kegan Paul`), and the publisher is every one of `school`, `institution`, `organization`, `howpublished` and `publisher` present, in that order; a multi-volume `@book` (one with a `maintitle`) takes the `maintitle` as its `title` and its own title as the `volume-title`, while a contained entry (`@inbook`, `@incollection`, …) takes the `maintitle` as its `container-title` and its `booktitle` as the `volume-title`; `collection-title` is the `series` alone; `volume` and `part` read as `7.2`; the localisation keys are spelled out (`type = {patentus}` → `U.S. patent`, `pubstate = {inpress}` → `in press`, `series = {newseries}` → `new series`, `series = {3}` → `3rd series`); and the language is `langid`, else the legacy `hyphenation`, else `language`, with a `langidopts` `variant` setting a Babel language's region (`english` with `variant=british` → `en-GB`). Fields with a CSL variable fill it (`shorttitle` → `title-short`, `keywords` → `keyword`, `type` → `genre`, `eventtitle` → `event-title`, …), an `eprint` of type `arxiv` / `pubmed` and the `pmid` / `pmcid` fields fill `identifiers` when they validate, and any other field lands in `extra` as `tex.<field>`; only `file` is dropped.

With **`bibtexMarkup: true`** (opt-in; the default output is unchanged) text fields keep BibTeX's formatting as CSL markup: `\emph{…}` / `\textit{…}` → `<i>…</i>`, `\textbf{…}` → `<b>`, `\textsc{…}` → a small-caps span, `\textsuperscript{…}` / `\textsubscript{…}` → `<sup>` / `<sub>`, and a case-protecting `{DNA}` → `<span class="nocase">DNA</span>`. CSL markup has no escape, so a literal `<` in the BibTeX text is written as `<span class="nocase"><</span>`, which reads back as `<`, never as a tag. `toBibtex` writes the same markup back as LaTeX, so the two round-trip.

```ts
const chapter = outcomes[1].outcome === "parsed" ? outcomes[1].record : undefined;
assert.strictEqual(chapter?.title, "Schön's Method");
assert.strictEqual(chapter?.["container-title"], "The Oxford Handbook");
assert.deepStrictEqual(chapter?.author, [
  { family: "Berg", given: "Anna", "dropping-particle": "van der" },
]);
assert.deepStrictEqual(chapter?.extra, { "tex.others": ["author"] });
assert.strictEqual(chapter?.["citation-key"], "chapter");
assert.deepStrictEqual(outcomes[1].position, { offset: 168, line: 3, column: 1 });

// A document's bibliography: no identifier needed.
const [thesis] = parseBibtex(
  "@phdthesis{doe2020, title = {On Things}, author = {Doe, Jane}, school = {MIT}, year = 2020}",
  { mode: "lenient" },
);
assert.strictEqual(thesis.outcome === "parsed" ? thesis.record.genre : undefined, "PhD thesis");
```

## CSL YAML

**`parseCslYaml(content)`** reads CSL YAML: a Pandoc bibliography file, or a Markdown document's front matter, holding `references:` (or a bare list of items). It reads the YAML subset bibliographies are written in (block mappings and lists, one-line flow lists, plain, quoted and block scalars, comments); anything else (anchors, aliases, tags) is one `"malformed"` outcome rather than a misreading.

## As an Effect, and streaming

**`parseBibliographic(content, format, options?): Effect<ParseOutcome[], InputTooLarge>`** is the same parse as an `Effect`, failing with the typed `InputTooLarge` error (`{ format, maxInputLength, message }`) where the pure parser yields a `"too-large"` outcome. **`parseBibliographicStream(chunks, format, options?): Stream<ParseOutcome, E | InputTooLarge, R>`** reads a large file as a `Stream` of text chunks and emits each entry's outcome as soon as the entry is complete, so the file never has to be in memory at once: BibTeX, RIS and CSV stream entry by entry with the whole-file parse's outcomes and positions (BibTeX `@string` macros carried forward; a `crossref` / `xdata` child read with its parent from a window of the last 1000 entries, or held back until a later parent arrives); CSL-JSON and CSL YAML are read whole at the end. In a stream, `maxInputLength` bounds the text held at once (an unfinished entry, the macros, the waiting children), not the whole stream, and the record cap ends the stream with one `"truncated"` outcome.

```ts
const chunks = Stream.fromIterable([
  '@string{ups = "Oxford Univ',
  'ersity Press"}\n@book{a, title = {First}, publisher = ups, isbn = {9780199695836}}\n@bo',
  "ok{b, title = {Second}, isbn = {9780062316097}}",
]);
const outcomes = Effect.runSync(Stream.runCollect(parseBibliographicStream(chunks, "bibtex")));
assert.strictEqual(
  outcomes[0].outcome === "parsed" ? outcomes[0].record.publisher : undefined,
  "Oxford University Press",
);
assert.deepStrictEqual(outcomes[1].position, { offset: 108, line: 3, column: 1 });
```

## Writing

**`toBibtex(records, { dialect? }): string`** writes a `.bib` document, the inverse of `parseBibtex`. `dialect` is `"biblatex"` (the default: BibLaTeX's entry types and fields, ISO 8601 / EDTF `date`, UTF-8 text) or `"bibtex"` (the classic entry types, `year` / `month` / `day`, `journal`, `address`, and ASCII text with accent commands, `ö` → `{\"o}`). CSL markup becomes LaTeX (`<i>` → `\emph{…}`, a `nocase` span → a case-protecting `{…}` group), the specials are escaped, and the `tex.<field>` passthrough `parseBibtex` kept is written back. Each entry's key is the record's own `citation-key` (or string `id`), cleaned of characters a key cannot hold, else a generated `authorYEARword` key; a key already used gets a letter suffix (`darwin1859origin`, `darwin1859origina`). A record with a `volume-title` is written, in the BibLaTeX dialect, as a `maintitle` and a `title` (or, in a contained entry, a `maintitle` and a `booktitle`), the reader's mapping in reverse. What BibTeX cannot hold (ORCIDs, `categories`, the CSL variables with no BibLaTeX field) is left out.

```ts
const bib = toBibtex([record]);
assert.strictEqual(bib.split("\n")[0], "@article{berg2004dna,");
assert.ok(bib.includes("  title = {The {DNA} of Schön},"));
assert.ok(bib.includes("  date = {2004-03},"));

// Classic BibTeX: ASCII, with accent commands and `year` / `month`.
const classic = toBibtex([record], { dialect: "bibtex" });
assert.ok(classic.includes('  title = {The {DNA} of Sch{\\"o}n},'));
assert.ok(classic.includes("  month = mar,"));
```

**`toRis(records): string`** writes RIS (CRLF line ends, `Last, First, Suffix` names, `PY` / `DA` dates, `SP` / `EP` pages, plain text), and **`toCslYaml(records): string`** writes CSL YAML: a `references:` list between `---` and `...`, both a Pandoc bibliography file and a front-matter block. For each format, `parse(write(records))` keeps every field the format models.
