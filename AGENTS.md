# AGENTS.md

Read [README.md](README.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) first; this file adds only what is specific to agents.

## Before changing code

- Read [packages/effect-bib/AGENTS.md](packages/effect-bib/AGENTS.md): it states the package's boundary and invariants (the `BiblioRecord` wire shape, the browser-safe root entry, total decoders, the request policy).
- Read the issue you're working on in full, comments included, and re-check its claims against current `trunk`.

## Pitfalls

- `vp run check` and the tests build `dist/` first; `tests/entry-points.test.ts` and the dist-consumer fixture check the built output, not `src/`.
- `vp run -r docgen` executes every `@example`: one that throws or fails to type-check is a red gate.
- Publish only through the Release workflow (`vp run release`: `vp pm publish -r`, then `changeset git-tag`). Release-path registry calls go through `vp pm`, never `npm` / `pnpm` directly.
- The BibTeX oracle test needs `oracles:fetch` (network); it skips locally without it and fails under CI.
- Write idiomatic Effect v4 and read `node_modules/effect` rather than guessing an API. Non-idiomatic code you find outside your change (hand-rolled utilities Effect provides, ad-hoc error handling, `null` where `Option` fits) gets an issue listing the sites and the replacement, unless the fix is trivial.

## Process

- You may open PRs in this repository, and should watch them through CI and review.
- Out-of-scope work you notice: file an issue (search for duplicates first) and move on.
- Use the GitHub MCP tools or `gh`, whichever is available. Write only to `thomasfosterau/effect-bib`; with `gh`, pass `-R thomasfosterau/effect-bib` when the cwd might be another checkout.

## Fallow

The `fallow` agent skill is linked into `.claude/skills/` from the installed `fallow` package after `vp install`; repository-specific rules (the pre-commit audit, tracing before deleting) are in docs/CONTRIBUTING.md.
