# `@thomasfosterau/biblio`

Bibliographic toolkit on Effect: CSL-JSON records as Effect Schema, checksummed ISBN / DOI / ISSN / ORCID identifiers, BibTeX / RIS / CSV / CSL-JSON parsing, same-work dedup scoring, APA / Vancouver rendering, and Crossref / OpenAlex / OpenLibrary lookup over Effect's `HttpClient`.

**Disclaimer:** This repository and package have been created using Claude Code. The package's API and functionality is in flux, so expect churn and breaking changes.

## Install

```bash
pnpm add @thomasfosterau/biblio effect
```

`effect` (`>=4.0.0-rc.118`) is a peer dependency, built against `effect@4.0.0-rc.118`. Node.js 22 or newer is required. The one runtime dependency, [`@thomasfosterau/effect-parse`](https://github.com/thomasfosterau/effect-parse) (the BibTeX scanner), peers `effect ^4.0.0`, so an `effect` 4.0 pre-release draws a peer warning from it.

### Entry points

| Subpath | Imports | Contents |
| --- | --- | --- |
| `.` | `effect` only | `BiblioRecord` and the CSL-JSON interop, the identifier brands and decoders, the file parsers, dedup scoring, the render engine and the two built-in styles |
| `./sources` | `effect/http` | The `BiblioLookup` service and its layers, the per-source lookup functions and response schemas, the typed error channel |

The split is a packaging commitment, not a convention: the root entry resolves none of the modules that were under `effect/unstable/*` before rc.118 (`effect/http`, `effect/sql`, …; see [the forbidden-module list](https://github.com/thomasfosterau/effect-bib/blob/trunk/packages/biblio/tests/fixtures/forbidden-effect-modules.mjs)) and no `sources/` module, so a browser bundle that imports it never loads the HTTP clients. [`tests/entry-points.test.ts`](https://github.com/thomasfosterau/effect-bib/blob/trunk/packages/biblio/tests/entry-points.test.ts) walks the real import graph of both the sources and the built artifact.

## Usage

A `BiblioRecord` is a typed superset of CSL-JSON: its core is the closed CSL 1.0.2 vocabulary modelled as Effect Schema, and its additions are strictly additive — first-class checksummed identifiers, a source provenance envelope, and an `extra` map that carries CSL variables the model does not consume. Everything that produces one (a file parser, a lookup source, `fromCslJson`) validates field by field and never throws on partial or hostile input; everything that consumes one (dedup, rendering, `toCslJson`) is pure.

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { apaStyle, decodeIsbn, fromCslJson, renderReference } from "@thomasfosterau/biblio";
import { BiblioLookup, biblioLookupLayer } from "@thomasfosterau/biblio/sources";

// A proven identifier is a distinct type from the string it came from.
Option.getOrNull(decodeIsbn("0-06-231609-5")); // "9780062316097" (an `Isbn`)

// Any CSL-JSON item decodes; the ISBN is checksummed into its branded slot.
const record = fromCslJson({ type: "book", title: "Sapiens", ISBN: "9780062316097" });

// Rendering is a pure function of (record, style, locale).
renderReference(record, { style: apaStyle }); // "(n.d.). Sapiens."

// Lookup is an Effect service over HttpClient; the production layer uses the global fetch
// and identifies every request with your contact.
const program = Effect.gen(function* () {
  const lookup = yield* BiblioLookup;
  return yield* lookup.byIsbnRecord("9780062316097"); // Option<BiblioRecord>
});
const lookupLayer = biblioLookupLayer({
  contact: { product: "my-app/1.0", email: "ops@example.org" },
});
Effect.runPromise(program.pipe(Effect.provide(lookupLayer)));
```

## API

Each snippet below is an excerpt of a JSDoc `@example` in the source. CI compiles and executes the full examples (`vp run -r docgen`), and each `assert` from `node:assert` throws on a wrong value, so an expected value that drifts from the code fails the build.

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
assert.strictEqual(record.identifiers.isbn, "9780062316097");
assert.deepStrictEqual(record.extra, { "custom-key": "kept" });
```

**`toCslJson(record): CslJsonItem`** — the inverse projection: drops `provenance`, writes the brands back into `ISBN` / `DOI` / `ISSN`, re-merges `extra` (modelled fields win over a stale carried key).

Name and date helpers: `makeCslName(parts)`, `parsePersonName(raw)` (`"Family, Given"` or `"Given Family"`), `cslNameDisplay(name)`, `readCslName(entry)`, `readCslNameArray(value)`, `dateFromYear(year)`, `yearOf(date)`. Sanitisers: `sanitiseText(value)` (trim, collapse whitespace, clamp to `MAX_TEXT_FIELD_LENGTH`), `sanitiseYear(value)`. Bounds: `MAX_TEXT_FIELD_LENGTH` (2000), `MAX_AUTHORS` (100).

### Identifiers — `.`

**`Isbn`, `Doi`, `Issn`, `Orcid`** — `Schema.String.pipe(Schema.brand(…))`. The `Type` is the brand, the `Encoded` is `string`: the brand is a proof, not a representation. A raw string is never assignable to a brand and the four brands are distinct from each other (`tests/identifiers.types.ts` pins this at the type level).

**`decodeIsbn(raw): Option<Isbn>`** — accepts a hyphenated / spaced ISBN-10 or ISBN-13, validates the checksum (mod-11 / EAN mod-10), returns the canonical 13-digit form. **`isbnForms(isbn)`** gives an `IsbnForms`, `{ isbn13, isbn10 | null }`; `convertIsbn10To13` / `convertIsbn13To10` are the raw converters.

```ts
const isbn = decodeIsbn("0-06-231609-5");
assert.strictEqual(Option.getOrNull(isbn), "9780062316097");
assert.deepStrictEqual(
  Option.map(isbn, isbnForms),
  Option.some({ isbn13: "9780062316097", isbn10: "0062316095" }),
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

### Parsing — `.`

**`parseBibliographicFile(content, format): ParseOutcome[]`** — `format` is `ImportFormat` (`"bibtex" | "zotero-json" | "csv" | "ris"`); the per-format parsers `parseBibtex`, `parseZoteroJson`, `parseCsv`, `parseRis` are exported too. Pure and network-free; the BibTeX scanner is a grammar in [`@thomasfosterau/effect-parse`](https://github.com/thomasfosterau/effect-parse) combinators, with brace nesting capped at 32 levels (deeper nesting stops the scan like an unbalanced tail). One `ParseOutcome` per source entry: `{ outcome: "parsed", record }` or `{ outcome: "skipped", reason: SkipReason }` (`"no-title" | "no-identifier" | "malformed"`). A record needs a title and at least one dedup identifier (ISBN or DOI). Input over `MAX_INPUT_LENGTH` (8,000,000 code units) is dropped whole; at most `MAX_RECORDS` (5000) entries are emitted.

```ts
const outcomes = parseBibliographicFile(bibtex, "bibtex");
assert.deepStrictEqual(
  outcomes.map((outcome) => outcome.outcome),
  ["parsed", "skipped"],
);
```

**`parseBibtex(content)`** reads BibTeX and BibLaTeX in full: `@string` macros (and the predefined `jan` … `dec`) with `#` concatenation; LaTeX decoded to Unicode (`{\"o}` → `ö`, `--` → `–`, `\emph{…}` → its text; grouping braces are removed, so `{DNA}`'s case protection is not kept yet); BibTeX name rules (`von Last, Jr, First`, a braced corporate name as a `literal`, `and others` as `extra["tex.others"]`); `crossref` and `xdata` inheritance with BibLaTeX's rules (an `@inbook` takes its parent book's `title` as its container title); BibLaTeX's fields and dates (`journaltitle`, `location`, `urldate`, EDTF ranges as full `date-parts`, arXiv `eprint`s); and the BibTeX / BibLaTeX → CSL entry-type mapping Pandoc and citeproc-js use. A field with a CSL variable the record does not type (`shorttitle`, `keywords`, `type`, …) lands in `extra` under the CSL name (`title-short`, `keyword`, `genre`), and any other field under `tex.<field>`; only `file` is dropped.

```ts
const chapter = outcomes[1].outcome === "parsed" ? outcomes[1].record : undefined;
assert.strictEqual(chapter?.title, "Schön's Method");
assert.strictEqual(chapter?.["container-title"], "The Oxford Handbook");
assert.deepStrictEqual(chapter?.author, [
  { family: "Berg", given: "Anna", "dropping-particle": "van der" },
]);
assert.deepStrictEqual(chapter?.extra, { "tex.others": ["author"] });
```

### Dedup — `.`

**`recordMatchInput(record): MatchInput`** projects a record to `{ title, authors }`; **`scoreMatch(incoming, candidate): MatchScore`** scores title-token Jaccard, author-surname Jaccard (`Option.none()` when either side has no authors) and the shared significant title tokens; **`isConfidentMatch(score)`** is the high-precision same-work decision (title ≥ 0.9 with author agreement ≥ 0.5, or title ≥ 0.95 with ≥ 2 shared tokens when there is no author signal); **`matchConfidence(score)`** ranks; **`bestConfidentMatch(incoming, candidates)`** picks the best confident candidate or `null`. Normalisers: `normaliseForMatch`, `titleTokens`, `authorSurname`.

```ts
const score = scoreMatch(
  { title: "The Hobbit", authors: ["J. R. R. Tolkien"] },
  { title: "Hobbit", authors: ["Tolkien, J.R.R."] },
);
assert.strictEqual(isConfidentMatch(score), true);
```

### Rendering — `.`

**`renderReference(record, { style, locale? }): string`** and **`renderBibliography(records, options): RenderedBibliography`** — author-date styles sort by the style's `sortKey` and carry no label; numeric styles keep citation order and number each entry (`label: Option<string>`). **`bibliographyToText(bibliography)`** flattens to one line per entry. `locale` defaults to `enLocale`.

**`apaStyle`** (APA 7th, author-date) and **`vancouverStyle`** (numeric) are the built-ins; `builtInStyles` holds the two (`{ apa, vancouver }`) and `getStyle(id)` looks a style up by any id (`undefined` when unknown). A `CitationStyle` is data — `{ id, title, category, renderReference, sortKey }` — so a consumer can supply its own without touching the engine, composing the `format.ts` primitives (`formatNameList`, `givenInitials`, `issuedYearText`, `pagesLabel`, `preferredUrl`, `dispatchReference`, …).

```ts
assert.strictEqual(
  renderReference(article, { style: apaStyle }),
  "Ray, O. (2004). Can loneliness be lethal? Nature, 431, 231-232. https://doi.org/10.1038/431231a",
);
assert.strictEqual(
  renderReference(article, { style: vancouverStyle }),
  "Ray O. Can loneliness be lethal? Nature. 2004;431:231-232.",
);
```

### Lookup — `./sources`

**`BiblioLookup`** — `Context.Service` with `byIsbnRecord(isbn: string)`, `byDoiRecord(doi: string)` → `Effect<Option<BiblioRecord>, LookupError>` and `byTitle(query: string)` → `Effect<readonly BiblioRecord[], LookupError>`. Each method decodes the raw identifier first and fails with `InvalidIdentifier` before any request; a clean upstream 404 is `Option.none()`; `byTitle` never fails on an empty result.

**`biblioLookupLayer(options): Layer<BiblioLookup>`** — production, over `FetchHttpClient` (the global fetch). **`biblioLookupClientLayer(options): Layer<BiblioLookup, never, HttpClient>`** — over whatever `HttpClient` is in context, which is how a test injects a stubbed fetch. Both attach `acceptJson`, `filterStatusOk` and a polite `User-Agent` built from the required `options.contact`. Each call builds a new layer, so build it once and share it.

**`LookupContact`** — `{ product, email }`, who is making the lookups. Every request sends `User-Agent: <product> (mailto:<email>)`, and OpenAlex requests also send `mailto=<email>`, so Crossref and OpenAlex route you to their polite pool and can reach you about your traffic. Use your own application's name and address; the package ships no default.

```ts
const program = Effect.gen(function* () {
  const lookup = yield* BiblioLookup;
  return yield* lookup.byIsbnRecord("978-0-06-231609-7");
});
const lookupLayer = biblioLookupLayer({
  contact: { product: "my-app/1.0", email: "ops@example.org" },
});
program.pipe(Effect.provide(lookupLayer)); // Effect<Option<BiblioRecord>, LookupError>
```

**Errors** — `InvalidIdentifier { kind: "isbn" | "doi", value }` (fix the input, don't retry) and `LookupFailed { source: LookupSource, description }` (transport, non-404 status or decode failure); `LookupError` is their union and `LookupSource` is `"openlibrary" | "crossref" | "openalex"`.

**Per-source functions** (take an already-composed `HttpClient` and a proven identifier): `lookupOpenLibraryByIsbn(client, isbn)`, `lookupCrossrefByDoi(client, doi)`, `lookupOpenAlexByDoi(client, doi, contact)`, `searchOpenAlexByTitle(client, query, contact)` (the OpenAlex pair sends `contact.email` as `mailto`; the User-Agent is whatever your client sets). The lenient response schemas (`OpenLibraryEdition`, `OpenLibraryAuthor`, `CrossrefResponse`, `OpenAlexWork`, `OpenAlexSearchResponse`) and normalisers (`normaliseOpenLibraryRecord`, `normaliseCrossrefRecord`, `normaliseOpenAlexRecord`) are exported so a consumer can drive them against recorded fixtures.

## Compatibility

- **Wire compatibility.** `BiblioRecord` decodes every record the website application has persisted; any change to its shape (a field name, a key's optionality, an identifier brand, the `provenance` / `extra` shape) is a major version.
- **Plain-nullable returns.** `isbnForms(isbn).isbn10`, `parsePersonName`, `cslNameDisplay`, `yearOf`, `makeCslName` and `bestConfidentMatch` return `null`, and `getStyle` returns `undefined`, rather than an `Option`. This is a stable contract, not a migration in progress.
- **Scope.** The package stops at the CSL record: mapping records onto an application's own data model and persisting them stay in the application. Extracted from `thomasfosterau/website`'s `packages/biblio` with its git history; a `website#NNN` cite in a source comment is an issue in `thomasfosterau/website`.

## License

MIT
