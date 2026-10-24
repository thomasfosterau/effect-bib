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
  /** A `Location` header, for a redirect. */
  readonly location?: string;
  /** A body sent as written instead of `body` as JSON. */
  readonly raw?: string;
}

/**
 * The `HttpClient` a per-source test should `yield*`, with
 * `HttpClient.filterStatusOk` applied — matching how `sources/service.ts`
 * actually composes the client before handing it to a source's lookup
 * function. Effect's `HttpClient` does **not** fail on non-2xx status by
 * default, so a test that `yield*`s the raw `HttpClient.HttpClient`
 * instead of this never exercises the `jsonGet` 404 → `Option.none()` /
 * `LookupFailed` classification at all — a 4xx/5xx with a JSON body just
 * decodes as an ordinary "success". Use this everywhere a per-source test
 * needs a client, not the bare tag.
 */
export const filteredClient: Effect.Effect<HttpClient.HttpClient, never, HttpClient.HttpClient> =
  Effect.map(HttpClient.HttpClient, HttpClient.filterStatusOk);

/** What {@link stubRouter} hands a test: the captured requests, the routing fetch and its layer. */
export interface StubRouter {
  readonly urls: string[];
  readonly userAgents: string[];
  readonly accepts: string[];
  /** Each request's `redirect` mode (`"follow"`, fetch's default, when unset). */
  readonly redirects: string[];
  readonly fetch: typeof globalThis.fetch;
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
}

/**
 * Builds a Layer providing a `FetchHttpClient` whose fetch routes by exact
 * URL. Unmapped URLs answer 404 (the natural "not found" a real upstream
 * would give for e.g. a follow-up author key we didn't stub). Every
 * requested URL is captured for path assertions, and every request's
 * `User-Agent` and `Accept` header (`""` when absent) for identity and
 * negotiation assertions. `fetch`
 * is the routing function itself, for a test that overrides
 * `FetchHttpClient.Fetch` under a layer that supplies its own
 * `FetchHttpClient`.
 */
export function stubRouter(routes: Record<string, StubRoute>): StubRouter {
  const urls: string[] = [];
  const userAgents: string[] = [];
  const accepts: string[] = [];
  const redirects: string[] = [];
  const toJsonText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    urls.push(request.url);
    userAgents.push(request.headers.get("user-agent") ?? "");
    accepts.push(request.headers.get("accept") ?? "");
    redirects.push(init?.redirect ?? "follow");
    const route = routes[request.url];
    if (!route) {
      return new Response(toJsonText({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const headers = new Headers({ "content-type": "application/json" });
    if (route.location !== undefined) headers.set("location", route.location);
    return new Response(route.raw ?? toJsonText(route.body), { status: route.status, headers });
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  return { urls, userAgents, accepts, redirects, fetch, layer };
}
