---
"@thomasfosterau/biblio": major
---

`BiblioRecord` gains citation keys and the full CSL 1.0.2 variable set, and the file parsers gain a lenient mode, caller-set limits and source positions.

**Record (wire shape).** Every new member is optional, so a record persisted by 0.x still decodes; `fromCslJson(toCslJson(record))` moves the CSL variables a 0.x record kept in `extra` into their typed slots.

- The CSL-JSON item `id` (`string | number`), `citation-key` and `categories`.
- Every CSL 1.0.2 standard variable (`title-short`, `container-title-short`, `genre`, `medium`, `status`, `event-title`, `event-place`, `archive`, `archive_location`, `call-number`, `keyword`, `number-of-pages`, `collection-number`, `version`, `jurisdiction`, …), all 26 name variables (`collection-editor`, `director`, `interviewer`, `illustrator`, `recipient`, `reviewed-author`, `original-author`, `executive-producer`, `series-creator`, …) and the `available-date` date variable. The citation-time variables (`citation-number`, `first-reference-note-number`, `locator`, `year-suffix`) and `custom` stay in `extra`.
- Validated `Pmid`, `Pmcid` and `Arxiv` brands with `decodePmid`, `decodePmcid` and `decodeArxiv`, and the matching `identifiers.pmid` / `pmcid` / `arxiv` slots. `fromCslJson` reads them from `PMID`, `PMCID` and an `arXiv:` `number` or arxiv.org `URL`, and `toCslJson` writes them back. A `PMID` / `PMCID` that does not validate is dropped, like a bad ISBN.
- `fromCslJson` reads the legacy aliases `event`, `journalAbbreviation` and `shortTitle` into `event-title`, `container-title-short` and `title-short` when those are absent, and takes optional `RecordLimits` (`maxFieldLength`, `maxAuthors`). `sanitiseText` and `readCslNameArray` take an optional bound.

**Parsing.** `parseBibliographicFile`, `parseBibtex`, `parseZoteroJson`, `parseCsv` and `parseRis` take optional `ParseOptions`:

- `mode: "lenient"` keeps every entry without requiring a title or an ISBN or DOI, which a document's bibliography needs. CSL-JSON items are then read in full with `fromCslJson`. The default `"import"` mode keeps the import policy.
- `maxRecords`, `maxInputLength`, `maxFieldLength` and `maxAuthors` default to today's constants.
- Breaking: input over the input cap now yields one `{ outcome: "skipped", reason: "too-large" }` instead of `[]`, and entries past the record cap yield one trailing `"truncated"` outcome. Each parser now checks the input cap, not only `parseBibliographicFile`.
- An entry's key (a BibTeX key, an RIS `ID`, a CSV `key` / `citation key` / `id` column, a CSL-JSON `id` / `citation-key`) is the record's `id` and `citation-key`.
- BibTeX, RIS and CSV outcomes carry the entry's `position` (`{ offset, line, column }`).
- `parseBibtex` puts the CSL variables it used to keep in `extra` (`title-short`, `genre`, `keyword`, `event-title`, …) into their typed slots, and an `arxiv` / `pubmed` eprint, `pmid` and `pmcid` into `identifiers`. An eprint or `pmid` that does not validate stays in `extra` as `tex.<field>`.

**Rich text and dates.** Text variables may carry CSL-JSON's rich-text markup. `parseCslMarkup`, `toCslMarkup` and `stripCslMarkup` read it, write it back and strip it, and `RichText` gains a `NoCase` node (`noCase`). The built-in styles render the markup and sort and dedup on its plain text (`richField` reads markup, the new `plainField` strips it). `issuedYearText` renders a date range's years (`2001–2003`) and a `literal` date. `yearOf` falls back to the year in a `raw` date, and `endYearOf` returns a range's last year.
