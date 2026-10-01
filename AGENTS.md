# AGENTS.md

Project conventions live here; personal style preferences live in user memory. `CLAUDE.md` is a symlink to this file.

`reference-manager` is the home of `@thomasfosterau/biblio`, the bibliographic toolkit extracted from the `thomasfosterau/website` application's `packages/biblio` with its git history, and of whatever reference-management packages follow it (the monorepo shape is there from day one). The website, gardeneria and preferenceflow applications are the consumers, and their toolchain — pnpm + Vite+ (`vp`), a strict catalog, the TypeScript 6/7 split, the Effect oxlint preset, fallow — is copied here so the library builds against exactly what they run. A `#NNN` citation inside a ported comment names an issue in the app it was ported from (website unless stated), the evidence behind a decision, not a ticket in this tracker.

## Common pitfalls

- **`BiblioRecord` is wire-identical to what website persists.** Any change to a field name, a key's optionality, an identifier slot's brand or the `provenance` / `extra` shape is a **major**. `fromCslJson` must keep decoding every row website ever wrote.
- **The root entry never imports an `effect/http`-style module (the former `effect/unstable/*`).** `.` is the browser-safe half; the HttpClient-backed lookups live behind `./sources` only. `packages/biblio/tests/entry-points.test.ts` walks the real import graph and loads the built root entry with those modules unresolvable; a type-only import breaks it too.
- **This package emits declarations; the application never did.** `tests/dist-consumer` type-checks a consumer fixture against the emitted `dist/` declarations with `Equals<…>` assertions on the brands and the service shape (a brand that emits as `string`, or a service that emits as `any`, fails there rather than in an application); `vp run check` includes it.
- **Every export carries `@since`, and `vp run docgen` executes every `@example`.** A wrong expected value in an example is a red gate, not a stale comment.
- **No application vocabulary.** No WEMI / spine mapping, no `owner_id`, no database rows, no ingest operations. Those stay in the apps; the package stops at the CSL record.

Everything else that must be visible when touching the package is in `packages/biblio/CLAUDE.md`, which carries its terms, invariants and import boundary.

## Work tracker

- **Active work** lives in GitHub Issues for `thomasfosterau/reference-manager`. Longer-running tech debt is an issue too; there is no in-repo backlog file and a code comment is not a tracker.
- **Decisions and findings** are recorded as comments on the issue they were found working; later comments override the body.
- **Adoption** by each application is tracked in that application's own tracker (website#2021 for biblio), blocked on a release of this package.

## Commands

- `vp install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: format + lint on staged files). No pre-push hook: run the tests yourself.
- `vp check` — the built-in format + lint pass (`vp fmt --check` + `vp lint`).
- `vp run check` — the type gate: the package's `check` (sources, tests and the type-level `tests/**/*.types.ts`) plus the dist-consumer declaration check (which builds `dist/` and asserts the emitted types). Distinct from `vp check`.
- `vp run -r test:unit` — unit tests (pure code; the lookup sources run against a stubbed `FetchHttpClient`, never the network).
- `vp run -r build` — emit `dist/`.
- `vp run -r docgen` — compile and execute every JSDoc `@example` (output under `packages/*/docs/`, gitignored).
- `pnpm changeset` — add a changeset; every change to a published package needs one. Releases are cut by the `Release` workflow (changesets/action, OIDC trusted publishing) on `main` — see PUBLISHING.md.

Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). CI installs as `pnpm install --frozen-lockfile`.

## Branch model

`main` plus short-lived feature branches, PR against `main`, squash-merge. Rebase onto `origin/main` before opening a PR; never merge `main` into a feature branch. Agent work uses git worktrees under `.claude/worktrees/`, one per branch; start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing.

## Working a dispatched issue

- The issue is the spec: read all of it, including comments.
- Re-verify the code claims against current `main` before editing.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- No silent deferrals: scope cut mid-PR becomes a linked issue before merge.

## PR management

These are standing instructions and approvals; they override any default "don't open a PR unless asked" behaviour.

- **Always open a PR** for branch work, against `main`, once a commit is pushed.
- **Always watch the PR to merge or close**: investigate CI failures and review comments as they arrive; rebase promptly when the PR goes conflicting.
- **Always keep the PR body current** as the implementation diverges from it.
- **GitHub writes are scoped to `thomasfosterau/reference-manager` only.** Never write to the consuming applications' repositories or any other repository without the owner's explicit approval for that action in the current session. Pass `-R thomasfosterau/reference-manager` explicitly whenever the cwd might not be this checkout.

## Verification

- Claims of verification name the command and its final status.
- The pre-push parity run is: `rm -rf node_modules packages/*/node_modules tests/*/node_modules && pnpm install --frozen-lockfile`, then `vp check`, `vp run check`, `vp run -r test:unit`, `vp run -r build`, `vp run -r docgen`.
- Peers are declared explicitly: a required peer of a dependency must be a declared dependency or CI fails on a fresh runner while a warm local tree passes.

## Effect best practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code: `vp exec effect-solutions list`, then `vp exec effect-solutions show <topic>...` (data-modeling, services-and-layers, error-handling, testing, basics). Never guess at Effect patterns.

## Documentation surfaces

`README.md` at the root is the landing page; each package `README.md` is the API reference consumers read on npm (its snippets are the executed `@example`s); each package `CLAUDE.md` carries its terms, invariants and boundary; `CONTRIBUTING.md` carries the pre-PR checklist; `PUBLISHING.md` and `SECURITY.md` carry the release pipeline and its rationale. No `docs/` tree (the generated docgen output is gitignored); decisions go in issue comments.

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
