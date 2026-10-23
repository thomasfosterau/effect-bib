/**
 * DOI content negotiation: a DOI's metadata straight from its registration
 * agency (Crossref, DataCite, mEDRA, …) through `https://doi.org`, asked for
 * as CSL-JSON (`Accept: application/vnd.citationstyles.csl+json`) and read
 * with {@link fromCslJson}. Unlike the Crossref source it reaches DOIs every
 * agency registers (a DataCite dataset's, say), at the cost of Crossref's
 * richer normalisation.
 *
 * @copyright Thomas Foster
 * @module biblio/sources/doi
 * @since 1.0.0
 */

import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import type { Doi } from "../identifiers.ts";
import { type BiblioRecord, fromCslJson } from "../record.ts";
import { LookupFailed } from "./errors.ts";

/** The DOI resolver. */
const DOI_BASE = "https://doi.org";

/** CSL-JSON's media type, as the registration agencies serve it. */
const CSL_JSON = "application/vnd.citationstyles.csl+json";

/**
 * The hosts a content-negotiation redirect may lead to: the resolver and the
 * registration agencies' metadata services. A redirect anywhere else (an
 * internal address, a hostile agency record) is refused, never followed.
 */
const AGENCY_HOSTS = HashSet.make(
  "doi.org",
  "api.crossref.org",
  "data.crossref.org",
  "api.datacite.org",
  "data.datacite.org",
  "data.medra.org",
  "data.jalc.org",
);

/** The most redirects followed from `doi.org` to the agency's record. */
const MAX_REDIRECTS = 5;

/** A `LookupFailed` from the DOI resolver. */
const failed = (description: string): LookupFailed =>
  new LookupFailed({ source: "doi", description });

/**
 * Where a redirect may go: its `Location` resolved against the URL that
 * answered, accepted only as `https` on an {@link AGENCY_HOSTS} host, with no
 * credentials and the default port.
 */
function redirectTarget(location: string, from: string): Result.Result<string, LookupFailed> {
  return Result.try({
    try: () => new URL(location, from),
    catch: () => failed("redirect to an unparseable location"),
  }).pipe(
    Result.flatMap((url) =>
      url.protocol === "https:" &&
      HashSet.has(AGENCY_HOSTS, url.hostname.toLowerCase()) &&
      url.username === "" &&
      url.password === "" &&
      url.port === ""
        ? Result.succeed(url.href)
        : Result.fail(failed(`refused a redirect to ${url.protocol}//${url.hostname}`)),
    ),
  );
}

/** Sends one hop with redirects left to the caller, so each is checked before it is followed. */
function send(
  client: HttpClient.HttpClient,
  url: string,
): Effect.Effect<HttpClientResponse.HttpClientResponse, LookupFailed> {
  const request = client.get(url).pipe(
    // `filterStatusOk` turns a 3xx or 404 into an error; read the response either way.
    Effect.catchTag("HttpClientError", (error) =>
      error.reason._tag === "StatusCodeError"
        ? Effect.succeed(error.reason.response)
        : Effect.fail(failed(`request failed: ${error.reason._tag}`)),
    ),
  );
  return Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (init) =>
    Effect.provideService(request, FetchHttpClient.RequestInit, {
      ...Option.getOrElse(init, () => ({})),
      redirect: "manual",
    }),
  );
}

/** Follows the negotiation from `url`: a 404 is `None`, a 2xx the CSL-JSON body, a checked redirect the next hop. */
function negotiate(
  client: HttpClient.HttpClient,
  url: string,
  redirects: number,
): Effect.Effect<Option.Option<Schema.Json>, LookupFailed> {
  return Effect.flatMap(send(client, url), (response) => {
    if (response.status === 404) return Effect.succeed(Option.none());
    if (response.status >= 200 && response.status < 300)
      return response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
        Effect.map(Option.some),
        Effect.mapError(() => failed("doi response was not JSON")),
      );
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= MAX_REDIRECTS) return Effect.fail(failed("too many redirects"));
      return Option.match(Headers.get(response.headers, "location"), {
        onNone: () => Effect.fail(failed(`redirect ${response.status} without a location`)),
        onSome: (location) =>
          Effect.flatMap(Effect.fromResult(redirectTarget(location, url)), (next) =>
            negotiate(client, next, redirects + 1),
          ),
      });
    }
    return Effect.fail(failed(`upstream returned HTTP ${response.status}`));
  });
}

/**
 * Resolves a {@link Doi} by content negotiation at `doi.org`, as CSL-JSON
 * read into a {@link BiblioRecord} (stamped `provenance.source: "csl-json"`,
 * retrieved by `doi` from `https://doi.org`). `Option.none()` on a clean 404
 * (an unregistered DOI); a {@link LookupFailed} on any other upstream fault.
 * The resolver answers with a redirect to the registration agency; each one
 * is followed by hand, only over `https` to a known agency host and at most
 * five deep, and any other redirect fails with {@link LookupFailed} rather
 * than being followed (the fetch itself is told not to follow redirects).
 * `client` is expected to carry the polite User-Agent; the request asks for
 * CSL-JSON whatever `Accept` the client sets.
 *
 * @since 1.0.0
 */
export const lookupDoiCsl: (
  client: HttpClient.HttpClient,
  doi: Doi,
) => Effect.Effect<Option.Option<BiblioRecord>, LookupFailed> = Effect.fn("lookupDoiCsl")(
  function* (client: HttpClient.HttpClient, doi: Doi) {
    const negotiating = client.pipe(HttpClient.mapRequest(HttpClientRequest.accept(CSL_JSON)));
    // Each path segment percent-encoded: a DOI suffix may hold `#`, `?` or
    // `%`, which must not end the path upstream.
    const path = doi.split("/").map(encodeURIComponent).join("/");
    const item = yield* negotiate(negotiating, `${DOI_BASE}/${path}`, 0);
    return Option.map(item, (body) => ({
      ...fromCslJson(body),
      provenance: {
        source: "csl-json" as const,
        retrievedBy: { identifierType: "doi", identifier: doi, endpoint: DOI_BASE },
      },
    }));
  },
);
