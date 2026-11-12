---
"@thomasfosterau/effect-bib": patch
---

`parseCslYaml` reads long block sequences and mappings in linear time: the block readers no longer copy the remaining lines for every entry, so a flat list of 100,000 short entries parses in well under a second instead of about a minute. Output is unchanged.
