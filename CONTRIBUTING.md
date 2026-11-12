# Contributing

Maintained by Thomas Foster, with a workflow meant to be approachable for both humans and coding agents. Coding-agent guidance (conventions, pitfalls, the gate list) is in [AGENTS.md](AGENTS.md); the project overview is in the [README](README.md).

## Setup

Open in a Codespace or Dev Container: `.devcontainer/` provisions it with the same hook as agent sessions. The `Dev Container` workflow (`.github/workflows/devcontainer.yml`) builds it in CI whenever its inputs change; to try a change locally, `pnpm dlx @devcontainers/cli@0.89.0 up --workspace-folder .` (needs Docker).

`pnpm install` (or `vp install`) installs dependencies, patches the native `tsc` / `oxlint` with `@effect/tsgo` (the root `prepare` script) and installs the Vite+ git hooks: the committed [.vite-hooks/pre-commit](.vite-hooks/pre-commit) runs `vp staged` (`vp check --fix --no-lint`, then `vp check --no-fmt`: formatting is fixed, lint, which is type-aware, only reports). There is no pre-push hook.

## Commands

- `vp install` — dependencies plus the Vite+ git hooks (see [Setup](#setup)).
- `vp check` — format + lint (Oxfmt + Oxlint: the Effect presets plus oxlint's `correctness`, `suspicious` and `perf` categories over the `typescript`, `unicorn`, `oxc`, `import`, `promise`, `vitest` and `jsdoc` plugins). Lint is type-aware through oxlint-tsgolint (`typeAware` + `typeCheck`), so it also reports TypeScript errors; a rule is relaxed only in `vite.config.ts`, with its reason. `vp run check` — the type gate: the package's `check` (sources, tests and the type-level `tests/**/*.types.ts`) plus the dist-consumer declaration check against `packages/effect-bib/dist`, which it builds first. They are different commands.
- `vp run -r test:unit` — builds `dist/`, then the unit tests (the lookup sources run against a stubbed `FetchHttpClient`, never the network). `vp run -r test:coverage` runs the same tests under istanbul and fails on the coverage thresholds or on a coverage provider that differs from vite-plus's bundled `vitest` version (#47); it is the gate CI runs.
- `vp run -r build` — emit `dist/`.
- `vp run -r docgen` — compile and execute every JSDoc `@example` (output under `packages/*/docs/`, gitignored). Execution needs `"runExamples": true` in `packages/effect-bib/docgen.json`: `@effect/docgen` 4 defaults it off and only type-checks, logging "Skipping running examples" (#34).
- `pnpm changeset` — add a changeset.

Invoke everything else through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations are `pnpm install`, `pnpm changeset` and the release path (`pnpm run version` / `pnpm run release`, run by the Release workflow). Individual checks are listed [below](#running-individual-checks).

## Branches, pull requests and changesets

- Branch off `trunk`; PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Name branches `issue-<n>-<slug>`. Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- Every change to a published package's behaviour carries a changeset (`pnpm changeset`). Changes to doc comments that reach the emitted `.d.ts` (TSDoc) take a `patch` changeset; other docs-only changes (READMEs, guidance), CI and tooling need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. See [PUBLISHING.md](PUBLISHING.md).

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs one job, the gates in [AGENTS.md#verification](AGENTS.md#verification) minus the local fallow audit. Every workflow defaults to `permissions: {}`, locks each action to its commit in `.github/workflows/actions.lock` (exact release tags in `uses:`; regenerate it with `gh actions-lock` after changing a workflow, and the `Lockfile` workflow runs `gh actions-lock --verify`), checks out without persisted credentials (except the Release job, whose Changesets step pushes), sets Node as `"*"` with `check-latest` (never `latest`, which can resolve to a pre-release) and never runs the Release job for Dependabot; CI needs no secret, so Dependabot PRs run it safely. `uvx zizmor --offline .github` audits the workflows (config in `.github/zizmor.yml`). [release.yml](.github/workflows/release.yml) runs changesets/action on `trunk`: it opens the "Version Packages" PR while unreleased changesets exist and publishes once it merges, via npm trusted publishing (OIDC) from the protected `release` environment — see [PUBLISHING.md](PUBLISHING.md).

## Pre-PR checklist

1. The gates in [AGENTS.md#verification](AGENTS.md#verification), in order, each passing.
2. A changeset (`pnpm changeset`) for every change to a published package's behaviour.
3. `git fetch origin trunk && git rebase origin/trunk`.
4. Docs: the package `README.md` for any exported change (and an `@example` on a new entry point); the package `AGENTS.md` for a new term or invariant; `@since` on every new export.

## Running individual checks

```sh
vp lint                                    # oxlint
vp fmt                                     # oxfmt (writes)
vp check --fix                             # format + lint, autofix
vp run check                               # the whole type gate (builds dist/ for the declaration check)
vp run --filter ./packages/effect-bib check    # one package's type check
vp run -r test:coverage                    # unit tests + coverage thresholds, the CI gate (builds dist/ first)
vp run -r test:unit                        # the same unit tests, no coverage (builds dist/ first)
vp test run tests/some.test.ts             # single file (from inside the package)
vp run -r build                            # emit dist/
vp run -r docgen                           # compile + execute the JSDoc examples
vp run fallow:audit                        # change-set review (not a CI gate; run test:coverage first for the coverage map)
```
