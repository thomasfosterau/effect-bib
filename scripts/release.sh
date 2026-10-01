#!/usr/bin/env bash
#
# Publish every workspace package under packages/* — the `publish-script` the
# Release workflow hands to changesets/action once the "Version Packages" PR
# has merged (see PUBLISHING.md).
#
# `pnpm pack` resolves the workspace's `catalog:` / `workspace:` specifiers and
# `publishConfig`; `npm publish` of the tarball performs the OIDC exchange (the
# Release job pins npm). No `--provenance`: an explicit request fails the
# publish from a private repository. Idempotent: a package already on npm at
# its current version is skipped, and every tarball is packed before the first
# publish, so a pack failure publishes nothing. See PUBLISHING.md.
set -euo pipefail

out="$PWD/.release"
rm -rf "$out"
mkdir -p "$out"

for dir in packages/*/; do
  name="$(node -p "require('./${dir}package.json').name")"
  version="$(node -p "require('./${dir}package.json').version")"
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip: $name@$version is already published"
    continue
  fi
  echo "pack: $name@$version"
  # `--config.ignore-scripts=true`: no `prepack` / `prepare` / `postpack` runs
  # in the id-token job (none is defined today). `pnpm pack` has no
  # `--ignore-scripts` flag (pnpm 11 rejects it as an unknown option), so the
  # setting is passed as config; the tarball is byte-identical either way.
  (cd "$dir" && pnpm pack --config.ignore-scripts=true --pack-destination "$out")
done

# `nullglob`: nothing packed (everything already published) publishes nothing.
shopt -s nullglob
for tarball in "$out"/*.tgz; do
  # A tarball spec runs no lifecycle scripts under `npm publish`.
  npm publish "$tarball" --access public
done

changeset tag
