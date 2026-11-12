# AGENTS.md

Guidance for coding agents working in this repository. What the project is, and who consumes it, is in [README.md](README.md); setup, the commands, the branch model and changesets are in [CONTRIBUTING.md](CONTRIBUTING.md), which this file does not repeat. The package's own boundary, invariants and terms are in [`packages/effect-bib/AGENTS.md`](packages/effect-bib/AGENTS.md). Claude Code also loads [`.claude/CLAUDE.md`](.claude/CLAUDE.md) (its hooks and session notes), which imports this file.

A `<repo>#NNN` cite in a comment (`website#NNN`, `gardeneria#NNN`) is an issue in that repository, the evidence behind a decision, not a ticket in this tracker; a bare `#NNN` is an issue or PR in this repository.

## Common pitfalls

- **The Effect lint preset has no allowances left.** `@enfect/oxlint` (`effect.configs.recommended`, the `effect/*` rules) and `@effect/tsgo`'s `recommended` run at their own levels in `vite.config.ts`: every `effect/*` rule is at `error` (#137), `prefer-namespace-imports` included (#167). The file-scoped overrides left (bare-Node configs and fixtures, the type-level `*.types.ts` tests, the `tests/dist-consumer` fixture that stands in for an application's entry point) are can't-applies, each with its reason beside it. A finding is fixed in code, not suppressed: `prefer-option-over-null` has no exception left (#168); the one per-site exception, `no-unknown-parameters` on the public total decoders, is listed in the package AGENTS.md (#169 tracks it), and a new one needs the same written contract.
- **Package-local rules live in [`packages/effect-bib/AGENTS.md`](packages/effect-bib/AGENTS.md)**: the `BiblioRecord` wire contract, the browser-safe root entry and its forbidden-module list, total decoders, `Option` for every absent value, the doc-comment rules (`@since`, `@example`, hover summaries). Read it before touching `packages/effect-bib`.
- **This package emits declarations; the application never did.** `tests/dist-consumer` type-checks a consumer fixture against the emitted `dist/` declarations with `Equals<…>` assertions on the brands and the service shape (a brand that emits as `string`, or a service that emits as `any`, fails there rather than in an application). `vp run check` builds `dist/` first (the check depends on `@thomasfosterau/effect-bib#build`) and fails outright if the entry declarations are missing, rather than falling back to `src/` (#22).
- **No application vocabulary.** No WEMI / spine mapping, no `owner_id`, no database rows, no ingest operations, no app paths in doc comments. Those stay in the apps; the package stops at the CSL record.
- **Every external version lives in `pnpm-workspace.yaml`'s catalog** (`catalogMode: strict`; manifests carry only `catalog:`, `catalog:peers` or `workspace:*`). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **`@effect/tsgo`, `@typescript/native` and `vite-plus` bump together.** `prepare` (`effect-tsgo patch`) overwrites the native `tsc` and `oxlint` and fails `pnpm install` with `UnsupportedTargetPackageVersionError` on an unsupported pairing; read the comment on `@effect/tsgo` in `pnpm-workspace.yaml` first. Dependabot opens the set (`vite-plus`, `vitest`, `@vitest/*`, `@effect/tsgo`) as one `toolchain` group PR (`.github/dependabot.yml`, whose only other group is `effect`, `@effect/*` with `@effect/docgen`; every other dependency, `@enfect/oxlint` and each GitHub Action included, gets its own PR); merge it only once its `pnpm install` and gates pass, and never split it. By hand, on that PR's branch, because Dependabot cannot: the npm-alias entries (`vite`, always equal to `vite-plus`; `typescript`; `@typescript/native`), `vitest` / `@vitest/coverage-istanbul` to vite-plus's pin, and an `@effect/tsgo` that supports the new oxlint. The `undici` security floor under `overrides` and the published `effect` peer range (`catalogs.peers`) are hand moves too (the peer range with a changeset). That range is `^4.0.0`; raise it only when a dependency requires a newer `effect`, naming the dependency in the catalog comment. `minimumReleaseAge` holds a new version for 8 hours (480 minutes); Dependabot's `cooldown` is 1 day, its smallest unit.
- **Declare peers explicitly.** A required peer of a dependency must be a declared dependency, or CI fails on a fresh runner while a warm local tree passes.

## Conventions

- Effect tests use `@effect/vitest` (`it.effect`, `it.live` for real-clock timing, `layer(...)` for a layer shared by several tests), with `expect` and `describe` from `vite-plus/test`; a per-test stub layer goes through `withLayer` in `tests/sources/stub-http.ts`, and `vitest/no-standalone-expect` lists the `@effect/vitest` block names (#190).
- A value that can be absent is an `Option`, never `T | null` or `T | undefined` (`effect/prefer-option-over-null`, at `error` with no exceptions, #168). Optional members are spelled:
  - an optional Option-valued property: `x?: Option.Option<T>` (no `| undefined`);
  - an options-object member: `readonly x?: T` (no `| undefined`, no `Option`; under `exactOptionalPropertyTypes` a caller holding `undefined` omits the key);
  - an optional function parameter: `x?: T`;
  - a wire-shape schema (a JSON document, `BiblioRecord`) keeps its native optional keys.

  A type-level test asserts an optional slot with `OptionalSlot<T, K, V>` (key optional, present value exactly `V`), not `Equals<T[K], V | undefined>`.

- Effect modules are namespace imports: `import * as Option from "effect/Option"`, under the module's full name, except the six with a canonical alias (`effect/prefer-namespace-imports`, #167): `Arr` (`effect/Array`), `P` (`effect/Predicate`), `R` (`effect/Record`), `Str` (`effect/String`), `Eq` (`effect/Equal`) and `Bool` (`effect/Boolean`). The aliases leave the global `Array`, `Record` and `String` unshadowed, so the dictionary rules see a bare `Record<string, unknown>`: name it from its owner (a `Schema.Record`'s `.Type`, `NonNullable<BiblioRecord["extra"]>`) instead.
- Relative imports carry their `.ts` extension (`rewriteRelativeImportExtensions`).
- Tests import from `vite-plus/test`, never `vitest` (lint-enforced by `vite-plus/prefer-vite-plus-imports`).

- Invoke tooling through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`); the sanctioned exceptions are listed in [CONTRIBUTING.md](CONTRIBUTING.md#commands).

## Verification

Before you report work as done, run the gates below in order (CI's order, `.github/workflows/ci.yml`) and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. `vp check`
2. `vp run -r build`
3. `vp run check`
4. `vp run -r test:coverage`
5. `vp run -r docgen`
6. `pnpm audit --audit-level high` (network)
7. `vp exec fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` (the fallow gate below; not a CI step). It reads the Istanbul map `packages/effect-bib/coverage/coverage-final.json` that step 4 writes (`health.coverage` in `.fallowrc.json`), so run it after `test:coverage`; without the map fallow scores every function as uncovered.

- **`dist/` is built by the gates that read it.** `vp run check` and `vp run -r test:coverage` (like `test:unit`) each depend on `build` (#22), so on a clean tree they emit `dist/` before the dist-consumer check and the built-artifact cases in `packages/effect-bib/tests/entry-points.test.ts` run. Those cases still skip under a bare `vp test` without `dist/`, except under `CI`, where they fail instead; a skip there is not a run.
- **Before pushing, reinstall from clean** to catch a missing peer a warm tree hides: `rm -rf node_modules packages/*/node_modules tests/*/node_modules && pnpm install --frozen-lockfile`, then the gates.

## Pull requests

The branch model, conventional prefixes and changeset rules are in [CONTRIBUTING.md](CONTRIBUTING.md#branches-pull-requests-and-changesets). On top of them:

- These are standing approvals: **always open a PR** once a branch has a pushed commit; **watch it to merge or close** (investigate CI failures and review comments, rebase when it goes conflicting); **keep the PR body current** as the implementation diverges. Fill [`.github/pull_request_template.md`](.github/pull_request_template.md).
- GitHub writes go to `thomasfosterau/effect-bib` only; pass `-R thomasfosterau/effect-bib` whenever the cwd might be another checkout. Never write to the consuming applications' repositories without the owner's explicit approval for that action in the current session. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available.

## Work tracker

- Issues are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. There is no in-repo backlog file.
- The issue is the spec — read its comments; later comments override the body. Re-verify its code claims against current `trunk` before editing.
- Record decisions and findings as issue comments.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.
- Adoption by each application is tracked in that application's own tracker (website#2021 for effect-bib), blocked on a release of this package.

## Effect

Read the installed package before writing Effect code, and never guess at an Effect API: `node_modules/effect/dist/*.d.ts` (signatures and their doc comments), `node_modules/effect/src` (implementations), and `node_modules/effect/AGENTS.md` plus the `ai-docs/` it links, which the pinned version ships. The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog. On rc.118 and later the former `effect/unstable/*` modules are `effect/*` (`effect/http`, not `effect/unstable/http`), and a schema-backed error is `Schema.TaggedError<Self>()(tag, fields)` (older guides say `Schema.TaggedErrorClass`, which does not exist in rc.x).

## Documentation surfaces

- `README.md` (root) — landing page and project overview, kept short (what it is, install, one example, a packages table, links).
- `packages/effect-bib/README.md` — the npm-facing page, short by the owner's rule (#178): what it is, install, one minimal example, a table of entry points, and links, every link absolute (it is published to npm). No API detail: that goes in per-export doc comments (docgen), and longer how-tos in `docs/*.md`. Its example is an excerpt of an executed `@example` (`renderReference` in `src/render/render.ts`), so update both together.
- `docs/*.md` — the long-form guides (records and identifiers, parsing and writing, rendering and citations, dedup, lookup, compatibility and scope). Their snippets are copied from executed `@example`s where possible; a snippet that is only illustrative says so. This root `docs/` is committed; the docgen output under `packages/*/docs/` is a different, gitignored directory.
- `packages/effect-bib/AGENTS.md` — the package's boundary, invariants and terms (`packages/effect-bib/CLAUDE.md` imports it).
- `CONTRIBUTING.md` — setup, commands, the branch and changeset procedure, CI expectations, individual checks.
- `AGENTS.md` (this file) — guidance for any coding agent; `.claude/CLAUDE.md` — Claude Code only (hooks, plugins, worktrees, session limits), importing this file, `CONTRIBUTING.md` and `README.md`.
- `PUBLISHING.md` — the release pipeline and one-time owner setup; `SECURITY.md` — reporting and the security posture.
- Decisions go in issue comments.

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
