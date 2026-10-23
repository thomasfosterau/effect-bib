---
"@thomasfosterau/biblio": minor
---

BibTeX formatting as CSL markup, and fuller rich rendering. A new opt-in parse option, `bibtexMarkup`, keeps BibTeX's formatting in text fields as CSL rich-text markup (`\emph` / `\textit` → `<i>`, `\textbf` → `<b>`, `\textsc` → small caps, `\textsuperscript` / `\textsubscript` → `<sup>` / `<sub>`, a case-protecting `{DNA}` → `<span class="nocase">`, a literal `<` → `<span class="nocase"><</span>`); without it the output is unchanged. `toHtml` and `toMarkdown` flip-flop italics as citeproc-js does (italic inside italic renders upright: a `font-style:normal` span in HTML), and the Vancouver style renders rich output like APA's, so a title's `<sub>` / `<sup>` / `<i>` reach its HTML; its plain text is unchanged.
