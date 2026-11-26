# Contributing

## Workflow

The main branch is `trunk`. Branch off `trunk`, open a pull request into `trunk`, and squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`).

- **Open a draft PR early**, so others can see the work is taken.
- **One PR per change**, even a large one.
- **Rebase, don't merge.** Rebase onto `origin/trunk`; never merge `trunk` into your branch.
- **File issues** for bugs or improvements you spot outside your change, rather than fixing them in passing or leaving a TODO. Keep issue bodies evergreen: edit them in place as the picture changes.
- **Dependabot** keeps dependencies current. Update one by hand only when your work needs it or Dependabot can't (see [Dependencies](#dependencies)).

## Toolchain

[Vite+](https://viteplus.dev) (`vp`) manages Node and pnpm; use it rather than calling them directly (`vp exec <bin>`, not `npx`). The pre-commit hook ([.vite-hooks/pre-commit](../.vite-hooks/pre-commit)) runs `vp staged` (format with fixes, then lint) and then `vp run fallow:audit`.

| Command | What it does |
| --- | --- |
| `vp install` | Dependencies, git hooks, and the Effect-patched `tsc` / `oxlint` (`prepare`) |
| `vp check` | Format and lint, type-aware |
| `vp run check` | The type gate, including a consumer fixture checked against the emitted declarations (builds `dist/`) |
| `vp run -r test:coverage` | Unit tests and coverage thresholds (`test:unit` without coverage) |
| `vp run -r build` | Emit `dist/` |
| `vp run -r docgen` | Compile and execute every JSDoc `@example` |
| `vp run ci` | Everything CI runs, in the same order |
| `vp test run tests/<file>` | One test file, from inside `packages/effect-bib` |

`vp check` (format + lint) and `vp run check` (the type gate) are different commands.

[Fallow](https://docs.fallow.tools) checks dead code, boundaries, complexity and duplication (`vp run fallow`). Its findings are guidance, not dogma, and CI doesn't run it. The pre-commit hook runs `vp run fallow:audit`, which fails only on findings the change introduces against `origin/trunk`. Before deleting "unused" code, trace it: `vp exec fallow dead-code --trace <file>:<export>` (or `--trace-dependency <name>`).

## Coding guidelines

- **Effect.** Use Effect (v4) idioms throughout, and prefer Effect's own modules (`Option`, `Array`, `Match`, `Schema`, `effect/http`, …) to hand-rolled equivalents; convert existing code when you touch it, where practical. Exceptions: non-Effect APIs (adapt them at the edge) and hot paths where measurement shows plain code is needed. Read the installed package rather than guessing an API: `node_modules/effect/` ships `AGENTS.md`, `ai-docs/`, typings and source. The lint config enforces the house idioms (absent values are `Option`; Effect modules are namespace imports, with the `Arr` / `P` / `R` / `Str` / `Eq` / `Bool` aliases); fix findings in code rather than disabling a rule.
- **Exports** follow Effect v4's layout: `index.ts` re-exports PascalCase modules as namespaces (`export * as Record from "./Record.ts"`), each also importable through its own PascalCase subpath. The current flat root predates this; new modules follow it.
- **Imports.** Relative imports carry their `.ts` extension. Tests import from `vite-plus/test` or `@effect/vitest`, never `vitest`.
- **Comments.** A file-level comment only when it gives real context, in under 50 words. Doc comments where they help someone reading IntelliSense, adding to the signature rather than restating it; every export carries `@since`, and the entry points an `@example` that `docgen` executes (assert with `node:assert`, don't `console.log`). Inline comments only for what the code can't say. Don't reference issues, PRs or CI runs in comments.
- **Tests** check logic: edge cases, regressions, complex behaviour. Don't test what the type system or a lint enforces, or trivial code. Never lower a coverage threshold to make a change pass.
- **Docs.** The package README stays short; API detail goes in doc comments, how-tos in [docs/](.).

## Before pushing

Run `vp run ci`, or the gates one at a time:

1. `vp check`
2. `vp run -r build`
3. `vp run check`
4. `vp run --filter ./packages/effect-bib oracles:fetch` (network), then `vp run -r test:coverage`
5. `vp run -r docgen`
6. `pnpm audit --audit-level high` (network)

Say in the PR body which gates couldn't run. CI ([ci.yml](../.github/workflows/ci.yml)) runs `vp run ci` on Node `lts` and `latest`. Workflows pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`: run `gh actions-lock` after changing a `uses:`. `uvx zizmor --offline .github` audits the workflows.

## Changesets

Every change to the published package's behaviour, or to doc comments that reach the emitted `.d.ts`, carries a changeset (`vp exec changeset`); CI, tooling and other docs changes need none. Changing the `BiblioRecord` wire shape is a major. Never version or publish by hand: the Release workflow opens the "chore: version packages" PR, and merging it publishes with `vp run release` (`vp pm publish -r`, then `changeset git-tag`; there is no publish script). `vp run release:dry-run` shows what it would publish ([PUBLISHING.md](PUBLISHING.md)).

## Dependencies

Dependabot ([dependabot.yml](../.github/dependabot.yml)) opens `@thomasfosterau/*` updates daily and every other update weekly, on Wednesday morning Melbourne time: the named runtime sets (`effect` and the like) each in one PR, and every other development dependency in the single `toolchain` group. Security updates skip the schedule and open as soon as an advisory lands, one PR each. Vite+ selects Node.js from `.node-version` and pnpm from `packageManager`; pnpm's own switching is off (`runtimeOnFail` / `pmOnFail`), so one version of each is installed and used.

Every external version is in the `pnpm-workspace.yaml` catalog; package.json files use `catalog:`, `catalog:peers` or `workspace:*`. After editing the catalog, run `vp install` and commit `pnpm-lock.yaml`. Dependabot groups the sets that must move together, but can't make these moves: make them in a PR from a new branch started from its PR's head (never push to a `dependabot/*` branch, which stops it rebasing), and Dependabot closes its own PR once yours merges.

- **Toolchain** (`vite-plus`): run `vp dlx --package=vite-plus@<v> vp migrate --no-interactive` to re-pin `vite` and `vitest`, set `@vitest/coverage-istanbul` to the same `vitest`, then drop the `minimumReleaseAgeExclude` entries it adds; bump the devcontainer image tag. `typescript` / `@typescript/native` move only with an `@effect/tsgo` that supports them (see the catalog comment).
- **Peer ranges** in `catalogs.peers` are deliberate floors: change them by hand, with a changeset.
- **Security overrides** are raised or dropped as their advisories move.
