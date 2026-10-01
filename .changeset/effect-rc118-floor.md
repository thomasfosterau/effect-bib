---
"@thomasfosterau/biblio": minor
---

Requires `effect@>=4.0.0-rc.118` (the peer range). rc.118 moved the former `effect/unstable/*` modules to top-level paths, so the `./sources` entry imports `effect/http` and its emitted `dist/*.d.ts` reference that path. The root entry imports `effect` only.
