/**
 * The HttpClient-backed half of the toolkit: the composed
 * {@link BiblioLookup} service (ISBN via OpenLibrary, DOI via Crossref,
 * title search via OpenAlex, a publisher page's embedded metadata by URL
 * under the library's request policy), its layers, the per-source lookup functions
 * and response schemas, and the typed error channel. Imports
 * `effect/http`, which is why it is its own entry point — the root
 * entry stays free of it.
 *
 * @module biblio/sources
 * @since 0.1.0
 */

export * from "./contact.ts";
export * from "./crossref.ts";
export * from "./doi.ts";
export * from "./errors.ts";
export { type ResolveAddresses } from "./fetch-policy.ts";
export * from "./openalex.ts";
export * from "./openlibrary.ts";
export * from "./service.ts";
export * from "./web.ts";
