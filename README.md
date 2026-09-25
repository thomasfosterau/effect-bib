# reference-manager

The home of the reference-management packages, published to npm under the `@thomasfosterau` scope:

| Package | What it is |
| --- | --- |
| [`@thomasfosterau/biblio`](packages/biblio/README.md) | Bibliographic toolkit on Effect: CSL-JSON records as Effect Schema, checksummed ISBN / DOI / ISSN / ORCID identifiers, BibTeX / RIS / CSV / CSL-JSON parsing, same-work dedup scoring, APA / Vancouver rendering (`.`), and Crossref / OpenAlex / OpenLibrary lookup over Effect's `HttpClient` (`./sources`). Peer: `effect`. |

Built against `effect@4.0.0-rc`.

**Disclaimer:** this repository and its packages have been created using Claude Code. The API is in flux; expect churn and breaking changes.

## Quick start

```ts
import * as Option from "effect/Option";
import {
  apaStyle,
  decodeIsbn,
  fromCslJson,
  parseBibliographicFile,
  renderReference,
} from "@thomasfosterau/biblio";

// A proven identifier is a distinct type from the string it came from.
const isbn = decodeIsbn("0-06-231609-5"); // Option.some("9780062316097")

// Any CSL-JSON item decodes into a typed record; a whole BibTeX file into outcomes.
const record = fromCslJson({ type: "book", title: "Sapiens", ISBN: "9780062316097" });
const outcomes = parseBibliographicFile(bibtexText, "bibtex");

// Rendering is a pure function of (record, style, locale).
renderReference(record, { style: apaStyle });
```

The lookup service lives behind its own entry point so a browser bundle never loads it:

```ts
import * as Effect from "effect/Effect";
import { BiblioLookup, biblioLookupLayer } from "@thomasfosterau/biblio/sources";

const program = Effect.gen(function* () {
  const lookup = yield* BiblioLookup;
  return yield* lookup.byDoiRecord("10.1038/nphys1170");
});
Effect.runPromise(program.pipe(Effect.provide(biblioLookupLayer)));
```

## Documentation

[`packages/biblio/README.md`](packages/biblio/README.md) is the package's API reference; [AGENTS.md](AGENTS.md) carries repository conventions; [PUBLISHING.md](PUBLISHING.md) and [SECURITY.md](SECURITY.md) the release pipeline.

Extracted from the `thomasfosterau/website` application with its git history. Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).
