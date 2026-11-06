#!/usr/bin/env bash
#
# Provision a checkout for non-interactive use (the Claude Code SessionStart hook).
#
# ## Vite+ first
#
# Vite+ (`vp`) is the one tool this script guarantees; everything else is
# reached through it. The global CLI is installed at exactly the `vite-plus`
# version pinned in `pnpm-workspace.yaml`'s catalog, using the official
# installer, which takes the release from the npm registry, refuses a package
# without npm provenance and checks its SHA-512 `dist.integrity`. It installs
# under `~/.local/share/vite-plus` and touches no shell profile, so `vp` and
# `vpx` are then linked into `~/.local/bin`, which is on PATH in the session
# container (an `export` here cannot reach the caller's later shells; a
# symlink to the real binary can).
#
# From there:
#
# - `vp install --frozen-lockfile` installs the dependencies.
# - The global `vp` delegates development commands to the project-local
#   `vite-plus`, including inside `.claude/worktrees/*`, so each checkout runs
#   its own pinned toolchain without a shim.
# - Project tools run through Vite+: `vp exec fallow …` for fallow (the commit
#   gate does the same), `vpx <file>.ts` for TypeScript scripts. Nothing else
#   is put on PATH: no shim walks a directory tree, and nothing runs a
#   `node_modules/.bin` the session did not install.
#
# Earlier versions of this hook symlinked or shimmed `fallow`, `tsx` and `vp`
# into `~/.local/bin` (`vp` as a re-exec shim that walked up from `$PWD`);
# those are removed or replaced when found (only ones this hook made: a
# symlink into a `node_modules`, or a file carrying the
# `# generated-by: .claude/hooks/session-start.sh` marker or the older
# `# generated-by: scripts/setup-dev-env.sh` one).
#
# If the installer cannot run (no network to vite.plus / viteplus.dev, or the
# catalog pin cannot be read), `vp` falls back to a one-line re-exec of this
# project's own `node_modules/vite-plus/bin/vp`, and the hook says so.
#
# ## Node
#
# `~/.vite-plus/bin/node` is a shim that can fail with "Permission denied"
# when its root-owned runtime cache is stale, which breaks the pre-commit hook
# (`vp staged` shells out to bare `node`; gardeneria#1462). This repairs it only
# when `node --version` already fails, so a working shim is left alone.
#
# ## Secrets and contract
#
# No secrets are hydrated; none are needed. Idempotent and never fatal: every
# failure logs and continues, because a SessionStart hook must not block a
# session. The only value read from the repository is the `vite-plus` catalog
# version, used only when it is a plain `MAJOR.MINOR.PATCH`; every other path
# is fixed. Do not add other input from repo content or issue/PR text.

set -uo pipefail

log() { printf '[session-start] %s\n' "$1" >&2; }

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOCAL_BIN="${HOME:-/home/vp}/.local/bin"
VP_GLOBAL_BIN="${HOME:-/home/vp}/.local/share/vite-plus/bin"
SHIM_MARKER="# generated-by: .claude/hooks/session-start.sh"
SHIM_MARKER_LEGACY="# generated-by: scripts/setup-dev-env.sh"

mkdir -p "$LOCAL_BIN" 2>/dev/null || log "cannot create $LOCAL_BIN; continuing"

# True when $1 is a file this hook (or its predecessor, scripts/setup-dev-env.sh)
# generated: the current marker is a prefix of the old vp re-exec shim's.
made_here() {
  grep -qF "$SHIM_MARKER" "$1" 2>/dev/null \
    || grep -qF "$SHIM_MARKER_LEGACY" "$1" 2>/dev/null
}

# Replace $dest with a symlink to $src unless $dest is a real file this hook
# did not make (something deliberately installed it).
link_to() {
  src="$1"
  dest="$2"
  if [ -e "$dest" ] && [ ! -L "$dest" ] && ! made_here "$dest"; then
    return 0
  fi
  ln -sfn "$src" "$dest" 2>/dev/null || log "could not link $(basename "$dest")"
}

