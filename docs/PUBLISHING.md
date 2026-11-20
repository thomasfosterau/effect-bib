# Publishing

Releases use [Changesets](https://github.com/changesets/changesets) and npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) through `vp pm publish` (pnpm); there is no `NPM_TOKEN`, no npm CLI and no publish script.

## Flow

1. Commit a changeset (`vp exec changeset`) with each change to the published package.
2. On `trunk`, the [Release workflow](../.github/workflows/release.yml) opens or updates the "chore: version packages" PR (`pnpm run version`: `changeset version`, then `vp fmt`, since `.changeset/config.json` sets `"format": false`, then a lockfile refresh).
3. Merging that PR runs the `publish` job after manual approval: `vp run release` builds, publishes each package whose version isn't on npm yet with `vp pm publish -r --access public --no-git-checks -- --ignore-scripts` (pnpm resolves `catalog:` / `workspace:` and `publishConfig`, and skips what is already published), then `changeset git-tag` tags each untagged version and reports the tags to the Changesets action, which pushes them and creates the GitHub releases. A failed publish stops before tagging; a re-run publishes only what is missing.

`vp run release:dry-run` builds and lists what `vp pm publish` would publish, without publishing or tagging.

The release jobs install with `--ignore-scripts` and set `pnpm_config_verify_deps_before_run: "false"`, so no lifecycle script runs while a job holds `id-token: write`; the build emits the same `dist/` on the unpatched `tsc`. Don't add `--provenance`: pnpm attaches provenance by itself under trusted publishing from a public repository (from a private one, the publish would need `--no-provenance`).

## One-time setup

1. **Settings → Actions → General**: allow GitHub Actions to create pull requests.
2. **npm package → Settings → Trusted Publisher**: GitHub Actions, repository `thomasfosterau/effect-bib`, workflow `release.yml`, environment `release`. Remove any automation tokens. A new package name must be published once by hand first, from a clean `trunk` as `thomasfosterau`: `vp install --frozen-lockfile`, `vp run release:dry-run`, then `vp run release`, then `git push origin --tags`. Never publish from a package directory.
3. **Settings → Environments → `release`**: required reviewer (the owner), deployments from `trunk` only.
4. **Protect `trunk`**: require PRs and the `ci (node lts)` / `ci (node latest)` checks.
