# effect-bib

Reference management on [Effect](https://effect.website): typed CSL-JSON records, checksummed bibliographic identifiers, import and export of the common reference-manager formats, same-work deduplication, citation rendering, and lookup against open scholarly metadata services.

> [!CAUTION]
> Experimental and pre-1.0, largely written with Claude Code. The API may change between minor versions.

## Install

```bash
pnpm add @thomasfosterau/effect-bib effect
```

`effect` `^4.0.0` is a peer; `@thomasfosterau/effect-parse` is an optional peer, needed by the root entry's parsers.

## Example

```ts
import * as assert from "node:assert";
import * as Option from "effect/Option";
import { apaStyle, decodeIsbn, fromCslJson, renderReference } from "@thomasfosterau/effect-bib";

assert.strictEqual(Option.getOrNull(decodeIsbn("0-06-231609-5")), "9780062316097");

const record = fromCslJson({ type: "book", title: "Sapiens", ISBN: "9780062316097" });
assert.strictEqual(renderReference(record, { style: apaStyle }), "(n.d.). Sapiens.");
```

## Packages

| Package | Entry points |
| --- | --- |
| [`@thomasfosterau/effect-bib`](packages/effect-bib/README.md) | `.` (records, identifiers, parsers and writers, dedup, rendering; browser-safe), `./record` (the record model alone, `effect` only), `./sources` (Crossref / OpenAlex / OpenLibrary lookup over `HttpClient`) |

## Docs

- Guides: [records and identifiers](docs/records.md), [parsing and writing](docs/parsing.md), [rendering](docs/rendering.md), [dedup](docs/dedup.md), [lookup](docs/lookup.md), [compatibility and scope](docs/compatibility.md). The API reference is the per-export doc comments.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md): workflow, toolchain, guidelines and gates.
- [docs/SECURITY.md](docs/SECURITY.md) and [docs/PUBLISHING.md](docs/PUBLISHING.md).
- [AGENTS.md](AGENTS.md): notes for coding agents.

[MIT](LICENSE.md)
