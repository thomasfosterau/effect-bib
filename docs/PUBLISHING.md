# Publishing

Releases use [Changesets](https://github.com/changesets/changesets) and npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC); there is no `NPM_TOKEN`.

## Flow

1. Commit a changeset (`vp exec changeset`) with each change to the published package.
2. On `trunk`, the [Release workflow](../.github/workflows/release.yml) opens or updates the "chore: version packages" PR (`pnpm run version`: `changeset version`, then `vp fmt`, since `.changeset/config.json` sets `"format": false`, then a lockfile refresh).
3. Merging that PR runs the `publish` job after manual approval: it builds, packs each package with `pnpm pack` (which resolves `catalog:` / `workspace:` and `publishConfig`), publishes the tarballs with an exactly pinned npm (trusted publishing needs npm >= 11.5.1; bump the pin by hand), and tags the release ([scripts/release.sh](../scripts/release.sh)).

The release jobs install with `--ignore-scripts` and set `pnpm_config_verify_deps_before_run: "false"`, so no lifecycle script runs while a job holds `id-token: write`; the build emits the same `dist/` on the unpatched `tsc`. Don't add `--provenance`: requested explicitly from a private repository, it fails the publish. npm attaches provenance by itself once the repository is public.

## One-time setup

1. **Settings → Actions → General**: allow GitHub Actions to create pull requests.
2. **npm package → Settings → Trusted Publisher**: GitHub Actions, repository `thomasfosterau/effect-bib`, workflow `release.yml`, environment `release`. Remove any automation tokens. A new package name must be published once by hand first.
3. **Settings → Environments → `release`**: required reviewer (the owner), deployments from `trunk` only.
4. **Protect `trunk`**: require PRs and the `ci (node lts)` / `ci (node latest)` checks.
