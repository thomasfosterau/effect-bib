---
"@thomasfosterau/biblio": minor
---

In-text citations and rich output. `renderCitations(clusters, records, options)` renders a document's citation clusters and bibliography in one pass: author-date grouping and disambiguation (more names, initials, then year suffixes the bibliography repeats), numeric first-citation numbering with range compression, note-style positions with "ibid.", locators, prefixes and suffixes, narrative citations, and `nocite`. References render to a format-neutral `RichText` AST (italics, links, small caps, …) with `toPlainText`, `toHtml` and `toMarkdown`; `renderReferenceRich` and `RenderedEntry.rich` expose it, and the existing string output is unchanged. Adds `chicagoNotesStyle` (Chicago notes and bibliography), the `note` style category, and optional `CitationStyle.reference` / `citation` and `Locale.ibid` / `locators` members.
