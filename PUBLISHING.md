# Publishing & releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) and published to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — there is no `NPM_TOKEN`. See [SECURITY.md](./SECURITY.md) for the security rationale behind the pipeline.

## The release flow

1. **Add a changeset with your change.** Run `pnpm changeset`, pick the bump (`patch` / `minor` / `major`) and write a user-facing summary, then commit the generated file alongside your change. (Changes that don't affect a published package — docs, CI, the dist-consumer fixture — need no changeset.)
2. **Merge to `main`.** The [`release`](./.github/workflows/release.yml) workflow runs and, while changesets are pending, opens or updates a **"Version Packages"** PR that applies the version bump and rolls the changesets into each package's `CHANGELOG.md`.
3. **Merge the "Version Packages" PR.** With no changesets left, the workflow publishes every package under `packages/*` to npm (with provenance) via the npm CLI and trusted publishing, then tags the commit and creates the GitHub releases.

The version step (`pnpm run version`) runs `changeset version`, then `vp fmt`, then `pnpm install --lockfile-only`. Changesets v3 formats the changelogs it writes with whatever formatter it detects, and it detects the `oxfmt` shim that Vite+ installs; that shim only serves editors and exits non-zero when run directly. So `.changeset/config.json` sets `"format": false` and the script formats with `vp fmt` itself.

The publish step ([scripts/release.sh](./scripts/release.sh)) packs each package with `pnpm pack` — the tool that understands this workspace's `catalog:` / `catalog:peers` / `workspace:` specifiers and applies each package's `publishConfig` — and hands the tarball to `npm publish`, because pnpm does not yet support npm OIDC trusted publishing ([pnpm#9812](https://github.com/pnpm/pnpm/issues/9812)); `changeset tag` then emits the `New tag:` lines the Changesets action uses to push the tags and create the releases.

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
