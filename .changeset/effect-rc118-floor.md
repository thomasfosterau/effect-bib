---
"@thomasfosterau/biblio": minor
---

**Breaking:** requires `effect@>=4.0.0-rc.118`.

Effect rc.118 removed the `effect/unstable/*` export paths, so the previous peer range (`>=4.0.0-rc.115`) admitted versions that fail at import. The peer floor is now `>=4.0.0-rc.118`; the `./sources` entry imports `effect/http` (previously `effect/unstable/http`) and its emitted `dist/*.d.ts` reference the new path, so consumers must be on rc.118 or newer. The root entry is unchanged and still imports `effect` only.
