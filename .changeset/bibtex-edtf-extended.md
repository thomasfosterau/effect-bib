---
"@thomasfosterau/biblio": minor
---

BibLaTeX dates beyond EDTF level 0 now read as dates instead of a `literal`:

- **Era years** are read with ISO 8601 / EDTF astronomical numbering and written as CSL counts BC years. `-0379` is 380 BC, stored as `-380`; `0000` is 1 BC, stored as `-1`. This matches Pandoc.
- **A time of day** (`2001-01-03T17:07:34+05:00`) is dropped, and the date is kept.
- **An open start** (`../2000`, `/1034`) becomes a range whose start is `0`, as Pandoc writes it, with the text kept in `raw`.
- **Unspecified digits** (`199X`, `19XX`, `1999-XX`, `1999-01-XX`) become the date with the unspecified parts left out (unspecified year digits as zeros) and `circa: true`.

EDTF level 2 quarters (`2002-33`) stay a `literal`.
