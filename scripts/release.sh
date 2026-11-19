#!/usr/bin/env bash
#
# Packs every package under packages/* (`pnpm pack` resolves `catalog:` /
# `workspace:` and `publishConfig`) and publishes the tarballs with npm, which
# performs the OIDC exchange. Skips versions already on npm. No `--provenance`:
# an explicit request fails from a private repository.
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
  # No lifecycle scripts in the id-token job; `pnpm pack` has no
  # `--ignore-scripts` flag.
  (cd "$dir" && pnpm pack --config.ignore-scripts=true --pack-destination "$out")
done

# `nullglob`: nothing packed (everything already published) publishes nothing.
shopt -s nullglob
for tarball in "$out"/*.tgz; do
  # A tarball spec runs no lifecycle scripts under `npm publish`.
  npm publish "$tarball" --access public
done

changeset tag
