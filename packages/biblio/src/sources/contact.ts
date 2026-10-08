/**
 * The caller's contact identity, which every {@link BiblioLookup} request
 * carries to the upstream sources. Crossref and OpenAlex route identified
 * callers to their "polite pool" (a faster, more reliable tier) and use the
 * address to reach whoever runs a misbehaving client, so the identity is
 * the consumer's own, never the package's. Kept in its own leaf module so
 * `openalex.ts` and the composed service can both import it without a
 * circular dependency.
 *
 * @copyright Thomas Foster
 * @module biblio/sources/contact
 * @since 0.1.0
 */

/**
 * Who is making the lookups: a User-Agent product token and a contact
 * address. Both are trusted configuration, not user input.
 *
 * @since 0.1.0
 */
export interface LookupContact {
  /**
   * The User-Agent product token, conventionally `name/version`
   * (e.g. `"my-app/1.0"`).
   */
  readonly product: string;
  /**
   * The address an upstream operator can reach you at: sent as the
   * User-Agent's `mailto:` comment and as OpenAlex's `mailto` parameter.
   */
  readonly email: string;
}
