# @thomasfosterau/biblio

## 0.1.0

### Minor Changes

- [#18](https://github.com/thomasfosterau/reference-manager/pull/18) [`7ad23bf`](https://github.com/thomasfosterau/reference-manager/commit/7ad23bf097e29004d18c225338bdfb7267ac7119) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Requires `effect@>=4.0.0-rc.118` (the peer range). rc.118 moved the former `effect/unstable/*` modules to top-level paths, so the `./sources` entry imports `effect/http` and its emitted `dist/*.d.ts` reference that path. The root entry imports `effect` only.

- [#3](https://github.com/thomasfosterau/reference-manager/pull/3) [`1f146f7`](https://github.com/thomasfosterau/reference-manager/commit/1f146f7d78a31faa9b77ec3d6af3840712bf4590) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Initial release, on Effect `4.0.0-rc.118`: the bibliographic toolkit extracted from the website application's `packages/biblio`, with its history.

  `.` (peer: `effect`; no HTTP surface):

  - `BiblioRecord` — a CSL-JSON superset as Effect Schema (closed CSL 1.0.2 item types, name and date variables), with checksummed `identifiers`, a source `provenance` envelope and an `extra` map that passes through CSL keys the model does not consume; `fromCslJson` / `toCslJson` at the interop boundary; the untrusted-text sanitisers.
  - `Isbn` / `Doi` / `Issn` / `Orcid` — branded, checksum-validated identifiers with lenient `decode*` decoders and the ISBN 10 ↔ 13 converters.
  - `parseBibliographicFile` — BibTeX, CSL-JSON (Zotero export), RIS and CSV → `BiblioRecord`, dependency-free, bounded.
  - `scoreMatch` / `isConfidentMatch` / `bestConfidentMatch` — fuzzy same-work scoring over title tokens, author surnames, year and identifiers.
  - `renderReference` / `renderBibliography` — pure `(records, style, locale) → string` with the built-in APA and Vancouver styles.

  `./sources` (peer: `effect`; imports `effect/http`):

  - `BiblioLookup` — the `Context.Service` over Effect's `HttpClient` (`byIsbnRecord` via OpenLibrary, `byDoiRecord` via Crossref, `byTitle` via OpenAlex), `biblioLookupClientLayer` / `biblioLookupLayer` (each built from the caller's `LookupContact`: every request sends `User-Agent: <product> (mailto:<email>)`, and OpenAlex requests also send `mailto=<email>`), the per-source lookup functions and response schemas, and the typed `InvalidIdentifier` / `LookupFailed` error channel.

- [#43](https://github.com/thomasfosterau/reference-manager/pull/43) [`ca9cf29`](https://github.com/thomasfosterau/reference-manager/commit/ca9cf29634cd8c7155b8e5db3e0e00ab49440546) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `BiblioLookup` identifies its requests with the caller's contact. `biblioLookupLayer` and `biblioLookupClientLayer` take `{ contact: LookupContact }` (`{ product, email }`): every request made through either layer sends `User-Agent: <product> (mailto:<email>)`, and OpenAlex requests also send `mailto=<email>`. `lookupOpenAlexByDoi` and `searchOpenAlexByTitle` take the contact as their third argument. The service key is `"@thomasfosterau/biblio/BiblioLookup"`.

### Patch Changes

- [#37](https://github.com/thomasfosterau/reference-manager/pull/37) [`5bd2086`](https://github.com/thomasfosterau/reference-manager/commit/5bd2086c917fbb77aaab2c877bd4d197d114343f) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The `@example` blocks in the TSDoc now state their expected values with `node:assert` instead of `console.log` and a `// →` comment, so `docgen` fails when an example's output changes.

- [#23](https://github.com/thomasfosterau/reference-manager/pull/23) [`49814e2`](https://github.com/thomasfosterau/reference-manager/commit/49814e2aae29a502495f48954a4b5dbf216a6897) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Doc comments describe the API in the package's own vocabulary: every export's hover opens with a summary (including `bestConfidentMatch` and `sanitiseText`), module links resolve, and the plain-nullable returns (`isbnForms().isbn10`, `bestConfidentMatch`, `getStyle`, …) are documented as a stable contract.

- [#23](https://github.com/thomasfosterau/reference-manager/pull/23) [`110c55c`](https://github.com/thomasfosterau/reference-manager/commit/110c55c109bffd511118f5ebf8299269b6fbb60f) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The published tarball does not include the repository's agent guidance (`CLAUDE.md`); the consumer-facing contract it carried (wire compatibility, the plain-nullable returns) is in the README's Compatibility section.

- [#26](https://github.com/thomasfosterau/reference-manager/pull/26) [`daa36cf`](https://github.com/thomasfosterau/reference-manager/commit/daa36cf76da3a7083320fd85fc78a48da7ae30df) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Tested against effect 4.0.0; peer floor unchanged (`effect@>=4.0.0-rc.118`).

- [#53](https://github.com/thomasfosterau/reference-manager/pull/53) [`2a05bd9`](https://github.com/thomasfosterau/reference-manager/commit/2a05bd962a2617facd6647dd7757d998eced5d47) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Each module's doc comment (its hover and its docgen page) opens with a summary in consumer vocabulary.
