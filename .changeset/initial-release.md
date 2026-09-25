---
"@thomasfosterau/biblio": minor
---

Initial release: the bibliographic toolkit extracted from the website application's `packages/biblio`, with its history.

`.` (peer: `effect`; no HTTP surface):

- `BiblioRecord` — a CSL-JSON superset as Effect Schema (closed CSL 1.0.2 item types, name and date variables), with checksummed `identifiers`, a source `provenance` envelope and a `passthrough` map; `fromCslJson` / `toCslJson` at the interop boundary; the untrusted-text sanitisers.
- `Isbn` / `Doi` / `Issn` / `Orcid` — branded, checksum-validated identifiers with lenient `decode*` decoders and the ISBN 10 ↔ 13 converters.
- `parseBibliographicFile` — BibTeX, CSL-JSON (Zotero export), RIS and CSV → `BiblioRecord`, dependency-free, bounded.
- `scoreMatch` / `isConfidentMatch` / `bestConfidentMatch` — fuzzy same-work scoring over title tokens, author surnames, year and identifiers.
- `renderReference` / `renderBibliography` — pure `(records, style, locale) → string` with the built-in APA and Vancouver styles.

`./sources` (peer: `effect`; imports `effect/unstable/http`):

- `BiblioLookup` — the `Context.Service` over Effect's `HttpClient` (`byIsbnRecord` via OpenLibrary, `byDoiRecord` via Crossref, `byTitle` via OpenAlex), `biblioLookupClientLayer` / `biblioLookupLayer`, the per-source lookup functions and response schemas, and the typed `InvalidIdentifier` / `LookupFailed` error channel.
