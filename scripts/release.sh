#!/usr/bin/env bash
#
# Publish every workspace package under packages/* — the `publish-script` the
# Release workflow hands to changesets/action once the "Version Packages" PR
# has merged (see PUBLISHING.md).
#
# Two tools, deliberately: `pnpm pack` is what understands this workspace
# (it resolves the `catalog:` / `catalog:peers` / `workspace:` specifiers and
# applies each package's `publishConfig`), and `npm publish` of the resulting
# tarball is what carries npm OIDC trusted publishing (npm >= 11.5.1; the
# Release job pins one). pnpm 11's own `pnpm publish` could do the OIDC
# exchange too (pnpm/pnpm#9812 was pnpm-10-era); the npm CLI path is kept for
# now. `changeset tag` then emits the `New tag:` lines the action turns into
# pushed tags and GitHub releases.
#
# No `--provenance`: npm attaches provenance by itself under trusted publishing
# once the repository and the package are both public, and an explicit
# provenance request from a private repository makes the publish fail.
set -euo pipefail

out="$PWD/.release"
rm -rf "$out"
mkdir -p "$out"

for dir in packages/*/; do
  (cd "$dir" && pnpm pack --pack-destination "$out")
done

for tarball in "$out"/*.tgz; do
  npm publish "$tarball" --access public
done

changeset tag
