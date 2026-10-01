#!/usr/bin/env bash
#
# Provision a checkout for non-interactive use (the Claude Code SessionStart hook).
#
# `~/.bashrc` returns early for non-interactive shells, so the line that puts the
# Vite+ toolchain on PATH never runs for an agent's tool calls or a git hook, and
# `node_modules/.bin` (where `fallow` and `tsx` live) is on nobody's PATH. This
# links them into `~/.local/bin` instead, since a symlink survives where an
# `export` cannot.
#
# Node: `~/.vite-plus/bin/node` is a shim that can fail with "Permission denied"
# when its root-owned runtime cache is stale, which breaks the pre-commit hook
# (`vp staged` shells out to bare `node`; gardeneria#1462). This repairs it only
# when `node --version` already fails, so a working shim is left alone.
#
# No secrets are hydrated; none are needed. Idempotent and never fatal: every
# failure logs and continues, because a SessionStart hook must not block a
# session. Reads only fixed paths; do not add input from repo content or
# issue/PR text.

set -uo pipefail

log() { printf '[session-start] %s\n' "$1" >&2; }

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOCAL_BIN="${HOME:-/home/vp}/.local/bin"

mkdir -p "$LOCAL_BIN" 2>/dev/null || log "cannot create $LOCAL_BIN; continuing"

# Link a binary into ~/.local/bin, replacing a stale link but never a real file.
link_tool() {
  src="$1"
  name="$(basename "$src")"
  dest="$LOCAL_BIN/$name"
  [ -x "$src" ] || return 0
  # Leave a real (non-symlink) binary alone: something deliberately installed it.
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    return 0
  fi
  ln -sfn "$src" "$dest" 2>/dev/null || log "could not link $name"
}

# `vp` gets a re-exec shim rather than a plain symlink. A symlink always
# resolves to $PROJECT_DIR's node_modules/vite-plus, even when invoked with
# cwd inside a `.claude/worktrees/*` checkout — so the CLI process loads the
# primary tree's vitest while the worktree's test modules resolve the
# worktree's own copy. Two physical instances of the same vitest version
# corrupt its module-level suite-collector state, and every describe() in the
# worktree throws `Cannot read properties of undefined (reading 'config')`
# (gardeneria#1663). The shim instead walks up from $PWD for the nearest project-local
# vite-plus and re-execs that, falling back to the primary checkout's when
# none is found above cwd.
VP_SHIM_MARKER="# generated-by: .claude/hooks/session-start.sh (vp re-exec shim, gardeneria issue #1663)"
VP_SHIM_MARKER_LEGACY="# generated-by: scripts/setup-dev-env.sh (vp re-exec shim, gardeneria issue #1663)"
write_vp_shim() {
  dest="$LOCAL_BIN/vp"
  # Leave a real, non-generated file alone: something deliberately installed
  # it. A stale symlink or a shim we generated earlier (under either home) is
  # fair game to regenerate — the embedded fallback path can change across
  # containers.
  if [ -e "$dest" ] && [ ! -L "$dest" ] \
    && ! grep -qF "$VP_SHIM_MARKER" "$dest" 2>/dev/null \
    && ! grep -qF "$VP_SHIM_MARKER_LEGACY" "$dest" 2>/dev/null; then
    return 0
  fi
  cat >"$dest.tmp" <<SHIM
#!/usr/bin/env bash
$VP_SHIM_MARKER
dir="\$PWD"
while [ -n "\$dir" ]; do
  if [ -x "\$dir/node_modules/vite-plus/bin/vp" ]; then
    exec "\$dir/node_modules/vite-plus/bin/vp" "\$@"
  fi
  [ "\$dir" = "/" ] && break
  dir="\$(dirname "\$dir")"
done
exec "$PROJECT_DIR/node_modules/vite-plus/bin/vp" "\$@"
SHIM
  chmod +x "$dest.tmp" 2>/dev/null && mv -f "$dest.tmp" "$dest" 2>/dev/null \
    || { rm -f "$dest.tmp" 2>/dev/null; log "could not write vp shim"; }
}

# ── 1. Repo binaries the documented workflows invoke directly ─────────────────
# AGENTS.md's fallow gate runs `fallow audit …` before every commit, and
# docgen runs examples under `tsx`. Both resolve only from
# node_modules/.bin. `vp` is included for the remote/web runner, where the
# global launcher does not exist.
for tool in tsx fallow; do
  link_tool "$PROJECT_DIR/node_modules/.bin/$tool"
done
write_vp_shim

# ── 2. Bare `node` (gardeneria#1462) ───────────────────────────────────────────────────
# Only repair a shim that is already failing — see the header for why this is
# conditional. `command -v node` is not enough: the shim exists and resolves,
# then dies on use, so the version call is the real test.
if ! node --version >/dev/null 2>&1; then
  VP_BIN_DIR="${VP_HOME:-${HOME:-/home/vp}/.vite-plus}/bin"
  # Newest cached runtime wins; `sort -V` so 24.9 does not beat 24.18.
  REAL_NODE="$(
    find "${VP_HOME:-${HOME:-/home/vp}/.vite-plus}/js_runtime/node" \
      -maxdepth 3 -type f -name node -perm -u+x 2>/dev/null | sort -V | tail -1
  )"
  if [ -n "$REAL_NODE" ]; then
    log "bare \`node\` is broken; pointing it at $REAL_NODE"
    # The shim lives in a vp-owned directory even though the runtime cache
    # beneath it is root-owned, so this needs no privileges.
    ln -sfn "$REAL_NODE" "$VP_BIN_DIR/node" 2>/dev/null \
      || link_tool "$REAL_NODE"
  else
    log "bare \`node\` is broken and no cached runtime was found; \`vp\`-routed commands still work"
  fi
fi

# ── 3. Dependencies ──────────────────────────────────────────────────────────
# Unconditional, not only when node_modules is absent: a prebaked container can
# carry a tree built from an OLDER lockfile, and stale dependencies masquerade
# as `main` breakage. `--frozen-lockfile` is a sub-second no-op when in sync.
if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  log "syncing dependencies against the lockfile…"
  (cd "$PROJECT_DIR" && vp install --frozen-lockfile >/dev/null 2>&1) \
    || (cd "$PROJECT_DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1) \
    || log "dependency install failed; continuing"
  # node_modules/.bin only exists after the install, so re-link what it provides.
  for tool in tsx fallow; do
    link_tool "$PROJECT_DIR/node_modules/.bin/$tool"
  done
  write_vp_shim
fi

exit 0
