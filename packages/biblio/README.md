# `@thomasfosterau/biblio`

Bibliographic toolkit on Effect: CSL-JSON records as Effect Schema, checksummed ISBN / DOI / ISSN / ORCID identifiers, BibTeX / RIS / CSV / CSL-JSON parsing, same-work dedup scoring, APA / Vancouver rendering, and Crossref / OpenAlex / OpenLibrary lookup over Effect's `HttpClient`.

[![CI](https://github.com/thomasfosterau/reference-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/thomasfosterau/reference-manager/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@thomasfosterau/biblio.svg)](https://www.npmjs.com/package/@thomasfosterau/biblio) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Disclaimer:** This repository and package have been created using Claude Code. The package's API and functionality is in flux, so expect churn and breaking changes.

## Installation

```bash
npm install @thomasfosterau/biblio effect
```

`effect` (`>=4.0.0-rc.115`) is a peer dependency, built against `effect@4.0.0-rc.115`. Node.js 22 or newer is required.

## Entry points

| Subpath | Imports | Contents |
| --- | --- | --- |
| `.` | `effect` only | `BiblioRecord` and the CSL-JSON interop, the identifier brands and decoders, the file parsers, dedup scoring, the render engine and the two built-in styles |
| `./sources` | `effect/unstable/http` | The `BiblioLookup` service and its layers, the per-source lookup functions and response schemas, the typed error channel |

The split is a packaging commitment, not a convention: the root entry resolves no `effect/unstable/*` module and no `sources/` module, so a browser bundle that imports it never loads the HTTP clients. `tests/entry-points.test.ts` walks the real import graph of both the sources and the built artifact.

## Overview

A `BiblioRecord` is a typed superset of CSL-JSON: its core is the closed CSL 1.0.2 vocabulary modelled as Effect Schema, and its additions are strictly additive — first-class checksummed identifiers, a source provenance envelope, and a passthrough map that carries CSL variables the model does not consume. Everything that produces one (a file parser, a lookup source, `fromCslJson`) validates field by field and never throws on partial or hostile input; everything that consumes one (dedup, rendering, `toCslJson`) is pure.

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { apaStyle, decodeIsbn, fromCslJson, renderReference } from "@thomasfosterau/biblio";
import { BiblioLookup, biblioLookupLayer } from "@thomasfosterau/biblio/sources";

// A proven identifier is a distinct type from the string it came from.
const isbn = decodeIsbn("0-06-231609-5"); // Option.some("9780062316097" as Isbn)

// Any CSL-JSON item decodes; the ISBN is checksummed into its branded slot.
const record = fromCslJson({ type: "book", title: "Sapiens", ISBN: "9780062316097" });

// Rendering is a pure function of (record, style, locale).
renderReference(record, { style: apaStyle }); // "(n.d.). Sapiens."

// Lookup is an Effect service over HttpClient; the production layer uses the global fetch.
const program = Effect.gen(function* () {
  const lookup = yield* BiblioLookup;
  return yield* lookup.byIsbnRecord("9780062316097"); // Option<BiblioRecord>
});
Effect.runPromise(program.pipe(Effect.provide(biblioLookupLayer)));
```

## API reference

Every example below is a JSDoc `@example` in the source, compiled and executed by `vp run docgen`.

### Records — `.`

**`BiblioRecord`** (`Schema.Struct`) — `type: CslItemType` (required), the CSL standard variables as optional strings (`title`, `container-title`, `collection-title`, `publisher`, `publisher-place`, `page`, `volume`, `issue`, `number`, `edition`, `abstract`, `language`, `URL`, `note`), the name variables as optional `CslName` arrays (`author`, `editor`, `translator`, `container-author`), the date variables as optional `CslDate`s (`issued`, `accessed`, `original-date`, `event-date`, `submitted`), then the superset: `identifiers: RecordIdentifiers` (required; `isbn?: Isbn`, `doi?: Doi`, `issn?: Issn`), `provenance: Provenance` (required; `source: ProvenanceSource`, `retrievedBy?`, `retrievedAt?`) and `extra?: Record<string, unknown>`.

**`CslItemType`** — the closed CSL 1.0.2 item-type enumeration (`article-journal`, `book`, `chapter`, `webpage`, … `document` is the neutral fallback). `isCslItemType(value)` narrows a string.

**`CslName`** — `family` / `given` / `dropping-particle` / `non-dropping-particle` / `suffix` / `literal`, all optional, plus the superset `orcid?: Orcid`. **`CslDate`** — `date-parts` / `season` / `circa` / `literal` / `raw`.

**`fromCslJson(item: unknown): BiblioRecord`** — lenient, total decode of any CSL-JSON item. Identifiers are validated where present (a checksum failure drops the identifier, not the record); unknown keys survive in `extra`; the record is stamped `provenance.source: "csl-json"`.

```ts
const record = fromCslJson({
  type: "book",
  title: "Sapiens",
  ISBN: "0-06-231609-5",
  author: [{ family: "Harari", given: "Yuval Noah" }],
  issued: { "date-parts": [[2015]] },
  "custom-key": "kept",
});
record.identifiers.isbn; // "9780062316097"
record.extra; // { "custom-key": "kept" }
```

**`toCslJson(record): CslJsonItem`** — the inverse projection: drops `provenance`, writes the brands back into `ISBN` / `DOI` / `ISSN`, re-merges `extra` (modelled fields win over a stale carried key).

Name and date helpers: `makeCslName(parts)`, `parsePersonName(raw)` (`"Family, Given"` or `"Given Family"`), `cslNameDisplay(name)`, `readCslName(entry)`, `readCslNameArray(value)`, `dateFromYear(year)`, `yearOf(date)`. Sanitisers: `sanitiseText(value)` (trim, collapse whitespace, clamp to `MAX_TEXT_FIELD_LENGTH`), `sanitiseYear(value)`. Bounds: `MAX_TEXT_FIELD_LENGTH` (2000), `MAX_AUTHORS` (100).

### Identifiers — `.`

**`Isbn`, `Doi`, `Issn`, `Orcid`** — `Schema.String.pipe(Schema.brand(…))`. The `Type` is the brand, the `Encoded` is `string`: the brand is a proof, not a representation. A raw string is never assignable to a brand and the four brands are distinct from each other (`tests/identifiers.types.ts` pins this at the type level).

**`decodeIsbn(raw): Option<Isbn>`** — accepts a hyphenated / spaced ISBN-10 or ISBN-13, validates the checksum (mod-11 / EAN mod-10), returns the canonical 13-digit form. **`isbnForms(isbn)`** gives `{ isbn13, isbn10 | null }`; `convertIsbn10To13` / `convertIsbn13To10` are the raw converters.

```ts
Option.getOrNull(decodeIsbn("0-06-231609-5")); // "9780062316097"
Option.map(decodeIsbn("9780062316097"), isbnForms); // some({ isbn13: "9780062316097", isbn10: "0062316095" })
Option.isNone(decodeIsbn("978-0-06-231609-8")); // true — checksum failure, never a throw
```

**`decodeDoi(raw): Option<Doi>`** — strips a resolver URL or `doi:` scheme, lower-cases, rejects control characters, whitespace, over-length values and `..` segments (`normaliseDoi` is the un-branded step). **`decodeIssn(raw): Option<Issn>`** — mod-11, canonical `NNNN-NNNN`. **`decodeOrcid(raw): Option<Orcid>`** — ISO 7064 mod-11-2, canonical `0000-0002-1825-0097`.

```ts
Option.getOrNull(decodeDoi("https://doi.org/10.1038/NPHYS1170")); // "10.1038/nphys1170"
Option.getOrNull(decodeIssn("00280836")); // "0028-0836"
Option.getOrNull(decodeOrcid("https://orcid.org/0000-0002-1825-0097")); // "0000-0002-1825-0097"
```

### Parsing — `.`

**`parseBibliographicFile(content, format): ParseOutcome[]`** — `format` is `ImportFormat` (`"bibtex" | "zotero-json" | "csv" | "ris"`); the per-format parsers `parseBibtex`, `parseZoteroJson`, `parseCsv`, `parseRis` are exported too. Pure and dependency-free. One `ParseOutcome` per source entry: `{ outcome: "parsed", record }` or `{ outcome: "skipped", reason: SkipReason }` (`"no-title" | "no-identifier" | "malformed"`). A record needs a title and at least one dedup identifier (ISBN or DOI). Input over `MAX_INPUT_LENGTH` (8,000,000 code units) is dropped whole; at most `MAX_RECORDS` (5000) entries are emitted.

```ts
const outcomes = parseBibliographicFile(bibtex, "bibtex");
outcomes.map((outcome) => outcome.outcome); // ["parsed", "skipped"]
```

### Dedup — `.`

**`recordMatchInput(record): MatchInput`** projects a record to `{ title, authors }`; **`scoreMatch(incoming, candidate): MatchScore`** scores title-token Jaccard, author-surname Jaccard (`Option.none()` when either side has no authors) and the shared significant title tokens; **`isConfidentMatch(score)`** is the high-precision same-work decision (title ≥ 0.9 with author agreement ≥ 0.5, or title ≥ 0.95 with ≥ 2 shared tokens when there is no author signal); **`matchConfidence(score)`** ranks; **`bestConfidentMatch(incoming, candidates)`** picks the best confident candidate or `null`. Normalisers: `normaliseForMatch`, `titleTokens`, `authorSurname`.

```ts
const score = scoreMatch(
  { title: "The Hobbit", authors: ["J. R. R. Tolkien"] },
  { title: "Hobbit", authors: ["Tolkien, J.R.R."] },
);
isConfidentMatch(score); // true
```

### Rendering — `.`

**`renderReference(record, { style, locale? }): string`** and **`renderBibliography(records, options): RenderedBibliography`** — author-date styles sort by the style's `sortKey` and carry no label; numeric styles keep citation order and number each entry (`label: Option<string>`). **`bibliographyToText(bibliography)`** flattens to one line per entry. `locale` defaults to `enLocale`.

**`apaStyle`** (APA 7th, author-date) and **`vancouverStyle`** (numeric) are the built-ins; `builtInStyles` is the registry and `getStyle(id)` the lookup. A `CitationStyle` is data — `{ id, title, category, renderReference, sortKey }` — so a consumer can supply its own without touching the engine, composing the `format.ts` primitives (`formatNameList`, `givenInitials`, `issuedYearText`, `pagesLabel`, `preferredUrl`, `dispatchReference`, …).

```ts
renderReference(article, { style: apaStyle });
// "Ray, O. (2004). Can loneliness be lethal? Nature, 431, 231-232. https://doi.org/10.1038/431231a"
renderReference(article, { style: vancouverStyle });
// "Ray O. Can loneliness be lethal? Nature. 2004;431:231-232."
```

### Lookup — `./sources`

**`BiblioLookup`** — `Context.Service` with `byIsbnRecord(isbn: string)`, `byDoiRecord(doi: string)` → `Effect<Option<BiblioRecord>, LookupError>` and `byTitle(query: string)` → `Effect<readonly BiblioRecord[], LookupError>`. Each method decodes the raw identifier first and fails with `InvalidIdentifier` before any request; a clean upstream 404 is `Option.none()`; `byTitle` never fails on an empty result.

**`biblioLookupLayer: Layer<BiblioLookup>`** — production, over `FetchHttpClient` (the global fetch). **`biblioLookupClientLayer: Layer<BiblioLookup, never, HttpClient>`** — over whatever `HttpClient` is in context, which is how a test injects a stubbed fetch. Both attach a polite `User-Agent`, `acceptJson` and `filterStatusOk`.

```ts
const program = Effect.gen(function* () {
  const lookup = yield* BiblioLookup;
  return yield* lookup.byIsbnRecord("978-0-06-231609-7");
});
program.pipe(Effect.provide(biblioLookupLayer)); // Effect<Option<BiblioRecord>, LookupError>
```

**Errors** — `InvalidIdentifier { kind: "isbn" | "doi", value }` (fix the input, don't retry) and `LookupFailed { source: LookupSource, description }` (transport, non-404 status or decode failure); `LookupError` is their union and `LookupSource` is `"openlibrary" | "crossref" | "openalex"`.

**Per-source functions** (take an already-composed `HttpClient` and a proven identifier): `lookupOpenLibraryByIsbn(client, isbn)`, `lookupCrossrefByDoi(client, doi)`, `lookupOpenAlexByDoi(client, doi)`, `searchOpenAlexByTitle(client, query)`. The lenient response schemas (`OpenLibraryEdition`, `OpenLibraryAuthor`, `CrossrefResponse`, `OpenAlexWork`, `OpenAlexSearchResponse`) and normalisers (`normaliseOpenLibraryRecord`, `normaliseCrossrefRecord`, `normaliseOpenAlexRecord`) are exported so a consumer can drive them against recorded fixtures.

## Design notes

- **Provenance of the code.** Extracted from `thomasfosterau/website`'s `packages/biblio` with its git history; `#NNN` citations in the source comments name website issues, the evidence behind a decision.
- **What stays in the application.** The CSL ↔ WEMI spine mapping (`csl-to-spine`, `spine-to-csl`) and the ingest / import operations are website business logic and are not part of this package. The package stops at the CSL record.
- **Wire compatibility.** `BiblioRecord` decodes every row website has persisted; any change to its shape is a major version.

## License

MIT
