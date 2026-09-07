/**
 * @copyright Thomas Foster
 *
 * The composed bibliographic identifier-lookup service (biblio B3, issue
 * #1070; carries forward the KB-010 ingestion client, issue #574) — the
 * single {@link BiblioLookup} `Context.Service` every consumer depends on,
 * over Effect's `HttpClient`.
 *
 * **Contract shape.** Per the B1 design doc
 * (), the surface is
 * CSL-native throughout: `byIsbnRecord` / `byDoiRecord` /
 * `byTitle` — `Option<BiblioRecord>` / `Option<BiblioRecord>` /
 * `readonly BiblioRecord[]`. `byTitle` is the OpenAlex-justified addition the
 * design doc names explicitly (ranked search candidates). The pre-B3 flat
 * `byIsbn` / `byDoi` compatibility methods (and the B2
 * `cslRecordToIngestedRecord` shim they were backed by) were removed once
 * B4 (#1071) migrated `apps/api`'s `ingest.ts` onto `byIsbnRecord`; the
 * canonical ISBN-13 form `decodeIsbn` produces is what the create-graph
 * stamps as the Book's `entity_external_identifier`.
 *
 * **Sources.** `byIsbnRecord` resolves via OpenLibrary, `byDoiRecord` via
 * Crossref (the same per-identifier authority pre-B3 used), `byTitle` via
 * OpenAlex search. OpenAlex's DOI-lookup capability
 * ({@link lookupOpenAlexByDoi}) is exposed as a standalone source function
 * rather than wired into `byDoiRecord` — Crossref stays the DOI authority
 * here — and is what the cross-source dedup coherence test exercises
 * directly against the same Crossref-resolved work.
 *
 * 404 → `Option.none()`, the typed {@link LookupError} channel, and the
 * injectable-client / `FetchHttpClient` layer split all carry forward
 * unchanged from pre-B3.
 *
 * @module biblio/sources/service
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { decodeDoi, decodeIsbn } from "../identifiers.ts";
import { type BiblioRecord } from "../record.ts";
import { InvalidIdentifier, type LookupError } from "./errors.ts";
import { lookupCrossrefByDoi } from "./crossref.ts";
import { lookupOpenLibraryByIsbn } from "./openlibrary.ts";
import { searchOpenAlexByTitle } from "./openalex.ts";

export { InvalidIdentifier, LookupFailed, type LookupError, type LookupSource } from "./errors.ts";

/**
 * A polite User-Agent. Crossref's etiquette asks callers to identify
 * themselves; OpenLibrary tolerates anonymous requests and OpenAlex reads
 * its own `mailto` query parameter (added per-request in `openalex.ts`),
 * but we send the same header everywhere for consistency.
 */
const USER_AGENT = "thomasfoster.au-biblio/1.0 (mailto:me@thomasfoster.au)";

/**
 * Identifier / title-lookup contract. Every `Option`-returning method
 * yields `Option.none()` for a clean upstream "not found" (HTTP 404), and
 * fails on the typed channel for a bad identifier
 * ({@link InvalidIdentifier}) or an upstream fault ({@link LookupFailed}).
 * `byTitle` never fails on an empty result set — a search with no matches
 * is a valid, non-error outcome, so it returns `[]` rather than
 * `Option.none()`.
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
>()("@app/BiblioLookup") {}

/**
 * Builds the {@link BiblioLookup} service over an `HttpClient`. Wrapped by
 * {@link biblioLookupClientLayer} (which tests drive with a stub client)
 * and {@link biblioLookupLayer} (production, over the global fetch); not
 * exported because both layers live in this module.
 */
// reason: this client-construction block (polite User-Agent + acceptJson +
// filterStatusOk) is duplicated verbatim in the sibling extraction-trajectory
// package `packages/wikidata/src/lookup.ts` by design — the `.fallowrc.json`
// zone rules forbid `biblio` and `wikidata` depending on each other (or on
// any third shared package), so each self-contained package must carry its
// own HttpClient setup. Consolidating would break the extraction property
// both packages are built around.
// fallow-ignore-next-line code-duplication
const makeBiblioLookup = Effect.fnUntraced(function* () {
  const baseClient = yield* HttpClient.HttpClient;
  const client = baseClient.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.setHeader("user-agent", USER_AGENT),
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
    return yield* searchOpenAlexByTitle(client, query);
  });

  return { byIsbnRecord, byDoiRecord, byTitle } as const;
});

/**
 * {@link BiblioLookup} layer over whatever `HttpClient` is in context. The
 * production graph supplies `FetchHttpClient` (see {@link biblioLookupLayer});
 * a test supplies a stubbed fetch under the same `FetchHttpClient` slot.
 * Kept separate from {@link biblioLookupLayer} so tests can inject their own
 * client without bundling the global fetch.
 */
export const biblioLookupClientLayer: Layer.Layer<BiblioLookup, never, HttpClient.HttpClient> =
  Layer.effect(BiblioLookup)(makeBiblioLookup());

/**
 * Production {@link BiblioLookup} layer, backed by the Worker global fetch
 * via `FetchHttpClient`. Provided on each app's own per-request runtime
 * (`apps/web/src/lib/server/effect/runtime.ts`, `apps/api/src/runtime.ts`)
 * so the ingestion HTTP endpoint and Remote Form (#611) reach the live
 * OpenLibrary / Crossref / OpenAlex lookups; tests inject a stub at the
 * boundary instead.
 */
export const biblioLookupLayer: Layer.Layer<BiblioLookup> = biblioLookupClientLayer.pipe(
  Layer.provide(FetchHttpClient.layer),
);
