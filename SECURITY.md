# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via GitHub's [**Report a vulnerability**](https://github.com/thomasfosterau/effect-bib/security/advisories/new) button (Security → Advisories), **not** through public issues.

You can expect an initial response within a few days. Please include a description, reproduction steps, and the affected version.

## Untrusted input

`@thomasfosterau/biblio` exists to read data nobody controls — uploaded bibliographic files and responses from public APIs — so the untrusted-input posture is the package's design, not a hardening pass:

- **Total decoders.** Every parser, normaliser and identifier decoder returns `Option.none()`, a `skipped` outcome or a thinner record on partial or hostile input; nothing throws.
- **Identifiers reach a URL only as proven brands.** `Isbn` / `Doi` / `Issn` / `Orcid` are branded, checksum-validated values; a `Doi` has no control characters, whitespace or `..` segment, an `Isbn` is exclusively digits, and the source clients percent-encode on top of that. The raw string never reaches a path.
- **Bounded work.** Free text is clamped to `MAX_TEXT_FIELD_LENGTH`, contributor lists to `MAX_AUTHORS`, an upload to `MAX_INPUT_LENGTH` and `MAX_RECORDS`, a title search to a fixed page size.
- **Lenient response schemas, strict extraction.** Upstream JSON is decoded through schemas where every field is optional and only what the normaliser sanitises is trusted; a non-2xx status is classified (404 → not found, else a typed `LookupFailed`) rather than decoded.

## Supply-chain hardening

This package is published with a hardened, automated pipeline designed to resist supply-chain attacks (e.g. self-propagating npm worms that steal credentials and publish trojanized versions):

- **No long-lived npm token.** Releases use npm trusted publishing (OIDC) from the protected `release` environment; there is no `NPM_TOKEN` to steal — see [PUBLISHING.md](PUBLISHING.md).
- **Exact npm pin.** The release job installs a reviewed npm version, never `npm@latest` — see PUBLISHING.md.
- **No provenance requested.** Nothing in the pipeline requests provenance; npm attaches it only once the repository and package are both public, and this repository is private — see PUBLISHING.md.
- **No install scripts in the release job.** It installs with `--ignore-scripts` and turns off pnpm 11's `verify-deps-before-run`, so neither a dependency's install hook nor the workspace's `prepare` runs while it holds `id-token: write` — see PUBLISHING.md. CI installs with scripts (the type gate needs the Effect-patched `tsc`); `allowBuilds` in `pnpm-workspace.yaml` names the only dependencies whose install scripts may run there.
- **Pinned actions.** All GitHub Actions are pinned to full commit SHAs, so a hijacked tag cannot inject malicious workflow code.
- **Least privilege.** Workflows default to `permissions: {}`; each job opts into only the scopes it needs. CI checks out with `persist-credentials: false`.
- **Manual approval gate.** Publishing runs in a protected `release` environment that requires manual approval.
- **Locked, delayed dependencies.** Installs use `pnpm install --frozen-lockfile` against the committed `pnpm-lock.yaml`; `minimumReleaseAge` holds a newly published version for a day before pnpm will install it; Dependabot proposes updates for review with the same cooldown.

## Release pipeline

The publishing pipeline and its one-time maintainer setup (trusted publisher, protected `release` environment, branch protection) are documented in [PUBLISHING.md](PUBLISHING.md).
