/**
 * @copyright Thomas Foster
 *
 * The typed error channel shared by every {@link BiblioLookup} source
 * client (biblio B3, issue #1070). Kept in its own leaf module — no
 * dependency on the per-source clients or on `service.ts` — so
 * `openlibrary.ts` / `crossref.ts` / `openalex.ts` and the composed
 * service can both import it without a circular dependency.
 *
 * @module biblio/sources/errors
 * @since 0.1.0
 */

import * as Schema from "effect/Schema";

/**
 * The external source authorities a lookup can fail against.
 *
 * @since 0.1.0
 */
export const LookupSource = Schema.Literals(["openlibrary", "crossref", "openalex"]);
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
 * The typed error channel for a lookup.
 *
 * @since 0.1.0
 */
export type LookupError = InvalidIdentifier | LookupFailed;
