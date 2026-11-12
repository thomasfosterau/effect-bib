---
"@thomasfosterau/effect-bib": patch
---

`parseBibliographicStream` finds each entry's start in a batch in constant time, so a chunk holding many entries is read in linear time. Streaming a 5 MB CSV in 1 MB chunks took about 12 s because each outcome scanned every start in its batch; it now takes under 2 s.
