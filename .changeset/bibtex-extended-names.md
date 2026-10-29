---
"@thomasfosterau/biblio": minor
---

`parseBibtex` reads BibLaTeX's extended name format (biber's `\DeclareNameFormat` keys): a name such as `family=Rabble, given=Richard, prefix=von, useprefix=true` gives `{ family: "Rabble", given: "Richard", "non-dropping-particle": "von" }`. It reads the `family`, `given`, `prefix` and `suffix` parts, with braces protecting a value. A per-name `useprefix` overrides the entry's. Other keys, such as `given-i`, are ignored. Before this change such a name was read as words.

A family name that opens with a braced particle ending in a hyphen or an apostrophe (`{al-}Hasan`, `{d'}Alembert`) now gives that particle as the non-dropping particle, as biber and Pandoc read it. Before this change the name read as `alHasan`.
