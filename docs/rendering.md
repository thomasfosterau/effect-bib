# Rendering and citations

Reference and bibliography rendering, rich text, CSL markup and the document citation pass. All from the root entry (`@thomasfosterau/effect-bib`).

Snippets are excerpts of JSDoc `@example`s in the source, which CI compiles and executes (`vp run -r docgen`); variables an example defines earlier (`record`, `outcomes`, `article`, …) are elided here. Per-export detail (signatures, defaults, bounds) is in the doc comments, which show on hover and ship in the package `.d.ts`.

## Styles and references

**`renderReference(record, { style, locale? }): string`** and **`renderBibliography(records, options): RenderedBibliography`** — author-date styles sort by the style's `sortKey` and carry no label; numeric styles keep citation order and number each entry (`label: Option<string>`). **`bibliographyToText(bibliography)`** flattens to one line per entry. `locale` defaults to `enLocale`.

**`apaStyle`** (APA 7th, author-date), **`vancouverStyle`** (numeric) and **`chicagoNotesStyle`** (Chicago 17th notes and bibliography, a note style) are the built-ins; `builtInStyles` holds the three (`{ apa, vancouver, "chicago-notes" }`) and `getStyle(id)` looks a style up by any id (an `Option`, `Option.none()` when unknown). A `CitationStyle` is data — `{ id, title, category, renderReference, sortKey }`, optionally `reference` (rich output) and `citation` (in-text settings: et-al thresholds, affixes, delimiters, a note style's first and short forms) — so a consumer can supply its own without touching the engine, composing the `format.ts` primitives (`formatNameList`, `givenInitials`, `issuedYearText`, `pagesLabel`, `preferredUrl`, `dispatchRich`, …).

## Rich text

`renderReferenceRich(record, options): RichText` is the same reference with its formatting kept (APA's italic titles, journals and volumes; a linked DOI), and every `RenderedEntry` carries `rich` beside `text`. `RichText` is a small format-neutral inline AST (`Text`, `Italic`, `Bold`, `SmallCaps`, `Superscript`, `Subscript`, `NoCase`, `Link`, `Display`) with `toPlainText`, `toHtml` (citeproc-js's markup; a link renders only for an `http(s)` or `mailto` URL) and `toMarkdown` adapters. Italics flip-flop as in citeproc-js: italic inside italic (a species name in an italic book title) renders upright, as a `font-style:normal` span in HTML and outside the emphasis in Markdown. The string functions are `toPlainText` over the same tree.

## CSL markup in fields

A record's text variables may carry CSL-JSON's rich-text markup (`<i>`, `<b>`, `<sup>`, `<sub>`, `<span style="font-variant:small-caps;">`, `<span class="nocase">`), kept as text on the record as CSL-JSON keeps it. **`parseCslMarkup(value): RichText`** reads it (anything else that looks like a tag is literal text), **`toCslMarkup(rich)`** writes it back, and **`stripCslMarkup(value)`** is its plain text. All three built-in styles render it (`richField`; Vancouver's `<sub>` / `<sup>` survive in its rich output too), and sorting, plain-string output (`plainField`) and dedup read the plain text. Dates render a range's years (`2001–2003`) and a `literal` date as written.

```ts
const title = parseCslMarkup(
  'The <i>Escherichia coli</i> genome and <span class="nocase">DNA</span>',
);
assert.strictEqual(toPlainText(title), "The Escherichia coli genome and DNA");
assert.strictEqual(toHtml(title), "The <i>Escherichia coli</i> genome and DNA");
```

## Citations

**`renderCitations(clusters, records, { style, locale?, nocite? }): RenderedCitations`** renders a whole document's in-text citations and its bibliography in one pass. `records` is any iterable of `[id, record]` pairs (a `Map`); a cluster is `{ cites: [{ id, locator?, label?, prefix?, suffix?, mode? }] }`, with `mode` one of `normal`, `suppress-author`, `author-only` and `author-in-text` (narrative: `Ray (2004)`). Author-date styles sort and group a cluster's cites (`Smith, 2001, 2004`) and disambiguate across the document (more names, then initials, then a year suffix `2004a` the bibliography repeats); numeric styles number sources in order of first citation and compress runs (`[1–3, 5]`); note styles give a source's first note in full, later ones short, and a repeat "ibid.", with each cite's position reported. `nocite` (ids, or `"*"`) adds uncited records to the bibliography, and `missing` lists cited ids with no record.

```ts
const apa = renderCitations(clusters, records, { style: apaStyle });
assert.deepStrictEqual(
  apa.citations.map((citation) => citation.text),
  ["(Ray, 2004, p. 5; Smith, 2001, 2004b)", "Ray (2004)", "(Smith, 2004a)"],
);
assert.strictEqual(apa.bibliography.entries[3]?.text, "Smith, J. (2004b). Third.");
```

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
