/**
 * @copyright Thomas Foster
 *
 * Bibliographic identifier-lookup service (KB-010, issue #574).
 *
 * Resolves an ISBN against OpenLibrary and a DOI against Crossref to a
 * neutral {@link IngestedRecord}, over Effect's `HttpClient`. Both APIs
 * are free and need no credentials. The service is an injectable
 * `Context.Service` so the ingest operation depends on the contract, not
 * on `fetch`: tests provide {@link BiblioLookup.testLayer} (or a stub),
 * production provides {@link biblioLookupLayer} over `FetchHttpClient`.
 *
 * Untrusted-data discipline:
 * - identifiers are validated / normalised before any URL is built, so a
 *   caller-supplied value can never escape the intended path segment
 *   (SSRF / path-injection guard — see `normaliseIsbn` / `normaliseDoi`);
 * - responses decode through deliberately-lenient schemas and are then
 *   sanitised field-by-field by the normalisers;
 * - a 404 maps to `Option.none()` (not found, not an error); other
 *   failures land on the typed {@link LookupError} channel.
 *
 * @module lib/server/biblio/lookup
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  type HttpClientError,
} from "effect/unstable/http";
import {
  CrossrefResponse,
  normaliseCrossref,
  normaliseOpenLibrary,
  OpenLibraryAuthor,
  openLibraryAuthorKeys,
  openLibraryAuthorName,
  OpenLibraryEdition,
} from "./normalise";
import { normaliseDoi, normaliseIsbn } from "./identifiers";
import { type IngestedRecord } from "./record";

const OPENLIBRARY_BASE = "https://openlibrary.org";
const CROSSREF_BASE = "https://api.crossref.org";

/**
 * A polite User-Agent. Crossref's etiquette asks callers to identify
 * themselves; OpenLibrary tolerates anonymous requests but we send the
 * same header for consistency.
 */
const USER_AGENT = "thomasfoster.au-biblio-ingest/1.0 (mailto:me@thomasfoster.au)";

/** A bad identifier the caller supplied — fix the input, don't retry. */
export class InvalidIdentifier extends Schema.TaggedErrorClass<InvalidIdentifier>()(
  "InvalidIdentifier",
  {
    kind: Schema.Literals(["isbn", "doi"]),
    value: Schema.String,
  },
) {}

/** An upstream transport / decode failure (network, 5xx, malformed body). */
export class LookupFailed extends Schema.TaggedErrorClass<LookupFailed>()("LookupFailed", {
  source: Schema.Literals(["openlibrary", "crossref"]),
  description: Schema.String,
}) {}

/** The typed error channel for a lookup. */
export type LookupError = InvalidIdentifier | LookupFailed;

/**
 * Identifier-lookup contract. Each method returns `Option.none()` for a
 * clean upstream "not found" (HTTP 404), and fails on the typed channel
 * for a bad identifier ({@link InvalidIdentifier}) or an upstream fault
 * ({@link LookupFailed}).
 */
export class BiblioLookup extends Context.Service<
  BiblioLookup,
  {
    readonly byIsbn: (isbn: string) => Effect.Effect<Option.Option<IngestedRecord>, LookupError>;
    readonly byDoi: (doi: string) => Effect.Effect<Option.Option<IngestedRecord>, LookupError>;
  }
>()("@app/BiblioLookup") {}

// ── HTTP plumbing ─────────────────────────────────────────────────────

/** Classifies an HttpClientError as a 404 (→ not found) or a real fault. */
function isNotFound(error: HttpClientError.HttpClientError): boolean {
  return error.reason._tag === "StatusCodeError" && error.reason.response.status === 404;
}

/**
 * Builds a JSON GET helper bound to a base URL. Decodes the body through
 * `schema`, mapping 404 → `Option.none()` and every other failure → a
 * {@link LookupFailed} on the typed channel.
 */
const makeGet =
  (client: HttpClient.HttpClient, base: string, source: "openlibrary" | "crossref") =>
  <S extends Schema.Top>(
    path: string,
    schema: S,
  ): Effect.Effect<Option.Option<S["Type"]>, LookupFailed, S["DecodingServices"]> =>
    client.get(`${base}${path}`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.map(Option.some),
      Effect.catchTags({
        HttpClientError: (error) =>
          isNotFound(error)
            ? Effect.succeed(Option.none<S["Type"]>())
            : Effect.fail(new LookupFailed({ source, description: describeHttpError(error) })),
        SchemaError: (error) =>
          Effect.fail(
            new LookupFailed({
              source,
              description: `${source} response did not match the expected shape: ${String(error)}`,
            }),
          ),
      }),
    );

