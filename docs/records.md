# Records and identifiers

The `BiblioRecord` schema, the CSL-JSON interop boundary and the checksummed identifier brands, all from the root entry (`@thomasfosterau/effect-bib`).

Snippets are excerpts of JSDoc `@example`s in the source, which CI compiles and executes (`vp run -r docgen`); variables an example defines earlier (`record`, `outcomes`, `article`, …) are elided here. Per-export detail (signatures, defaults, bounds) is in the doc comments, which show on hover and ship in the package `.d.ts`.

A `BiblioRecord` is a typed superset of CSL-JSON: its core is the closed CSL 1.0.2 vocabulary modelled as Effect Schema, and its additions are strictly additive — first-class checksummed identifiers, a source provenance envelope, and an `extra` map that carries CSL variables the model does not consume. Everything that produces one (a file parser, a lookup source, `fromCslJson`) validates field by field and never throws on partial or hostile input; everything that consumes one (dedup, rendering, `toCslJson`) is pure.

## Records

**`BiblioRecord`** (`Schema.Struct`) — `type: CslItemType` (required), the CSL-JSON item `id?: string | number` and `categories?: readonly string[]`, then every CSL 1.0.2 variable under its CSL-JSON name: the standard variables as optional strings (`citation-key`, `title`, `title-short`, `container-title`, `collection-title`, `collection-number`, `publisher`, `publisher-place`, `page`, `volume`, `issue`, `number`, `edition`, `genre`, `medium`, `status`, `event-title`, `event-place`, `archive`, `archive_location`, `call-number`, `keyword`, `abstract`, `note`, `URL`, … — numeric variables as their text), the 26 name variables as optional `CslName` arrays (`author`, `editor`, `translator`, `container-author`, `collection-editor`, `director`, `interviewer`, `illustrator`, `recipient`, `reviewed-author`, `original-author`, `contributor`, `curator`, `executive-producer`, `guest`, `host`, `narrator`, `organizer`, `performer`, `producer`, `script-writer`, `series-creator`, …) and the six date variables as optional `CslDate`s (`issued`, `accessed`, `available-date`, `event-date`, `original-date`, `submitted`). Then the superset: `identifiers: RecordIdentifiers` (required; `isbn?: Isbn`, `doi?: Doi`, `issn?: Issn`, `pmid?: Pmid`, `pmcid?: Pmcid`, `arxiv?: Arxiv`), `provenance: Provenance` (required; `source: ProvenanceSource`, `retrievedBy?`, `retrievedAt?`) and `extra?: Record<string, unknown>`. The CSL identifier variables (`DOI`, `ISBN`, `ISSN`, `PMID`, `PMCID`) live, validated, in `identifiers`; the citation-time variables (`citation-number`, `first-reference-note-number`, `locator`, `year-suffix`) and CSL's `custom` object stay in `extra`. A text variable may carry CSL's rich-text markup (see [Rich text](rendering.md#rich-text)).

**`CslItemType`** — the closed CSL 1.0.2 item-type enumeration (`article-journal`, `book`, `chapter`, `webpage`, … `document` is the neutral fallback). `isCslItemType(value)` narrows a string.

**`CslName`** — `family` / `given` / `dropping-particle` / `non-dropping-particle` / `suffix` / `literal`, all optional, plus the superset `orcid?: Orcid`. **`CslDate`** — `date-parts` / `season` / `circa` / `literal` / `raw`.

**`fromCslJson(item: unknown, limits?: RecordLimits): BiblioRecord`** — lenient, total decode of any CSL-JSON item. Identifiers are validated where present (a checksum failure drops the identifier, not the record; an arXiv id is read from a `number: "arXiv:…"` or an arxiv.org `URL`); every CSL variable lands in its typed slot, the legacy aliases `event`, `journalAbbreviation` and `shortTitle` filling `event-title`, `container-title-short` and `title-short` when those are absent; unknown keys survive in `extra`; the record is stamped `provenance.source: "csl-json"`. `limits` (`{ maxFieldLength?, maxAuthors? }`) raises the text and name-list bounds.

```ts
const record = fromCslJson({
  id: "harari2015",
  "citation-key": "harari2015",
  type: "book",
  title: "Sapiens",
  "title-short": "Sapiens",
  ISBN: "0-06-231609-5",
  author: [{ family: "Harari", given: "Yuval Noah" }],
  issued: { "date-parts": [[2015]] },
  "custom-key": "kept",
});
assert.strictEqual(record.identifiers.isbn, "9780062316097");
assert.strictEqual(record["citation-key"], "harari2015");
assert.deepStrictEqual(record.extra, { "custom-key": "kept" });
```

**`toCslJson(record): CslJsonItem`** — the inverse projection: drops `provenance`, writes the brands back into `ISBN` / `DOI` / `ISSN` / `PMID` / `PMCID` (an arXiv id as `number: "arXiv:<id>"` when the record has no `number`), re-merges `extra` (modelled fields win over a stale carried key). `fromCslJson(toCslJson(record))` also lifts a record that kept CSL variables in `extra` (as records from before the full CSL variable set did) into their typed slots.

Name and date helpers: `makeCslName(parts)` and `parsePersonName(raw)` (`"Family, Given"` or `"Given Family"`), each an `Option<CslName>`, `cslNameDisplay(name)` (an `Option<string>`), `readCslName(entry)`, `readCslNameArray(value, maxNames?)`, `dateFromYear(year)`, `yearOf(date)` (an `Option` of a range's start year, else the year of a `raw` date) and `endYearOf(date)` (`Option` of a range's last year, when it differs). Sanitisers: `sanitiseText(value, maxLength?)` (trim, collapse whitespace, clamp to `maxLength`, default `MAX_TEXT_FIELD_LENGTH`), `sanitiseYear(value)`. Default bounds: `MAX_TEXT_FIELD_LENGTH` (2000), `MAX_AUTHORS` (100).

## Identifiers

**`Isbn`, `Doi`, `Issn`, `Orcid`, `Pmid`, `Pmcid`, `Arxiv`** — `Schema.String.pipe(Schema.brand(…))`. The `Type` is the brand, the `Encoded` is `string`: the brand is a proof, not a representation. A raw string is never assignable to a brand and the brands are distinct from each other (`tests/identifiers.types.ts` pins this at the type level).

**`decodeIsbn(raw): Option<Isbn>`** — accepts a hyphenated / spaced ISBN-10 or ISBN-13, validates the checksum (mod-11 / EAN mod-10), returns the canonical 13-digit form. **`isbnForms(isbn)`** gives an `IsbnForms`, `{ isbn13, isbn10 }`, with `isbn10` an `Option` (`Option.none()` for a `979` ISBN); `convertIsbn10To13` / `convertIsbn13To10` are the raw converters.

```ts
const isbn = decodeIsbn("0-06-231609-5");
assert.strictEqual(Option.getOrNull(isbn), "9780062316097");
assert.deepStrictEqual(
  Option.map(isbn, isbnForms),
  Option.some({ isbn13: "9780062316097", isbn10: Option.some("0062316095") }),
);
// A checksum failure is `Option.none()`, never a throw.
assert.strictEqual(Option.isNone(decodeIsbn("978-0-06-231609-8")), true);
```

**`decodeDoi(raw): Option<Doi>`** — strips a resolver URL or `doi:` scheme, lower-cases, rejects control characters, whitespace, over-length values and `..` segments (`normaliseDoi` is the un-branded step). **`decodeIssn(raw): Option<Issn>`** — mod-11, canonical `NNNN-NNNN`. **`decodeOrcid(raw): Option<Orcid>`** — ISO 7064 mod-11-2, canonical `0000-0002-1825-0097`.

```ts
assert.strictEqual(
  Option.getOrNull(decodeDoi("https://doi.org/10.1038/NPHYS1170")),
  "10.1038/nphys1170",
);
assert.strictEqual(Option.getOrNull(decodeIssn("00280836")), "0028-0836");
assert.strictEqual(
  Option.getOrNull(decodeOrcid("https://orcid.org/0000-0002-1825-0097")),
  "0000-0002-1825-0097",
);
```

**`decodePmid(raw): Option<Pmid>`** — a PubMed id's digits (a `PMID:` prefix stripped; no leading zero). **`decodePmcid(raw): Option<Pmcid>`** — canonical `PMC1234567`. **`decodeArxiv(raw): Option<Arxiv>`** — a current-scheme (`2101.01234v2`) or old-scheme (`hep-th/9901001`) arXiv id, bare, with an `arXiv:` prefix or an arxiv.org `abs` / `pdf` URL stripped. None of the three schemes has a check digit, so the syntax is the whole test.

```ts
assert.strictEqual(Option.getOrNull(decodePmid("PMID: 15371539")), "15371539");
assert.strictEqual(Option.getOrNull(decodePmcid("pmc3159421")), "PMC3159421");
assert.strictEqual(Option.getOrNull(decodeArxiv("arXiv:2101.01234v2")), "2101.01234v2");
```
