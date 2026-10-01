# `@thomasfosterau/biblio`

The bibliographic toolkit (`packages/biblio`), extracted from the website application's `packages/biblio` with its history. Peer: `effect` only. Two entry points, split so a browser bundle never loads the lookup clients: `.` (pure, `effect` alone) and `./sources` (`effect/http`).

## Boundary

Imports nothing from this workspace (`.fallowrc.json` zone `biblio`, no outbound rule). `src/sources/*` may import the root modules; the root modules never import `src/sources/*`.

## Invariants

- **`BiblioRecord` is wire-identical to what website persists.** The website application stores records decoded by this schema; any change to a field name, a key's optionality, the brand of an identifier slot or the `provenance` / `extra` shape is a **major**. `fromCslJson` must keep decoding every row it ever produced.
- **The root entry (`.`) never reaches `src/sources/` or a module that sat under `effect/unstable/*` before rc.118.** `.` is the browser-safe half; the HttpClient-backed lookups live behind `./sources` only. The list is `tests/fixtures/forbidden-effect-modules.mjs` (its one home), and a drift test checks it against the installed `effect`. `tests/entry-points.test.ts` walks the source and built import graphs and loads `dist/index.js` with those modules unresolvable. A type-only import counts. The built-artifact cases skip when `dist/` is absent, so build first.
- **Untrusted input never throws.** Every decoder, parser and normaliser is total: `Option.none()`, a `skipped` outcome or a thinner record — never an exception. Free text is clamped (`MAX_TEXT_FIELD_LENGTH`), author lists (`MAX_AUTHORS`), record counts (`MAX_RECORDS`) and input length (`MAX_INPUT_LENGTH`) are bounded.
- **Identifiers reach a URL only as brands.** A `decode*` call is the one way in; a source client takes the brand, never the raw string. The service's `byIsbnRecord` / `byDoiRecord` decode first and fail with `InvalidIdentifier` before any request.
- **Rendering is deterministic.** Sorting uses code-unit comparison, never `localeCompare`; styles and locales are data; no network at render time. The golden strings in `tests/render.test.ts` pin the output.
- **The plain-nullable seams stay.** `isbnForms().isbn10`, `parsePersonName`, `cslNameDisplay`, `yearOf`, `makeCslName`, `bestConfidentMatch` and `getStyle` return `null` / `undefined` rather than `Option`: website's `apps/api/src/biblio/*` consumes them as plain nullables, and the shape is a cross-package contract. Each site carries its `oxlint-disable` justification; `effect/prefer-option-over-null` stays at `error` so a new one cannot land silently.
- **`@since` on every export, `@example` on the entry points.** `vp run -r docgen` compiles and executes every example, so a wrong expected value is a red gate. The README's snippets are excerpts of those examples; update both together. Every doc comment opens with a one-sentence summary that stands alone in a hover, in consumer vocabulary (no app paths, no website entity names), as one `/** */` block directly above the declaration — a second block replaces the first in a hover.

## Terms

- **Record** — `BiblioRecord`, a CSL-JSON superset as Effect Schema: the closed CSL 1.0.2 vocabulary (item types, standard / name / date variables, keyed by their CSL-JSON names) plus three strictly additive members — `identifiers` (branded, checksummed), `provenance` (which source, by what retrieval identity) and `extra` (the passthrough map of CSL keys the model does not consume).
- **Interop boundary** — `fromCslJson` (lenient, total: any input decodes to a record, hostile input to a thinner one) and `toCslJson` (drops provenance, serialises the brands back into `ISBN` / `DOI` / `ISSN`, re-merges `extra`).
- **Proven identifier** — an `Isbn` / `Doi` / `Issn` / `Orcid`: a branded string that passed its checksum through the lenient `decode*` decoder. The brand is the SSRF / path-injection boundary: an `Isbn` is exclusively digits, a `Doi` has no control characters, whitespace or `..` segment, so either is safe to interpolate into an upstream URL path.
- **Outcome** — `ParseOutcome`, one per source entry from the file parsers: `parsed` with a record, or `skipped` with a `SkipReason` (`no-title`, `no-identifier`, `malformed`). A malformed entry never fails the batch.
- **Match input / score** — `MatchInput` (a title and author display names) and `MatchScore` (title-token Jaccard, author-surname Jaccard as an `Option`, shared significant title tokens); `isConfidentMatch` is the deliberately high-precision same-work decision.
- **Style / locale** — typed data inputs to the render engine (`CitationStyle`, `Locale`); rendering is `(records, style, locale) → string`, pure and network-free. Built-ins: `apaStyle` (author-date) and `vancouverStyle` (numeric).
- **Lookup** — `BiblioLookup`, the `Context.Service` over Effect's `HttpClient`: `byIsbnRecord` via OpenLibrary, `byDoiRecord` via Crossref, `byTitle` via OpenAlex. A clean upstream 404 is `Option.none()`; a bad identifier is `InvalidIdentifier`; any other upstream fault is `LookupFailed`.
