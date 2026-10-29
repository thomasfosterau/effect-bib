---
"@thomasfosterau/biblio": patch
---

The doc comments for `byUrl`, `lookupWebPage`, `ResolveAddresses` and `BiblioLookupOptions.resolveAddresses` now say that the resolver is a best-effort pre-check that does not stop DNS rebinding. Pinning the connection is the caller's transport's job. The README shows how to do that on Node with an undici `Agent` whose `connect.lookup` refuses non-public addresses, supplied through `biblioLookupClientLayer`.