# Remove a PATH entry an earlier version of this hook created.
remove_old_link() {
  dest="$LOCAL_BIN/$1"
  if [ -L "$dest" ]; then
    case "$(readlink "$dest")" in
      */node_modules/*) rm -f "$dest" 2>/dev/null && log "removed old $1 link" ;;
    esac
  elif [ -f "$dest" ] && made_here "$dest"; then
    rm -f "$dest" 2>/dev/null && log "removed old $1 shim"
  fi
}

# ── 1. Vite+ at the catalog pin ──────────────────────────────────────────────
VP_PIN="$(sed -nE 's/^  vite-plus: "?([0-9]+\.[0-9]+\.[0-9]+)"?$/\1/p' "$PROJECT_DIR/pnpm-workspace.yaml" 2>/dev/null | head -1)"
VP_HAVE="$("$VP_GLOBAL_BIN/vp" --version 2>/dev/null | sed -nE '1s/^vp v([0-9.]+).*$/\1/p')"
if [ -z "$VP_PIN" ]; then
  log "could not read the vite-plus catalog pin; not installing Vite+"
elif [ "$VP_HAVE" != "$VP_PIN" ]; then
  log "installing Vite+ $VP_PIN (have: ${VP_HAVE:-none})…"
  if command -v curl >/dev/null 2>&1 \
    && curl -fsSL https://vite.plus | VP_VERSION="$VP_PIN" bash >/dev/null 2>&1; then
    log "Vite+ $VP_PIN installed"
  else
    log "Vite+ installer failed (is vite.plus / viteplus.dev reachable?); continuing"
  fi
fi

remove_old_link fallow
remove_old_link tsx
if [ -x "$VP_GLOBAL_BIN/vp" ]; then
  link_to "$VP_GLOBAL_BIN/vp" "$LOCAL_BIN/vp"
  link_to "$VP_GLOBAL_BIN/vpx" "$LOCAL_BIN/vpx"
else
  # Fallback: the project's own pinned copy, by its fixed path.
  log "global Vite+ unavailable; \`vp\` runs $PROJECT_DIR's node_modules copy"
  for name in vp vpx; do
    dest="$LOCAL_BIN/$name"
    if [ -e "$dest" ] && [ ! -L "$dest" ] && ! made_here "$dest"; then
      continue
    fi
    target="$PROJECT_DIR/node_modules/vite-plus/bin/$name"
    [ "$name" = vpx ] && target="$PROJECT_DIR/node_modules/.bin/vpx"
    printf '#!/usr/bin/env bash\n%s (%s fallback)\nexec "%s" "$@"\n' \
      "$SHIM_MARKER" "$name" "$target" >"$dest.tmp" \
      && chmod +x "$dest.tmp" && mv -f "$dest.tmp" "$dest" \
      || { rm -f "$dest.tmp" 2>/dev/null; log "could not write the $name fallback"; }
  done
fi

# ── 2. Bare `node` (gardeneria #1462) ─────────────────────────────────────────
# Only repair a shim that is already failing. `command -v node` is not enough:
# the shim exists and resolves, then dies on use, so the version call is the
# real test.
if ! node --version >/dev/null 2>&1; then
  OLD_VP_HOME="${VP_HOME:-${HOME:-/home/vp}/.vite-plus}"
  # Newest cached runtime wins; `sort -V` so 24.9 does not beat 24.18.
  REAL_NODE="$(
    find "$OLD_VP_HOME/js_runtime/node" "${HOME:-/home/vp}/.local/share/vite-plus" \
      -maxdepth 4 -type f -name node -perm -u+x 2>/dev/null | sort -V | tail -1
  )"
  if [ -n "$REAL_NODE" ]; then
    log "bare \`node\` is broken; pointing it at $REAL_NODE"
    if [ -d "$OLD_VP_HOME/bin" ]; then
      ln -sfn "$REAL_NODE" "$OLD_VP_HOME/bin/node" 2>/dev/null \
        || link_to "$REAL_NODE" "$LOCAL_BIN/node"
    else
      link_to "$REAL_NODE" "$LOCAL_BIN/node"
    fi
  else
    log "bare \`node\` is broken and no cached runtime was found; \`vp\`-routed commands still work"
  fi
fi

# ── 3. Dependencies ──────────────────────────────────────────────────────────
# Unconditional, not only when node_modules is absent: a prebaked container can
# carry a tree built from an OLDER lockfile. `--frozen-lockfile` is a
# sub-second no-op when in sync. `vp install` uses the `packageManager` pin.
if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  log "syncing dependencies against the lockfile…"
  # The fallback `vp` points into node_modules, which may not exist yet, so
  # only the global CLI installs; without it, pnpm does. No stdin and
  # CI=true: pnpm must never stop at a prompt here (it asks before replacing
  # a modules directory another pnpm version laid out).
  if [ -x "$VP_GLOBAL_BIN/vp" ]; then
    (cd "$PROJECT_DIR" && CI=true "$VP_GLOBAL_BIN/vp" install --frozen-lockfile </dev/null >/dev/null 2>&1) \
      || log "dependency install failed; continuing"
  elif command -v corepack >/dev/null 2>&1; then
    (cd "$PROJECT_DIR" && CI=true corepack pnpm install --frozen-lockfile </dev/null >/dev/null 2>&1) \
      || log "dependency install failed; continuing"
  else
    (cd "$PROJECT_DIR" && CI=true pnpm install --frozen-lockfile </dev/null >/dev/null 2>&1) \
      || log "dependency install failed; continuing"
  fi
fi

exit 0
