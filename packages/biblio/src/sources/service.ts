/**
 * The composed bibliographic identifier-lookup service — the single
 * {@link BiblioLookup} `Context.Service` every consumer depends on, over
 * Effect's `HttpClient`.
 *
 * **Contract shape.** The surface is CSL-native throughout: `byIsbnRecord` /
 * `byDoiRecord` / `byTitle` — `Option<BiblioRecord>` /
 * `Option<BiblioRecord>` / `readonly BiblioRecord[]`. `byTitle` returns
 * OpenAlex's ranked search candidates.
 *
 * **Sources.** `byIsbnRecord` resolves via OpenLibrary, `byDoiRecord` via
 * Crossref, `byTitle` via OpenAlex search. OpenAlex's DOI lookup
 * ({@link lookupOpenAlexByDoi}) is exposed as a standalone source function
 * rather than wired into `byDoiRecord`: Crossref stays the DOI authority
 * here.
 *
 * A clean upstream 404 is `Option.none()`; every other failure is the typed
 * {@link LookupError} channel. Both layers take the caller's
 * {@link LookupContact}, which identifies every request to the upstream
 * sources. The client-injectable layer and the `FetchHttpClient` layer are
 * split so tests can stub the client.
 *
 * @copyright Thomas Foster
 * @module biblio/sources/service
 * @since 0.1.0
 */

// website#1070, website#574. `lookupOpenAlexByDoi` is what the cross-source
// dedup coherence test exercises directly against the same Crossref-resolved
// work.

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { decodeDoi, decodeIsbn } from "../identifiers.ts";
import { type BiblioRecord } from "../record.ts";
import { type LookupContact } from "./contact.ts";
import { InvalidIdentifier, type LookupError } from "./errors.ts";
import { lookupCrossrefByDoi } from "./crossref.ts";
import { lookupOpenLibraryByIsbn } from "./openlibrary.ts";
import { searchOpenAlexByTitle } from "./openalex.ts";

/**
 * The polite User-Agent for a contact: `product (mailto:email)`. Crossref's
 * etiquette asks callers to identify themselves this way; OpenLibrary
 * tolerates anonymous requests and OpenAlex also reads its own `mailto`
 * query parameter (added per-request in `openalex.ts`), but the same header
 * goes everywhere for consistency.
 */
const userAgent = (contact: LookupContact): string =>
  `${contact.product} (mailto:${contact.email})`;

/**
 * Options for {@link biblioLookupLayer} and {@link biblioLookupClientLayer}.
 *
 * @since 0.1.0
 */
export interface BiblioLookupOptions {
  /** Who is making the lookups; sent with every upstream request. */
  readonly contact: LookupContact;
}

/**
 * Identifier / title-lookup contract. Every `Option`-returning method
 * yields `Option.none()` for a clean upstream "not found" (HTTP 404), and
 * fails on the typed channel for a bad identifier
 * ({@link InvalidIdentifier}) or an upstream fault ({@link LookupFailed}).
 * `byTitle` never fails on an empty result set — a search with no matches
 * is a valid, non-error outcome, so it returns `[]` rather than
 * `Option.none()`.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import * as Option from "effect/Option"
 * import { BiblioLookup, biblioLookupLayer } from "@thomasfosterau/biblio/sources"
 *
 * const program = Effect.gen(function* () {
 *   const lookup = yield* BiblioLookup
 *   return yield* lookup.byIsbnRecord("978-0-06-231609-7")
 * })
 *
 * // Production: over the global fetch, identified as your application.
 * // (Not run here — no network in docs.)
 * const lookupLayer = biblioLookupLayer({
 *   contact: { product: "my-app/1.0", email: "ops@example.org" },
 * })
 * export const live = program.pipe(Effect.provide(lookupLayer))
 *
 * // A test stub is just another implementation of the same service.
 * const stub = Layer.succeed(BiblioLookup, {
 *   byIsbnRecord: () => Effect.succeed(Option.none()),
 *   byDoiRecord: () => Effect.succeed(Option.none()),
 *   byTitle: () => Effect.succeed([]),
 * })
 * const found = await Effect.runPromise(program.pipe(Effect.provide(stub)))
 * assert.strictEqual(Option.isNone(found), true)
 * ```
 *
 * @since 0.1.0
 */
