---
"@thomasfosterau/biblio": minor
---

`BiblioLookup` identifies its requests with the caller's contact. `biblioLookupLayer` and `biblioLookupClientLayer` take `{ contact: LookupContact }` (`{ product, email }`): every request made through either layer sends `User-Agent: <product> (mailto:<email>)`, and OpenAlex requests also send `mailto=<email>`. `lookupOpenAlexByDoi` and `searchOpenAlexByTitle` take the contact as their third argument. The service key is `"@thomasfosterau/biblio/BiblioLookup"`.
