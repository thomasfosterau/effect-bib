---
"@thomasfosterau/biblio": minor
---

Embedded web metadata and DOI content negotiation. `readEmbeddedMetadata(html, options?)` reads a web page's citation metadata into records: the page's own record from its Highwire Press `citation_*` tags, schema.org JSON-LD (authors with ORCIDs, the periodical, volume and issue a work is part of) or Dublin Core tags, merged in that order, and one record per COinS span. It is pure and total, scans the page as text, and bounds the page length and the COinS record count. `ProvenanceSource` gains `"html"` for these records.

`BiblioLookup` gains `byDoiCsl(doi)`, and `./sources` gains `lookupDoiCsl(client, doi)`: they fetch a DOI's CSL-JSON from `https://doi.org` by content negotiation, which the DOI's registration agency answers (Crossref, DataCite, mEDRA), so DataCite DOIs resolve too. `LookupSource` gains `"doi"`. A hand-written implementation of the `BiblioLookup` service must add the new method. Code that switches exhaustively over `ProvenanceSource` or `LookupSource` must handle the new members.
