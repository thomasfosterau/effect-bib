---
"@thomasfosterau/biblio": patch
---

Doc comments rewritten for consumers: every hover opens with a summary in the package's own vocabulary (no application paths or entity names), split doc blocks on `bestConfidentMatch` and `sanitiseText` are merged so their summaries show, broken module links are fixed, and the plain-nullable returns (`isbnForms().isbn10`, `bestConfidentMatch`, `getStyle`, …) are documented as a stable contract.
