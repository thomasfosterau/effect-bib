# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's [Report a vulnerability](https://github.com/thomasfosterau/effect-bib/security/advisories/new) form, not a public issue. Include a description, reproduction steps and the affected version.

## Untrusted input

The package exists to read data nobody controls (uploaded bibliographic files, public API responses), so this posture is its design:

- **Total decoders.** Every parser, normaliser and identifier decoder returns `Option.none()`, a `skipped` outcome or a thinner record on hostile input; nothing throws.
- **Identifiers reach a URL only as proven brands.** `Isbn`, `Doi`, `Issn` and the rest are validated, branded values safe to interpolate into a URL path; the source clients percent-encode on top.
- **Bounded work.** Free text, contributor lists, input length, record counts and BibTeX macro expansion are capped by default; options can move a bound but not remove it.
- **SSRF policy.** Every fetch of a URL the library does not fix (`byUrl`, `doi.org` redirects) goes through one request policy: `http(s)` only, no private or local addresses, redirects re-checked by hand, a timeout and a size cap. Pinning the connection against DNS rebinding is the caller's transport's job.

## Supply chain

- Releases use npm trusted publishing (OIDC) from a protected `release` environment that needs manual approval; there is no `NPM_TOKEN`. Only the publish job holds `id-token: write`.
- The release jobs install with `--ignore-scripts`, so no dependency's lifecycle script runs there, and restore no cache CI could have written; `allowBuilds` in `pnpm-workspace.yaml` names the only dependencies whose install scripts may run in CI.
- Workflows default to `permissions: {}`, check out with `persist-credentials: false`, and pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`.
- Installs are frozen against `pnpm-lock.yaml`; `minimumReleaseAge` holds new versions for 8 hours, and Dependabot waits a day.
