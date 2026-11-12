# Claude Code

Claude Code only: the hooks, plugins, worktrees and session limits of this repository. Everything that applies to any contributor or agent is imported below, from its one home, rather than copied here.

## Hooks (`.claude/settings.json`)

- **SessionStart** (`.claude/hooks/session-start.sh`) installs the global Vite+ CLI at the catalog's `vite-plus` pin with the official installer (npm-provenance and SHA-512 checked; the session's network must allow `vite.plus` and `viteplus.dev`), links `vp` and `vpx` into `~/.local/bin` (the CLI lives under `$VP_HOME` when set, as in the Vite+ container image, else `~/.local/share/vite-plus`), runs `vp install --frozen-lockfile`, and repairs a broken bare `node`. Nothing else goes on PATH: the global `vp` delegates to each checkout's own `vite-plus` (worktrees included, after their own `vp install`), fallow runs as `vp exec fallow …`, and TypeScript scripts as `vpx <file>.ts` (`tsx` is installed only because `@effect/docgen` spawns it). If the installer can't run, `vp` falls back to this checkout's `node_modules` copy. It hydrates no secrets; none are needed.
- **PreToolUse** (`.claude/hooks/fallow-gate.sh`) runs the fallow gate (through `vp exec fallow`) before `git commit` / `git push`, only in this checkout and its `.claude/worktrees/*`: from any other tree it runs none of that tree's tooling and skips the audit with a notice.
- **PostToolUse** runs `vp fmt --write` on every edited `.ts` / `.js` / `.json` / `.md` / `.css` file.

## Plugins

`.claude/settings.json` enables `typescript-lsp`, `code-review`, `github`, `claude-md-management`, `commit-commands`, `pr-review-toolkit` and `code-simplifier` (all `@claude-plugins-official`).

## Worktrees

Agent work uses git worktrees under `.claude/worktrees/` (gitignored), one per branch; start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing. Run `vp install` in a new worktree before its first gate.

## What a session can't run

Every gate runs offline except `pnpm audit` (network). The Release workflow (OIDC, `release` environment) runs only in CI; never publish or version from a session.

## Keeping this file Claude-only

General guidance goes in `AGENTS.md`, `CONTRIBUTING.md` or `README.md` and reaches this file through the imports below; a package's general guidance goes in its own `AGENTS.md`, which its `CLAUDE.md` imports. `fallow init` (and fallow's agent setup) offers to append its gate section, or an `@AGENTS.md` line, to a `CLAUDE.md`: decline it, since the gate section already lives in `AGENTS.md` and is imported here.

@../AGENTS.md @../CONTRIBUTING.md @../README.md
