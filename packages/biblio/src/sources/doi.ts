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
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { Doi } from "../identifiers.ts";
import { type BiblioRecord, fromCslJson } from "../record.ts";
import type { LookupFailed } from "./errors.ts";
import { jsonGet } from "./http.ts";

/** The DOI resolver. */
const DOI_BASE = "https://doi.org";

/** CSL-JSON's media type, as the registration agencies serve it. */
const CSL_JSON = "application/vnd.citationstyles.csl+json";

/**
 * Resolves a {@link Doi} by content negotiation at `doi.org`, as CSL-JSON
 * read into a {@link BiblioRecord} (stamped `provenance.source: "csl-json"`,
 * retrieved by `doi` from `https://doi.org`). `Option.none()` on a clean 404
 * (an unregistered DOI); a {@link LookupFailed} on any other upstream fault.
 * `client` is expected to carry the polite User-Agent and `filterStatusOk`
 * (composed once in `service.ts`); the request asks for CSL-JSON whatever
 * `Accept` the client sets.
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
    const item = yield* jsonGet(negotiating, DOI_BASE, "doi")(`/${path}`, Schema.Unknown);
    return Option.map(item, (body) => ({
      ...fromCslJson(body),
      provenance: {
        source: "csl-json" as const,
        retrievedBy: { identifierType: "doi", identifier: doi, endpoint: DOI_BASE },
      },
    }));
  },
);
