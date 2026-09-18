#!/usr/bin/env bash
#
# Publish every workspace package under packages/* — the `publish-script` the
# Release workflow hands to changesets/action once the "Version Packages" PR
# has merged (see PUBLISHING.md).
#
# Two tools, deliberately: `pnpm pack` is what understands this workspace
# (it resolves the `catalog:` / `catalog:peers` / `workspace:` specifiers and
# applies each package's `publishConfig`), and `npm publish` of the resulting
# tarball is what carries npm OIDC trusted publishing + provenance — pnpm does
# not support OIDC trusted publishing yet (pnpm/pnpm#9812). `changeset tag`
# then emits the `New tag:` lines the action turns into pushed tags and
# GitHub releases.
set -euo pipefail

out="$PWD/.release"
rm -rf "$out"
mkdir -p "$out"

for dir in packages/*/; do
  (cd "$dir" && pnpm pack --pack-destination "$out")
done

for tarball in "$out"/*.tgz; do
  npm publish "$tarball" --access public --provenance
done

changeset tag
