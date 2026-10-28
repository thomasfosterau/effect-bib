/**
 * The typed error channel shared by every {@link BiblioLookup} source client.
 *
 * @copyright Thomas Foster
 * @module biblio/sources/errors
 * @since 0.1.0
 */

// A leaf module (website#1070): no dependency on the per-source clients or on
// `service.ts`, so `openlibrary.ts` / `crossref.ts` / `openalex.ts` and the
// composed service can all import it without a circular dependency.

import * as Schema from "effect/Schema";

/**
 * The external source authorities a lookup can fail against. `doi` (content
 * negotiation at `doi.org`) and `web` (a page fetched by `byUrl`) were added
 * in 1.0.0.
 *
 * @since 0.1.0
 */
export const LookupSource = Schema.Literals(["openlibrary", "crossref", "openalex", "doi", "web"]);
/**
 * @since 0.1.0
 */
export type LookupSource = typeof LookupSource.Type;

/**
 * A bad identifier the caller supplied — fix the input, don't retry.
 *
 * @since 0.1.0
 */
export class InvalidIdentifier extends Schema.TaggedError<InvalidIdentifier>()(
  "InvalidIdentifier",
  {
    kind: Schema.Literals(["isbn", "doi"]),
    value: Schema.String,
  },
) {}

/**
 * An upstream transport / decode failure (network, 5xx, malformed body).
 *
 * @since 0.1.0
 */
export class LookupFailed extends Schema.TaggedError<LookupFailed>()("LookupFailed", {
  source: LookupSource,
  description: Schema.String,
}) {}

/**
 * A URL the caller supplied that the request policy will not fetch — a
 * non-http(s) scheme, embedded credentials, a non-default port, or a
 * private, loopback, link-local, unique-local or local-network host — with
 * the reason. Fix the input, don't retry.
 *
 * @since 1.0.0
 */
export class RefusedUrl extends Schema.TaggedError<RefusedUrl>()("RefusedUrl", {
  url: Schema.String,
  reason: Schema.String,
}) {}

/**
 * The typed error channel for a lookup. `RefusedUrl` (from `byUrl`) was
 * added in 1.0.0.
 *
 * @since 0.1.0
 */
export type LookupError = InvalidIdentifier | LookupFailed | RefusedUrl;
