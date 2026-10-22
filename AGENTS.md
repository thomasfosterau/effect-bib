# AGENTS.md

`CLAUDE.md` is a symlink to this file. This repo publishes `@thomasfosterau/biblio` (`packages/biblio`), extracted with its history from `thomasfosterau/website`. The website, gardeneria and preferenceflow apps consume it, and their toolchain (pnpm + Vite+ `vp`, strict catalog, TypeScript 6/7 split, Effect oxlint preset, fallow) is copied here so the library builds against what they run. A `<repo>#NNN` cite in a comment (`website#NNN`, `gardeneria#NNN`) is an issue in that repository, the evidence behind a decision, not a ticket in this tracker; a bare `#NNN` is an issue or PR in this repository.

## Common pitfalls

- **The Effect lint preset has no allowances left.** `@mpsuesser/oxlint-plugin-effect` (`effect.configs.recommended`) and `@effect/tsgo`'s `recommended` run at their own levels in `vite.config.ts`; only `casting-awareness` is a warning by design. A finding is fixed in code, not suppressed: the two per-site exceptions (`prefer-option-over-null` on the plain-nullable seams, `no-unknown-parameters` on the public total decoders) are listed in the package CLAUDE.md, and a new one needs the same written contract.
- **Package-local rules live in [`packages/biblio/CLAUDE.md`](packages/biblio/CLAUDE.md)**: the `BiblioRecord` wire contract, the browser-safe root entry and its forbidden-module list, total decoders, the plain-nullable seams (and why `effect/prefer-option-over-null` stays at `error`), the doc-comment rules (`@since`, `@example`, hover summaries). Read it before touching `packages/biblio`.
- **This package emits declarations; the application never did.** `tests/dist-consumer` type-checks a consumer fixture against the emitted `dist/` declarations with `Equals<…>` assertions on the brands and the service shape (a brand that emits as `string`, or a service that emits as `any`, fails there rather than in an application). `vp run check` builds `dist/` first (the check depends on `@thomasfosterau/biblio#build`) and fails outright if the entry declarations are missing, rather than falling back to `src/` (#22).
- **No application vocabulary.** No WEMI / spine mapping, no `owner_id`, no database rows, no ingest operations, no app paths in doc comments. Those stay in the apps; the package stops at the CSL record.
- **Every external version lives in `pnpm-workspace.yaml`'s catalog** (`catalogMode: strict`; manifests carry only `catalog:`, `catalog:peers` or `workspace:*`). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **`@effect/tsgo`, `@typescript/native` and `vite-plus` bump together.** `prepare` (`effect-tsgo patch`) overwrites the native `tsc` and `oxlint` and fails `pnpm install` with `UnsupportedTargetPackageVersionError` on an unsupported pairing; read the comment on `@effect/tsgo` in `pnpm-workspace.yaml` first. Dependabot opens the whole set (with `vitest`, `@vitest/*`, oxlint/oxfmt and the Effect lint plugin) as one `toolchain` group PR (`.github/dependabot.yml`); merge it only once its `pnpm install` and gates pass, and never split it. The published `effect` peer range (`catalogs.peers`) is the one version Dependabot does not move: change it by hand, with a changeset.
- **Declare peers explicitly.** A required peer of a dependency must be a declared dependency, or CI fails on a fresh runner while a warm local tree passes.

## Conventions

- Optional members are `?: T | undefined`, never bare `?: T` (`exactOptionalPropertyTypes`).
- Relative imports carry their `.ts` extension (`rewriteRelativeImportExtensions`).
- Tests import from `vite-plus/test`, never `vitest` (lint-enforced by `vite-plus/prefer-vite-plus-imports`).

## Commands

- `vp install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: `vp check --fix` on staged files). No pre-push hook.
- `vp check` — format + lint (Oxfmt + Oxlint). `vp run check` — the type gate: the package's `check` (sources, tests and the type-level `tests/**/*.types.ts`) plus the dist-consumer declaration check against `packages/biblio/dist`, which it builds first. They are different commands.
- `vp run -r test:unit` — builds `dist/`, then the unit tests (the lookup sources run against a stubbed `FetchHttpClient`, never the network). `vp run -r test:coverage` runs the same tests under istanbul and fails on the coverage thresholds or on a coverage provider that differs from vite-plus's bundled `vitest` version (#47); it is the gate CI runs.
- `vp run -r build` — emit `dist/`.
- `vp run -r docgen` — compile and execute every JSDoc `@example` (output under `packages/*/docs/`, gitignored). Execution needs `"runExamples": true` in `packages/biblio/docgen.json`: `@effect/docgen` 4 defaults it off and only type-checks, logging "Skipping running examples" (#34).
- `pnpm changeset` — add a changeset.

Invoke everything else through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations are `pnpm install`, `pnpm changeset` and the release path (`pnpm run version` / `pnpm run release`, run by the Release workflow). Individual checks are listed in [CONTRIBUTING.md](CONTRIBUTING.md#running-individual-checks).

## Verification

Before you report work as done, run the gates below in order (CI's order, `.github/workflows/ci.yml`) and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. `vp check`
2. `vp run -r build`
3. `vp run check`
4. `vp run -r test:coverage`
5. `vp run -r docgen`
6. `pnpm audit --audit-level high` (network)
7. `fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` (the fallow gate below; not a CI step). It reads the Istanbul map `packages/biblio/coverage/coverage-final.json` that step 4 writes (`health.coverage` in `.fallowrc.json`), so run it after `test:coverage`; without the map fallow scores every function as uncovered.

- **`dist/` is built by the gates that read it.** `vp run check` and `vp run -r test:coverage` (like `test:unit`) each depend on `build` (#22), so on a clean tree they emit `dist/` before the dist-consumer check and the built-artifact cases in `packages/biblio/tests/entry-points.test.ts` run. Those cases still skip under a bare `vp test` without `dist/`, except under `CI`, where they fail instead; a skip there is not a run.
- **Before pushing, reinstall from clean** to catch a missing peer a warm tree hides: `rm -rf node_modules packages/*/node_modules tests/*/node_modules && pnpm install --frozen-lockfile`, then the gates.

## Branches and pull requests

- Branch off `trunk`; PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Name branches `issue-<n>-<slug>`. Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- Agent work uses git worktrees under `.claude/worktrees/`, one per branch; start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing.
- Every change to a published package's behaviour carries a changeset (`pnpm changeset`). Changes to doc comments that reach the emitted `.d.ts` (TSDoc) take a `patch` changeset; other docs-only changes (READMEs, guidance), CI and tooling need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. See [PUBLISHING.md](PUBLISHING.md).
- These are standing approvals: **always open a PR** once a branch has a pushed commit; **watch it to merge or close** (investigate CI failures and review comments, rebase when it goes conflicting); **keep the PR body current** as the implementation diverges. Fill [`.github/pull_request_template.md`](.github/pull_request_template.md).
- GitHub writes go to `thomasfosterau/effect-bib` only; pass `-R thomasfosterau/effect-bib` whenever the cwd might be another checkout. Never write to the consuming applications' repositories without the owner's explicit approval for that action in the current session. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available.

## Work tracker

- Issues are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. There is no in-repo backlog file.
- The issue is the spec — read its comments; later comments override the body. Re-verify its code claims against current `trunk` before editing.
- Record decisions and findings as issue comments.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.
- Adoption by each application is tracked in that application's own tracker (website#2021 for biblio), blocked on a release of this package.

## Effect

Read the installed package before writing Effect code, and never guess at an Effect API: `node_modules/effect/dist/*.d.ts` (signatures and their doc comments), `node_modules/effect/src` (implementations), and `node_modules/effect/AGENTS.md` plus the `ai-docs/` it links, which the pinned version ships. The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog. On rc.118 and later the former `effect/unstable/*` modules are `effect/*` (`effect/http`, not `effect/unstable/http`), and a schema-backed error is `Schema.TaggedError<Self>()(tag, fields)` (older guides say `Schema.TaggedErrorClass`, which does not exist in rc.x).

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs dependencies against the lockfile and links `vp` (a re-exec shim that prefers the nearest worktree's `node_modules`), `tsx` and `fallow` into `~/.local/bin` so they resolve from a non-interactive shell, and repairs a broken bare `node`. It hydrates no secrets; none are needed.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) runs the fallow gate before `git commit` / `git push`; a PostToolUse hook runs `vp fmt --write` on every edited `.ts` / `.js` / `.json` / `.md` / `.css` file.
- Every gate runs offline except `pnpm audit` (network). The Release workflow (OIDC, `release` environment) runs only in CI.

## Documentation surfaces

- `README.md` (root) — landing page.
- `packages/biblio/README.md` — the npm-facing API reference; its snippets are excerpts of the executed `@example`s, so update both together.
- `packages/biblio/CLAUDE.md` — the package's boundary, invariants and terms.
- `CONTRIBUTING.md` — human setup, CI expectations, individual checks.
- `PUBLISHING.md` — the release pipeline and one-time owner setup; `SECURITY.md` — reporting and the security posture.
- Decisions go in issue comments. No `docs/` tree (docgen output is gitignored).

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to... | Run |
| --- | --- |
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| understand a finding | `fallow explain <issue-type>` |
