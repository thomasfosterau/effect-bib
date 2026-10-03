---
"@thomasfosterau/biblio": patch
---

The `@example` blocks in the TSDoc now state their expected values with `node:assert` instead of `console.log` and a `// →` comment, so `docgen` fails when an example's output changes.