export class BiblioLookup extends Context.Service<
  BiblioLookup,
  {
    /** CSL-native ISBN lookup via OpenLibrary. */
    readonly byIsbnRecord: (
      isbn: string,
    ) => Effect.Effect<Option.Option<BiblioRecord>, LookupError>;
    /** CSL-native DOI lookup via Crossref. */
    readonly byDoiRecord: (doi: string) => Effect.Effect<Option.Option<BiblioRecord>, LookupError>;
    /** CSL-native title search via OpenAlex, ranked by upstream relevance. */
    readonly byTitle: (query: string) => Effect.Effect<readonly BiblioRecord[], LookupError>;
  }
>()("@thomasfosterau/biblio/BiblioLookup") {}

/**
 * Builds the {@link BiblioLookup} service over an `HttpClient`. Wrapped by
 * {@link biblioLookupClientLayer} (which tests drive with a stub client)
 * and {@link biblioLookupLayer} (production, over the global fetch); not
 * exported because both layers live in this module.
 */
// Kept local: the package depends on nothing but `effect`.
// fallow-ignore-next-line code-duplication
const makeBiblioLookup = Effect.fnUntraced(function* ({ contact }: BiblioLookupOptions) {
  const baseClient = yield* HttpClient.HttpClient;
  const client = baseClient.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.setHeader("user-agent", userAgent(contact)),
        HttpClientRequest.acceptJson,
      ),
    ),
    // Raise a `StatusCodeError` for any non-2xx response. `HttpClient`
    // does NOT fail on status codes by default, so without this a 404 or
    // 5xx that still carries a JSON body would decode against the
    // (deliberately lenient) schemas and look like an empty success. The
    // error is re-classified in `makeGet` (`sources/http.ts`): 404 →
    // `Option.none` (a clean "not found"), anything else → a typed
    // `LookupFailed`.
    HttpClient.filterStatusOk,
  );

  const byIsbnRecord = Effect.fn("BiblioLookup.byIsbnRecord")(function* (raw: string) {
    const isbn = decodeIsbn(raw);
    if (Option.isNone(isbn)) return yield* new InvalidIdentifier({ kind: "isbn", value: raw });
    return yield* lookupOpenLibraryByIsbn(client, isbn.value);
  });

  const byDoiRecord = Effect.fn("BiblioLookup.byDoiRecord")(function* (raw: string) {
    const doi = decodeDoi(raw);
    if (Option.isNone(doi)) return yield* new InvalidIdentifier({ kind: "doi", value: raw });
    return yield* lookupCrossrefByDoi(client, doi.value);
  });

  const byTitle = Effect.fn("BiblioLookup.byTitle")(function* (query: string) {
    return yield* searchOpenAlexByTitle(client, query, contact);
  });

  return { byIsbnRecord, byDoiRecord, byTitle } as const;
});

/**
 * {@link BiblioLookup} layer over whatever `HttpClient` is in context,
 * identified by `options.contact`. The production graph supplies
 * `FetchHttpClient` (see {@link biblioLookupLayer}); a test supplies a
 * stubbed fetch under the same `FetchHttpClient` slot. Kept separate from
 * {@link biblioLookupLayer} so tests can inject their own client without
 * bundling the global fetch. Each call builds a new layer, so build it once
 * and share the value (layers memoize by reference).
 *
 * @since 0.1.0
 */
export const biblioLookupClientLayer = (
  options: BiblioLookupOptions,
): Layer.Layer<BiblioLookup, never, HttpClient.HttpClient> =>
  Layer.effect(BiblioLookup)(makeBiblioLookup(options));

/**
 * Production {@link BiblioLookup} layer over `FetchHttpClient` (the global
 * `fetch`), identified by `options.contact`. Use
 * {@link biblioLookupClientLayer} to supply your own `HttpClient`, e.g. a
 * stub in tests. Each call builds a new layer, so build it once and share
 * the value (layers memoize by reference).
 *
 * @since 0.1.0
 */
export const biblioLookupLayer = (options: BiblioLookupOptions): Layer.Layer<BiblioLookup> =>
  biblioLookupClientLayer(options).pipe(Layer.provide(FetchHttpClient.layer));
