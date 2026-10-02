# AGENTS.md

`CLAUDE.md` is a symlink to this file. This repo publishes `@thomasfosterau/biblio` (`packages/biblio`), extracted with its history from `thomasfosterau/website`. The website, gardeneria and preferenceflow apps consume it, and their toolchain (pnpm + Vite+ `vp`, strict catalog, TypeScript 6/7 split, Effect oxlint preset, fallow) is copied here so the library builds against what they run. An unprefixed `#NNN` in a ported comment is a website issue, the evidence behind a decision, not a ticket in this tracker.

## Common pitfalls

- **Package-local rules live in [`packages/biblio/CLAUDE.md`](packages/biblio/CLAUDE.md)**: the `BiblioRecord` wire contract, the browser-safe root entry and its forbidden-module list, total decoders, the plain-nullable seams (and why `effect/prefer-option-over-null` stays at `error`), the doc-comment rules (`@since`, `@example`, hover summaries). Read it before touching `packages/biblio`.
- **This package emits declarations; the application never did.** `tests/dist-consumer` type-checks a consumer fixture against the emitted `dist/` declarations with `Equals<…>` assertions on the brands and the service shape (a brand that emits as `string`, or a service that emits as `any`, fails there rather than in an application). `vp run check` runs it, but only against a `dist/` you have already built: it doesn't build one and silently checks `src/` without it (#22); see Verification.
- **No application vocabulary.** No WEMI / spine mapping, no `owner_id`, no database rows, no ingest operations, no app paths in doc comments. Those stay in the apps; the package stops at the CSL record.
- **Every external version lives in `pnpm-workspace.yaml`'s catalog** (`catalogMode: strict`; manifests carry only `catalog:`, `catalog:peers` or `workspace:*`). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **`@effect/tsgo`, `@typescript/native` and `vite-plus` bump together.** `prepare` (`effect-tsgo patch`) overwrites the native `tsc` and `oxlint` and fails `pnpm install` with `UnsupportedTargetPackageVersionError` on an unsupported pairing; read the comment on `@effect/tsgo` in `pnpm-workspace.yaml` first.
- **Declare peers explicitly.** A required peer of a dependency must be a declared dependency, or CI fails on a fresh runner while a warm local tree passes.

## Conventions

- Optional members are `?: T | undefined`, never bare `?: T` (`exactOptionalPropertyTypes`).
- Relative imports carry their `.ts` extension (`rewriteRelativeImportExtensions`).
- Tests import from `vite-plus/test`, never `vitest` (lint-enforced by `vite-plus/prefer-vite-plus-imports`).

## Commands

- `vp install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: `vp check --fix` on staged files). No pre-push hook.
- `vp check` — format + lint (Oxfmt + Oxlint). `vp run check` — the type gate: the package's `check` (sources, tests and the type-level `tests/**/*.types.ts`) plus the dist-consumer declaration check, which reads `packages/biblio/dist` only once it is built (#22; build first). They are different commands.
- `vp run -r test:unit` — unit tests (the lookup sources run against a stubbed `FetchHttpClient`, never the network).
- `vp run -r build` — emit `dist/`.
- `vp run -r docgen` — compile and execute every JSDoc `@example` (output under `packages/*/docs/`, gitignored).
- `pnpm changeset` — add a changeset.

Invoke everything else through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations are `pnpm install`, `pnpm changeset` and the release path (`pnpm run version` / `pnpm run release`, run by the Release workflow). Individual checks are listed in [CONTRIBUTING.md](CONTRIBUTING.md#running-individual-checks).

## Verification

Before you report work as done, run the gates below in order (CI's order, `.github/workflows/ci.yml`) and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. `vp check`
2. `vp run check`
3. `vp run -r test:unit`
4. `vp run -r build`
5. `vp run -r docgen`
6. `pnpm audit --audit-level high` (network)
7. `fallow audit --format json --quiet --explain --gate-marker agent` (the fallow gate below; not a CI step)

- **Build first when verifying locally.** Neither `vp run check` nor `vp run -r test:unit` builds `dist/` (#22): without it, the dist-consumer check silently resolves `src/`, and the built-artifact cases in `packages/biblio/tests/entry-points.test.ts` skip. Run `vp run -r build` before steps 2 and 3, and treat a skip there as not run.
- **Before pushing, reinstall from clean** to catch a missing peer a warm tree hides: `rm -rf node_modules packages/*/node_modules tests/*/node_modules && pnpm install --frozen-lockfile`, then the gates.

## Branches and pull requests

- Branch off `main`; PR against `main`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Name branches `issue-<n>-<slug>`. Rebase onto `origin/main` before opening or updating a PR; never merge `main` into your branch (GitHub's Update-branch button merges).
- Agent work uses git worktrees under `.claude/worktrees/`, one per branch; start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing.
- Every change to a published package's behaviour carries a changeset (`pnpm changeset`). Changes to doc comments that reach the emitted `.d.ts` (TSDoc) take a `patch` changeset; other docs-only changes (READMEs, guidance), CI and tooling need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. See [PUBLISHING.md](PUBLISHING.md).
- These are standing approvals: **always open a PR** once a branch has a pushed commit; **watch it to merge or close** (investigate CI failures and review comments, rebase when it goes conflicting); **keep the PR body current** as the implementation diverges. Fill [`.github/pull_request_template.md`](.github/pull_request_template.md).
- GitHub writes go to `thomasfosterau/reference-manager` only; pass `-R thomasfosterau/reference-manager` whenever the cwd might be another checkout. Never write to the consuming applications' repositories without the owner's explicit approval for that action in the current session. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available.

## Work tracker

- Issues are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. There is no in-repo backlog file.
- The issue is the spec — read its comments; later comments override the body. Re-verify its code claims against current `main` before editing.
- Record decisions and findings as issue comments.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.
- Adoption by each application is tracked in that application's own tracker (website#2021 for biblio), blocked on a release of this package.

## Effect

Consult effect-solutions before writing Effect code (`vp exec effect-solutions list`, then `vp exec effect-solutions show <topic>…`: data-modeling, services-and-layers, error-handling, testing, basics); never guess at an Effect pattern. The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog. On rc.118 the former `effect/unstable/*` modules are `effect/*` (`effect/http`, not `effect/unstable/http`), and a schema-backed error is `Schema.TaggedError<Self>()(tag, fields)` (older guides say `Schema.TaggedErrorClass`, which does not exist in rc.x). When the guides run out, read `node_modules/effect/dist/*.d.ts`.

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
