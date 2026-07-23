/**
 * @copyright Thomas Foster
 *
 * Shared HTTP plumbing for the {@link BiblioLookup} source clients
 * (biblio B3, issue #1070) — a JSON GET helper bound to a base URL and a
 * source name, decoding through a caller-supplied lenient schema and
 * mapping the 404 → `Option.none()` / typed-{@link LookupFailed} discipline
 * every source shares. Kept verbatim from the pre-B3 `lookup.ts` — the
 * untrusted-response handling was already correct, only the source-name
 * union widened (to include `"openalex"`). Also carries {@link firstString},
 * the "first plausible sanitised string from an upstream array" helper
 * OpenLibrary and Crossref both need for their `publishers` /
 * `container-title` style fields.
 *
 * @module biblio/sources/http
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse, type HttpClientError } from "effect/unstable/http";
import { sanitiseText } from "../record";
import { LookupFailed, type LookupSource } from "./errors";

/** Classifies an HttpClientError as a 404 (→ not found) or a real fault. */
function isNotFound(error: HttpClientError.HttpClientError): boolean {
  return error.reason._tag === "StatusCodeError" && error.reason.response.status === 404;
}

/** The first plausible sanitised string from an upstream array, or `null`. */
export function firstString(values: readonly unknown[] | undefined): string | null {
  if (!values) return null;
  for (const v of values) {
    const s = sanitiseText(v);
    if (s !== null) return s;
  }
  return null;
}

/** A short human-readable description of an upstream HTTP failure. */
function describeHttpError(error: HttpClientError.HttpClientError): string {
  return error.reason._tag === "StatusCodeError"
    ? `upstream returned HTTP ${error.reason.response.status}`
    : `request failed: ${String(error)}`;
}

/**
 * Builds a JSON GET helper bound to a base URL and a source name. Decodes
 * the body through `schema`, mapping 404 → `Option.none()` and every other
 * failure → a {@link LookupFailed} on the typed channel. Shared by every
 * source client so the untrusted-response discipline lives in one place.
 */
export const makeGet =
  (client: HttpClient.HttpClient, base: string, source: LookupSource) =>
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
