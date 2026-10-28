---
"@thomasfosterau/biblio": minor
---

`BiblioLookup.byUrl(url)` and `lookupWebPage(client, url, options?)` fetch a publisher's page and read its embedded citation metadata with `readEmbeddedMetadata`, returning `Option<EmbeddedMetadata>` (`None` on a 404). The URL comes from the caller, so the fetch runs under a request policy built into the library. It accepts only `http(s)` URLs with no credentials and the default port. It refuses private, loopback, link-local (cloud metadata), unique-local, reserved and local-network hosts. It re-checks every redirect and follows each one by hand, at most five deep. It bounds the whole exchange, body included, to ten seconds and `MAX_INPUT_LENGTH` bytes, and it accepts only an HTML content type. A refused URL fails with the new `RefusedUrl { url, reason }` error, which joins `LookupError`. `LookupSource` gains `"web"`. The new `resolveAddresses` option on `BiblioLookupOptions` checks every address a host resolves to. Without it, host names are checked only as written, so a name that resolves to a private address is still fetched; a Worker cannot resolve DNS.

`byDoiCsl` / `lookupDoiCsl` now run on the same policy. Their registration-agency redirect allow-list is unchanged. They gain the same time and size bounds, and they apply `resolveAddresses` to redirect hosts (`lookupDoiCsl` takes it as a new optional third argument).

A hand-written implementation of the `BiblioLookup` service must add `byUrl`. Code that switches exhaustively over `LookupError` or `LookupSource` must handle the new members.