function describeHttpError(error: HttpClientError.HttpClientError): string {
  return error.reason._tag === "StatusCodeError"
    ? `upstream returned HTTP ${error.reason.response.status}`
    : `request failed: ${String(error)}`;
}

// ── Service implementation ────────────────────────────────────────────

/**
 * Builds the {@link BiblioLookup} service over an `HttpClient`. Wrapped
 * by {@link biblioLookupClientLayer} (which tests drive with a stub
 * client) and {@link biblioLookupLayer} (production, over the global
 * fetch); not exported because both layers live in this module.
 */
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
    // error is re-classified in `makeGet`: 404 → `Option.none` (a clean
    // "not found"), anything else → a typed `LookupFailed`.
    HttpClient.filterStatusOk,
  );

  const byIsbn = Effect.fn("BiblioLookup.byIsbn")(function* (isbn: string) {
    const normalised = normaliseIsbn(isbn);
    if (normalised === null) {
      return yield* new InvalidIdentifier({ kind: "isbn", value: isbn });
    }
    const ol = makeGet(client, OPENLIBRARY_BASE, "openlibrary");
    // `normalised` is exclusively digits (+ optional X) — safe in the path.
    const edition = yield* ol(`/isbn/${normalised}.json`, OpenLibraryEdition);
    if (Option.isNone(edition)) return Option.none<IngestedRecord>();

    // Resolve author display names via the referenced /authors records.
    const authorNames: string[] = [];
    for (const key of openLibraryAuthorKeys(edition.value)) {
      // `key` is validated `/authors/OL\d+A` — safe in the path.
      const author = yield* ol(`${key}.json`, OpenLibraryAuthor);
      if (Option.isSome(author)) {
        const name = openLibraryAuthorName(author.value);
        if (name !== null) authorNames.push(name);
      }
    }

    const record = normaliseOpenLibrary(edition.value, normalised, authorNames);
    return Option.fromNullishOr(record);
  });

  const byDoi = Effect.fn("BiblioLookup.byDoi")(function* (doi: string) {
    const normalised = normaliseDoi(doi);
    if (normalised === null) {
      return yield* new InvalidIdentifier({ kind: "doi", value: doi });
    }
    const cr = makeGet(client, CROSSREF_BASE, "crossref");
    // Percent-encode the DOI: a valid DOI suffix may contain `/`, `(`, `)`
    // etc., which must not be read as path separators upstream.
    const response = yield* cr(`/works/${encodeURIComponent(normalised)}`, CrossrefResponse);
    if (Option.isNone(response)) return Option.none<IngestedRecord>();
    const record = normaliseCrossref(response.value, normalised);
    return Option.fromNullishOr(record);
  });

  return { byIsbn, byDoi } as const;
});

/**
 * {@link BiblioLookup} layer over whatever `HttpClient` is in context.
 * The production graph supplies `FetchHttpClient` (see
 * {@link biblioLookupLayer}); a test supplies a stubbed fetch under the
 * same `FetchHttpClient` slot. Kept separate from {@link biblioLookupLayer}
 * so tests can inject their own client without bundling the global fetch.
 */
export const biblioLookupClientLayer: Layer.Layer<BiblioLookup, never, HttpClient.HttpClient> =
  Layer.effect(BiblioLookup)(makeBiblioLookup());

/**
 * Production {@link BiblioLookup} layer, backed by the Worker global
 * fetch via `FetchHttpClient`. Provided on each app's own per-request
 * runtime (`apps/web/src/lib/server/effect/runtime.ts`,
 * `apps/api/src/runtime.ts`) so the ingestion HTTP endpoint and
 * Remote Form (#611) reach the live OpenLibrary / Crossref lookup; tests
 * inject a stub at the boundary instead.
 */
export const biblioLookupLayer: Layer.Layer<BiblioLookup> = biblioLookupClientLayer.pipe(
  Layer.provide(FetchHttpClient.layer),
);
