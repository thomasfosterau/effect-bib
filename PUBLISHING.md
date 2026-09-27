# Publishing & releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) and published to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — there is no `NPM_TOKEN`. See [SECURITY.md](./SECURITY.md) for the security rationale behind the pipeline.

## The release flow

1. **Add a changeset with your change.** Run `pnpm changeset`, pick the bump (`patch` / `minor` / `major`) and write a user-facing summary, then commit the generated file alongside your change. (Changes that don't affect a published package — docs, CI, the dist-consumer fixture — need no changeset.)
2. **Merge to `main`.** The [`release`](./.github/workflows/release.yml) workflow runs and, while changesets are pending, opens or updates a **"Version Packages"** PR that applies the version bump and rolls the changesets into each package's `CHANGELOG.md`.
3. **Merge the "Version Packages" PR.** With no changesets left, the workflow publishes every package under `packages/*` to npm via the npm CLI and trusted publishing (with provenance once the repository is public — see below), then tags the commit and creates the GitHub releases.

The version step (`pnpm run version`) runs `changeset version`, then `vp fmt`, then `pnpm install --lockfile-only`. Changesets v3 formats the changelogs it writes with whatever formatter it detects, and it detects the `oxfmt` shim that Vite+ installs; that shim only serves editors and exits non-zero when run directly. So `.changeset/config.json` sets `"format": false` and the script formats with `vp fmt` itself.

The publish step ([scripts/release.sh](./scripts/release.sh)) packs each package with `pnpm pack` — the tool that understands this workspace's `catalog:` / `catalog:peers` / `workspace:` specifiers and applies each package's `publishConfig` — and hands the tarball to `npm publish`; `changeset tag` then emits the `New tag:` lines the Changesets action uses to push the tags and create the releases. npm's OIDC trusted publishing needs npm >= 11.5.1, so the Release job installs an **exact** npm version (`npm install -g npm@11.20.0`, bumped by hand — not `@latest`, which would put whatever the registry serves that day into the job holding `id-token: write`). (pnpm 11's `pnpm publish` also performs the OIDC exchange natively — the pnpm-10-era [pnpm#9812](https://github.com/pnpm/pnpm/issues/9812) no longer applies — so moving to it would drop the npm upgrade altogether; the npm CLI path is kept for now.)

**No scripts in the release job.** CI installs with lifecycle scripts on (the type gate needs the Effect-patched `tsc` that the root `prepare` produces). The Release job does not: it passes `ignore-scripts: "true"` to `.github/actions/setup`, so neither a dependency's install script nor the root `prepare` runs while the job holds `id-token: write` — the build emits a byte-identical `dist/` on the unpatched `tsc`. It also sets `pnpm_config_verify_deps_before_run: "false"`, because pnpm 11 otherwise checks dependencies before each `pnpm run` / `pnpm exec` and, when a manifest looks newer than the install, re-installs **with** scripts. (pnpm 11 reads only the `pnpm_config_*` spelling of that setting.) `scripts/release.sh` packs with `pnpm pack --config.ignore-scripts=true` (`pnpm pack` has no `--ignore-scripts` flag), and `npm publish` of a tarball runs no lifecycle script, so no package `prepack` / `prepare` / `postpack` runs there either. It also skips any package already on npm at its current version, so a re-run after a partial publish, or a version bootstrapped by hand, does not fail the automated run.

**Provenance.** Nothing in the pipeline requests [provenance](https://docs.npmjs.com/generating-provenance-statements). Under trusted publishing npm attaches it by itself only when the OIDC token reports a **public** repository and the package is public on the registry. This repository is private, so releases carry no provenance statement today; they will once it is made public. Do not add `--provenance` or `NPM_CONFIG_PROVENANCE=true` (here or in the hand bootstrap publish below): the npm CLI honours both, and an explicit provenance request from a private repository fails the publish.

## Maintainer setup (one-time)

The following steps make the automated flow work end-to-end. The first publish of a scope-new package name cannot use a trusted publisher until the package exists on npm; publish the initial version by hand (`npm publish` of a `pnpm pack` tarball, from a machine with a scoped token), then configure the publisher below and revoke the token.

1. **Allow Actions to open the Version Packages PR.** In the repo: **Settings → Actions → General → Workflow permissions** → enable **"Allow GitHub Actions to create and approve pull requests"**. Without this the built-in `GITHUB_TOKEN` is forbidden from opening pull requests and the workflow fails at the PR-creation step — even though the job already grants `pull-requests: write`.
2. **Configure the trusted publisher.** On npmjs.com, open the package → **Settings → Trusted Publisher** and add:
   - Provider: **GitHub Actions**
   - Repository: `thomasfosterau/reference-manager`
   - Workflow: `release.yml`
   - Environment: `release`

   Then remove any classic automation tokens for the package.

3. **Protect the `release` environment.** **Settings → Environments → `release`** → enable **Required reviewers** (yourself) and restrict deployment to the `main` branch, so publishing pauses for manual approval.
4. **Protect `main`.** Require pull requests and passing CI before merge, and disallow direct pushes, so a release can only be triggered by merging the reviewed "Version Packages" PR.
