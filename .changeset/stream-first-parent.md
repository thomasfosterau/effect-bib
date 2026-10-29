---
"@thomasfosterau/biblio": patch
---

`parseBibliographicStream` now gives a `crossref` child the first entry with its parent's key, as `parseBibliographicFile` does, not the latest. When that entry leaves the stream's 1000-entry window, the child reads the next entry with the key that is still in it.
