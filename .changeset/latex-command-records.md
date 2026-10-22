---
"@thomasfosterau/biblio": patch
---

Decode LaTeX in BibTeX fields faster: each known command's parser is built once, instead of every time the command occurs. Field values decode about 20% faster on command-dense text, with the same output.
