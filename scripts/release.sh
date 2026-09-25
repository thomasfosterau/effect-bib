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
#
# Idempotent: a package already published at its current version is skipped
# (as in effect-email's release.sh), so a partial run can be re-run and a
# version bootstrapped by hand does not fail the automated run. Every tarball
# is packed before the first publish, so a pack failure publishes nothing.
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
