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
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { Doi } from "../identifiers.ts";
import { type BiblioRecord, fromCslJson } from "../record.ts";
import { MAX_INPUT_LENGTH } from "../parse.ts";
import { LookupFailed } from "./errors.ts";
import { fetchGuarded, readBoundedText } from "./fetch-policy.ts";

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

/** A `LookupFailed` from the DOI resolver. */
const failed = (description: string): LookupFailed =>
  new LookupFailed({ source: "doi", description });

/**
 * A redirect may lead only to an {@link AGENCY_HOSTS} host over `https`, on
 * top of the shared request policy (`fetch-policy.ts`).
 */
const isAgencyHop = (url: URL): boolean =>
  url.protocol === "https:" && HashSet.has(AGENCY_HOSTS, url.hostname.toLowerCase());

/** Negotiates from `url`: a 404 is `None`, a 2xx the CSL-JSON body; redirects are followed under the policy. */
function negotiate(
  client: HttpClient.HttpClient,
  url: string,
): Effect.Effect<Option.Option<Schema.Json>, LookupFailed> {
  return fetchGuarded(client, new URL(url), {
    source: "doi",
    allowHop: Option.some(isAgencyHop),
    resolveAddresses: Option.none(),
  }).pipe(
    // The first hop is always `doi.org`, so only a redirect can be refused.
    Effect.catchTag("RefusedUrl", (refused) => Effect.fail(failed(refused.reason))),
    Effect.flatMap(({ response }) => {
      if (response.status === 404) return Effect.succeed(Option.none());
      if (response.status < 200 || response.status >= 300)
        return Effect.fail(failed(`upstream returned HTTP ${response.status}`));
      return readBoundedText(response, MAX_INPUT_LENGTH, "doi").pipe(
        Effect.flatMap((text) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(text).pipe(
            Effect.mapError(() => failed("doi response was not JSON")),
          ),
        ),
        Effect.map(Option.some),
      );
    }),
  );
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
 * The exchange is bounded by the shared request policy: ten seconds in all,
 * and a body of at most `MAX_INPUT_LENGTH` bytes.
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
    const item = yield* negotiate(negotiating, `${DOI_BASE}/${path}`);
    return Option.map(item, (body) => ({
      ...fromCslJson(body),
      provenance: {
        source: "csl-json" as const,
        retrievedBy: { identifierType: "doi", identifier: doi, endpoint: DOI_BASE },
      },
    }));
  },
);
