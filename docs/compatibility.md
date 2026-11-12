# Compatibility and scope

Wire compatibility, the entry-point split, the `Option` contract and what the package leaves to the application.

## Entry points

| Subpath | Imports | Contents |
| --- | --- | --- |
| `.` | `effect` only | `BiblioRecord` and the CSL-JSON interop, the identifier brands and decoders, the file parsers and writers, dedup scoring, the render engine and the two built-in styles |
| `./sources` | `effect/http` | The `BiblioLookup` service and its layers, the per-source lookup functions and response schemas, the typed error channel |

The split is a packaging commitment, not a convention: the root entry resolves none of the modules that were under `effect/unstable/*` before rc.118 (`effect/http`, `effect/sql`, …), nor the directories `effect` has added since (`effect/graphql`, …; see [the forbidden-module list](https://github.com/thomasfosterau/effect-bib/blob/trunk/packages/effect-bib/tests/fixtures/forbidden-effect-modules.mjs)) and no `sources/` module, so a browser bundle that imports it never loads the HTTP clients. [`tests/entry-points.test.ts`](https://github.com/thomasfosterau/effect-bib/blob/trunk/packages/effect-bib/tests/entry-points.test.ts) walks the real import graph of both the sources and the built artifact.

## Compatibility

- **Wire compatibility.** `BiblioRecord` decodes every record the website application has persisted; any change to its shape (a field name, a key's optionality, an identifier brand, the `provenance` / `extra` shape) is a major version. The item `id`, `categories`, the rest of the CSL 1.0.2 variables and the `pmid` / `pmcid` / `arxiv` identifier slots are all optional, so a record from before they were typed still decodes; `fromCslJson(toCslJson(record))` moves such a record's CSL variables out of `extra`.
- **`Option`, not nullables.** Every value that can be absent is an `Option`: `isbnForms(isbn).isbn10`, `parsePersonName`, `makeCslName`, `cslNameDisplay`, `yearOf`, `bestConfidentMatch` and `getStyle` included (they returned `null` / `undefined` before 0.2.0). Options objects take plain optional members (`{ mode: "lenient" }`; omit a key rather than pass `undefined`), and the `BiblioRecord` wire shape keeps its native optional keys.
- **Scope.** The package stops at the CSL record: mapping records onto an application's own data model and persisting them stay in the application. Extracted from `thomasfosterau/website`'s `packages/biblio` with its git history; a `website#NNN` cite in a source comment is an issue in `thomasfosterau/website`.
