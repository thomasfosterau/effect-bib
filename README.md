# effect-bib

Reference management on [Effect](https://effect.website): typed CSL-JSON records, checksummed bibliographic identifiers, import from the common reference-manager formats, same-work deduplication, citation rendering, and lookup against the open scholarly metadata services.

**Disclaimer:** this repository and its packages have been created using Claude Code. The API is in flux; expect churn and breaking changes.

## Packages

| Package | Purpose |
| --- | --- |
| [`@thomasfosterau/biblio`](packages/biblio/README.md) | CSL-JSON records as Effect Schema, checksummed ISBN / DOI / ISSN / ORCID identifiers, BibTeX / RIS / CSV / CSL-JSON parsing, same-work dedup scoring and APA / Vancouver rendering (`.`, browser-safe), plus Crossref / OpenAlex / OpenLibrary lookup over Effect's `HttpClient` (`./sources`). Peer: `effect`. |

## Install

```bash
pnpm add @thomasfosterau/biblio effect
```

`effect` `>=4.0.0-rc.118` is a peer dependency; Node.js 22 or newer is required.

## Example

```ts
import * as Option from "effect/Option";
import { apaStyle, decodeIsbn, fromCslJson, renderReference } from "@thomasfosterau/biblio";

// A proven identifier is a distinct type from the string it came from.
Option.getOrNull(decodeIsbn("0-06-231609-5")); // "9780062316097" (an `Isbn`)

// Any CSL-JSON item decodes, never throwing; the ISBN is checksummed into its branded slot.
const record = fromCslJson({ type: "book", title: "Sapiens", ISBN: "9780062316097" });

// Rendering is a pure function of (record, style, locale).
renderReference(record, { style: apaStyle }); // "(n.d.). Sapiens."
```

The lookup service, the file parsers, dedup scoring and the full API are in the [package README](packages/biblio/README.md).

## Development

The workspace runs on pnpm and [Vite+](https://viteplus.dev) (`vp`): `vp check` formats and lints, `vp run check` type-checks the sources and the emitted declarations, `vp run -r test:coverage` runs the unit tests, and `vp run -r docgen` compiles and executes every documentation example. Setup and the individual checks are in [CONTRIBUTING.md](CONTRIBUTING.md); conventions for coding agents are in [AGENTS.md](AGENTS.md).

Releases go through [changesets](https://github.com/changesets/changesets) and npm trusted publishing; see [PUBLISHING.md](PUBLISHING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

The package was extracted from `thomasfosterau/website` with its git history.

## License

[MIT](LICENSE)
