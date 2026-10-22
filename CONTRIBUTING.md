# Contributing

Maintained by Thomas Foster, with a workflow meant to be approachable for both humans and coding agents. Conventions — branch model, changesets, the gate list — are in [AGENTS.md](AGENTS.md).

## Setup

`pnpm install` (or `vp install`) installs dependencies, patches the native `tsc` / `oxlint` with `@effect/tsgo` (the root `prepare` script) and installs the Vite+ git hooks: the committed [.vite-hooks/pre-commit](.vite-hooks/pre-commit) runs `vp staged` (`vp check --fix` on staged files). There is no pre-push hook.

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs one job, the gates in [AGENTS.md#verification](AGENTS.md#verification) minus the local fallow audit. [release.yml](.github/workflows/release.yml) runs changesets/action on `trunk`: it opens the "Version Packages" PR while unreleased changesets exist and publishes once it merges, via npm trusted publishing (OIDC) from the protected `release` environment — see [PUBLISHING.md](PUBLISHING.md).

## Pre-PR checklist

1. The gates in [AGENTS.md#verification](AGENTS.md#verification), in order, each passing.
2. A changeset (`pnpm changeset`) for every change to a published package's behaviour.
3. `git fetch origin trunk && git rebase origin/trunk`.
4. Docs: the package `README.md` for any exported change (and an `@example` on a new entry point); the package `CLAUDE.md` for a new term or invariant; `@since` on every new export.

## Running individual checks

```sh
vp lint                                    # oxlint
vp fmt                                     # oxfmt (writes)
vp check --fix                             # format + lint, autofix
vp run check                               # the whole type gate (builds dist/ for the declaration check)
vp run --filter ./packages/biblio check    # one package's type check
vp run -r test:coverage                    # unit tests + coverage thresholds, the CI gate (builds dist/ first)
vp run -r test:unit                        # the same unit tests, no coverage (builds dist/ first)
vp test run tests/some.test.ts             # single file (from inside the package)
vp run -r build                            # emit dist/
vp run -r docgen                           # compile + execute the JSDoc examples
vp run fallow:audit                        # change-set review (not a CI gate; run test:coverage first for the coverage map)
```
