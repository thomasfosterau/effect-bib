---
"@thomasfosterau/effect-bib": minor
---

`ResolveAddresses`, the resolver `byUrl`, `byDoiCsl`, `lookupWebPage`, `lookupDoiCsl` and `biblioLookupLayer` accept, can no longer fail: its type is `(hostname) => Effect<readonly string[]>` instead of `Effect<readonly string[], unknown>`. A resolver whose lookup can fail answers that failure with no addresses (`Effect.orElseSucceed(() => [])`), which refuses the host as a failure did before. A resolver that fails no longer type-checks.
