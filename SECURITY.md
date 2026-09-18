# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via GitHub's [**Report a vulnerability**](https://github.com/thomasfosterau/reference-manager/security/advisories/new) button (Security → Advisories), **not** through public issues.

You can expect an initial response within a few days. Please include a description, reproduction steps, and the affected version.

## Untrusted input

`@thomasfosterau/biblio` exists to read data nobody controls — uploaded bibliographic files and responses from public APIs — so the untrusted-input posture is the package's design, not a hardening pass:

- **Total decoders.** Every parser, normaliser and identifier decoder returns `Option.none()`, a `skipped` outcome or a thinner record on partial or hostile input; nothing throws.
- **Identifiers reach a URL only as proven brands.** `Isbn` / `Doi` / `Issn` / `Orcid` are branded, checksum-validated values; a `Doi` has no control characters, whitespace or `..` segment, an `Isbn` is exclusively digits, and the source clients percent-encode on top of that. The raw string never reaches a path.
- **Bounded work.** Free text is clamped to `MAX_TEXT_FIELD_LENGTH`, contributor lists to `MAX_AUTHORS`, an upload to `MAX_INPUT_LENGTH` and `MAX_RECORDS`, a title search to a fixed page size.
- **Lenient response schemas, strict extraction.** Upstream JSON is decoded through schemas where every field is optional and only what the normaliser sanitises is trusted; a non-2xx status is classified (404 → not found, else a typed `LookupFailed`) rather than decoded.

## Supply-chain hardening

This package is published with a hardened, automated pipeline designed to resist supply-chain attacks (e.g. self-propagating npm worms that steal credentials and publish trojanized versions):

- **No long-lived npm token.** Releases use npm [**OIDC Trusted Publishing**](https://docs.npmjs.com/trusted-publishers): GitHub Actions proves its identity to npm with a short-lived, workflow-bound OIDC token. There is no `NPM_TOKEN` secret to steal from CI. The publish step packs with `pnpm pack` (which resolves the workspace's `catalog:` / `workspace:` specifiers) and publishes the tarball with the npm CLI directly (`npm publish`), since pnpm does not yet support OIDC trusted publishing.
- **Provenance.** Every published version carries [npm provenance](https://docs.npmjs.com/generating-provenance-statements), cryptographically linking the artifact to the exact source commit and workflow.
- **Pinned actions.** All GitHub Actions are pinned to full commit SHAs, so a hijacked tag cannot inject malicious workflow code.
- **Least privilege.** Workflows default to `permissions: {}`; each job opts into only the scopes it needs. CI checks out with `persist-credentials: false`.
- **Manual approval gate.** Publishing runs in a protected `release` environment that requires manual approval.
- **Locked, delayed dependencies.** Installs use `pnpm install --frozen-lockfile` against the committed `pnpm-lock.yaml`; `minimumReleaseAge` holds a newly published version for a day before pnpm will install it; Dependabot proposes updates for review with the same cooldown.

## Release pipeline

The publishing pipeline and its one-time maintainer setup (trusted publisher, protected `release` environment, branch protection) are documented in [PUBLISHING.md](PUBLISHING.md).
