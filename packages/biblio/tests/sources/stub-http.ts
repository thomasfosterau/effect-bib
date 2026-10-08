/**
 * Shared `FetchHttpClient` stub for the source-client unit tests
 * (`tests/sources/*.test.ts`). Routes by exact URL so each test asserts
 * the precise path/query the client builds (the SSRF / percent-encoding
 * guard is part of what's under test), never touching the network.
 *
 * @module tests/unit/biblio-sources-stub-http
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/http";

export interface StubRoute {
  readonly status: number;
  readonly body: unknown;
}

/**
 * The `HttpClient` a per-source test should `yield*`, with
 * `HttpClient.filterStatusOk` applied — matching how `sources/service.ts`
 * actually composes the client before handing it to a source's lookup
 * function. Effect's `HttpClient` does **not** fail on non-2xx status by
 * default, so a test that `yield*`s the raw `HttpClient.HttpClient`
 * instead of this never exercises the `makeGet` 404 → `Option.none()` /
 * `LookupFailed` classification at all — a 4xx/5xx with a JSON body just
 * decodes as an ordinary "success". Use this everywhere a per-source test
 * needs a client, not the bare tag.
 */
export const filteredClient: Effect.Effect<HttpClient.HttpClient, never, HttpClient.HttpClient> =
  Effect.map(HttpClient.HttpClient, HttpClient.filterStatusOk);

/**
 * Builds a Layer providing a `FetchHttpClient` whose fetch routes by exact
 * URL. Unmapped URLs answer 404 (the natural "not found" a real upstream
 * would give for e.g. a follow-up author key we didn't stub). Every
 * requested URL is captured for path assertions, and every request's
 * `User-Agent` header (`""` when absent) for identity assertions.
 */
export function stubRouter(routes: Record<string, StubRoute>): {
  readonly urls: string[];
  readonly userAgents: string[];
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
} {
  const urls: string[] = [];
  const userAgents: string[] = [];
  const toJsonText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    urls.push(request.url);
    userAgents.push(request.headers.get("user-agent") ?? "");
    const route = routes[request.url];
    if (!route) {
      return new Response(toJsonText({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(toJsonText(route.body), {
      status: route.status,
      headers: { "content-type": "application/json" },
    });
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  return { urls, userAgents, layer };
}
