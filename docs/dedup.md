# Dedup

Same-work scoring, from the root entry (`@thomasfosterau/effect-bib`).

Snippets are excerpts of JSDoc `@example`s in the source, which CI compiles and executes (`vp run -r docgen`); variables an example defines earlier (`record`, `outcomes`, `article`, …) are elided here. Per-export detail (signatures, defaults, bounds) is in the doc comments, which show on hover and ship in the package `.d.ts`.

**`recordMatchInput(record): MatchInput`** projects a record to `{ title, authors }`; **`scoreMatch(incoming, candidate): MatchScore`** scores title-token Jaccard, author-surname Jaccard (`Option.none()` when either side has no authors) and the shared significant title tokens; **`isConfidentMatch(score)`** is the high-precision same-work decision (title ≥ 0.9 with author agreement ≥ 0.5, or title ≥ 0.95 with ≥ 2 shared tokens when there is no author signal); **`matchConfidence(score)`** ranks; **`bestConfidentMatch(incoming, candidates)`** picks the best confident candidate, an `Option`. Normalisers: `normaliseForMatch`, `titleTokens`, `authorSurname`.

```ts
const score = scoreMatch(
  { title: "The Hobbit", authors: ["J. R. R. Tolkien"] },
  { title: "Hobbit", authors: ["Tolkien, J.R.R."] },
);
assert.strictEqual(isConfidentMatch(score), true);
```
