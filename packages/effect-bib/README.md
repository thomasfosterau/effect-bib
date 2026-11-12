# `@thomasfosterau/effect-bib`

Bibliographic toolkit on Effect: CSL-JSON records as Effect Schema, checksummed ISBN / DOI / ISSN / ORCID identifiers, BibTeX / RIS / CSV / CSL-JSON / CSL YAML parsing and BibTeX / BibLaTeX / RIS / CSL YAML writing, same-work dedup scoring, APA / Vancouver / Chicago rendering, and Crossref / OpenAlex / OpenLibrary lookup over Effect's `HttpClient`.

**Disclaimer:** This repository and package have been created using Claude Code. The package's API and functionality is in flux, so expect churn and breaking changes.

## Install

```bash
pnpm add @thomasfosterau/effect-bib effect
```

Peers: `effect` `^4.0.0`. The one runtime dependency, [`@thomasfosterau/effect-parse`](https://github.com/thomasfosterau/effect-parse) (the BibTeX scanner), is installed with the package and peers `effect ^4.0.0` too. Node.js 22 or newer.

## Example

```ts
import * as Option from "effect/Option";
import { apaStyle, decodeIsbn, fromCslJson, renderReference } from "@thomasfosterau/effect-bib";

// A proven identifier is a distinct type from the string it came from.
Option.getOrNull(decodeIsbn("0-06-231609-5")); // "9780062316097" (an `Isbn`)

// Any CSL-JSON item decodes, never throwing; the ISBN is checksummed into its branded slot.
const record = fromCslJson({ type: "book", title: "Sapiens", ISBN: "9780062316097" });

// Rendering is a pure function of (record, style, locale).
renderReference(record, { style: apaStyle }); // "(n.d.). Sapiens."
```

## Entry points

| Subpath | Imports | Contents |
| --- | --- | --- |
| `.` | `effect` only (browser-safe) | `BiblioRecord` and the CSL-JSON interop, identifier brands and decoders, file parsers and writers, dedup scoring, the render engine and built-in styles, embedded-metadata reading |
| `./sources` | `effect/http` | The `BiblioLookup` service and its layers, per-source lookup functions and response schemas, the typed error channel |

## Links

- Guides: [records and identifiers](https://github.com/thomasfosterau/effect-bib/blob/trunk/docs/records.md), [parsing and writing](https://github.com/thomasfosterau/effect-bib/blob/trunk/docs/parsing.md), [rendering and citations](https://github.com/thomasfosterau/effect-bib/blob/trunk/docs/rendering.md), [dedup](https://github.com/thomasfosterau/effect-bib/blob/trunk/docs/dedup.md), [lookup](https://github.com/thomasfosterau/effect-bib/blob/trunk/docs/lookup.md), [compatibility and scope](https://github.com/thomasfosterau/effect-bib/blob/trunk/docs/compatibility.md)
- API reference: the per-export doc comments (hover in your editor, or [the source](https://github.com/thomasfosterau/effect-bib/blob/trunk/packages/effect-bib/src))
- [Changelog](https://github.com/thomasfosterau/effect-bib/blob/trunk/packages/effect-bib/CHANGELOG.md), [security policy](https://github.com/thomasfosterau/effect-bib/blob/trunk/SECURITY.md), [contributing](https://github.com/thomasfosterau/effect-bib/blob/trunk/CONTRIBUTING.md), [MIT licence](https://github.com/thomasfosterau/effect-bib/blob/trunk/LICENSE)
