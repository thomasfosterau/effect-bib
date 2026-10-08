---
"@thomasfosterau/biblio": minor
---

`BiblioLookup` identifies every request with the caller's own contact instead of the package author's. `biblioLookupLayer` and `biblioLookupClientLayer` are now functions that take `{ contact: LookupContact }` (`{ product, email }`): each request sends `User-Agent: <product> (mailto:<email>)`, and OpenAlex requests send `mailto=<email>`. `lookupOpenAlexByDoi` and `searchOpenAlexByTitle` take the contact as a third argument. The service key is `"@thomasfosterau/biblio/BiblioLookup"`, so it cannot collide with an application's own `@app/*` services.
