---
"@thomasfosterau/effect-bib": minor
---

Breaking: the total decoders and sanitisers take named types instead of `unknown`. `fromCslJson(item)`, `readCslName(entry)` and `readCslNameArray(value, maxNames?)` take `Schema.Json`; `sanitiseText(value, maxLength?)` takes a `string` and `sanitiseYear(value)` a `string | number`. Decode an untrusted value first (`Schema.decodeUnknownOption(Schema.Json)` or `Schema.String`), then pass it in; a non-string or non-year input is now a decode `None` at the caller's boundary rather than a `None` from the sanitiser.
