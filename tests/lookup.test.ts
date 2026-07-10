/**
 * Unit tests for the bibliographic lookup service
 * (`src/lib/server/biblio/lookup.ts`).
 *
 * The network is stubbed at `FetchHttpClient.Fetch` with a per-URL
 * router, so the tests exercise the full request-building,
 * schema-decoding, author-resolution, and normalisation pipeline while
 * never reaching the network. No database.
 *
 * Covered:
 * - ISBN happy path (edition + author follow-up requests, response map);
 * - DOI happy path (percent-encoded path, response map);
 * - upstream 404 -> Option.none;
 * - invalid identifier -> InvalidIdentifier on the typed channel;
 * - upstream 5xx / malformed body -> LookupFailed.
 *
 * @module tests/unit/biblio-lookup
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/unstable/http";
import {
  BiblioLookup,
  biblioLookupClientLayer,
  type IngestedRecord,
  InvalidIdentifier,
  LookupFailed,
} from "@thomasfosterau/biblio";
import { expectFailureInstanceOf, runTest } from "@test-helpers/effect";

// ── Fetch router stub ────────────────────────────────────────────────

interface StubRoute {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Builds a Layer providing a `FetchHttpClient` whose fetch routes by
 * exact URL. Unmapped URLs answer 404 (the natural "not found"). Each
 * requested URL is captured for path assertions.
 */
const stubRouter = (routes: Record<string, StubRoute>) => {
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    urls.push(request.url);
    const route = routes[request.url];
    if (!route) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "content-type": "application/json" },
    });
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  return { urls, layer };
};

type LookupResult = Option.Option<IngestedRecord>;

const withLookup = <E>(
  layer: Layer.Layer<FetchHttpClient.HttpClient>,
  use: (lookup: {
    readonly byIsbn: (isbn: string) => Effect.Effect<LookupResult, E>;
    readonly byDoi: (doi: string) => Effect.Effect<LookupResult, E>;
  }) => Effect.Effect<LookupResult, E>,
): Effect.Effect<LookupResult, E, never> =>
  Effect.gen(function* () {
    const lookup = yield* BiblioLookup;
    return yield* use(lookup);
  }).pipe(Effect.provide(biblioLookupClientLayer), Effect.provide(layer)) as Effect.Effect<
    LookupResult,
    E,
    never
  >;

// ── ISBN ─────────────────────────────────────────────────────────────

describe("BiblioLookup.byIsbn", () => {
  it("resolves the edition and its authors, mapping to a neutral record", async () => {
    const { urls, layer } = stubRouter({
      "https://openlibrary.org/isbn/9780062316097.json": {
        status: 200,
        body: {
          title: "Sapiens",
          publish_date: "2015",
          publishers: ["Harper"],
          isbn_13: ["9780062316097"],
          authors: [{ key: "/authors/OL1A" }],
        },
      },
      "https://openlibrary.org/authors/OL1A.json": {
        status: 200,
        body: { name: "Yuval Noah Harari" },
      },
    });

    const result = await runTest(withLookup(layer, (lookup) => lookup.byIsbn("978-0-06-231609-7")));

    expect(Option.isSome(result)).toBe(true);
    const record = Option.getOrThrow(result);
    expect(record.title).toBe("Sapiens");
    expect(record.authorityId).toBe("9780062316097");
    expect(record.authors).toEqual([{ name: "Yuval Noah Harari" }]);
    // The edition request used the normalised (punctuation-stripped) ISBN.
    expect(urls).toContain("https://openlibrary.org/isbn/9780062316097.json");
  });

  it("returns Option.none when OpenLibrary 404s", async () => {
    const { layer } = stubRouter({});
    const result = await runTest(withLookup(layer, (lookup) => lookup.byIsbn("9780062316097")));
    expect(Option.isNone(result)).toBe(true);
  });

  it("fails with InvalidIdentifier for a malformed ISBN", async () => {
    const { layer } = stubRouter({});
    await expectFailureInstanceOf(
      withLookup(layer, (lookup) => lookup.byIsbn("not-an-isbn")),
      InvalidIdentifier,
    );
  });

  it("fails with LookupFailed on an upstream 5xx", async () => {
    const { layer } = stubRouter({
      "https://openlibrary.org/isbn/9780062316097.json": { status: 503, body: {} },
    });
    await expectFailureInstanceOf(
      withLookup(layer, (lookup) => lookup.byIsbn("9780062316097")),
      LookupFailed,
    );
  });
});

// ── DOI ──────────────────────────────────────────────────────────────

describe("BiblioLookup.byDoi", () => {
  it("resolves a DOI via the percent-encoded Crossref path", async () => {
    const doi = "10.1037/0003-066x.59.1.29";
    const { urls, layer } = stubRouter({
      [`https://api.crossref.org/works/${encodeURIComponent(doi)}`]: {
        status: 200,
        body: {
          message: {
            DOI: doi,
            title: ["A Work"],
            author: [{ given: "Ada", family: "Lovelace" }],
            issued: { "date-parts": [[1843]] },
          },
        },
      },
    });

    const result = await runTest(withLookup(layer, (lookup) => lookup.byDoi(doi)));

    const record = Option.getOrThrow(result);
    expect(record.kind).toBe("article");
    expect(record.title).toBe("A Work");
    expect(record.doi).toBe(doi);
    expect(record.publicationYear).toBe(1843);
    expect(urls[0]).toBe(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  });

  it("returns Option.none when Crossref 404s", async () => {
    const { layer } = stubRouter({});
    const result = await runTest(withLookup(layer, (lookup) => lookup.byDoi("10.9999/missing")));
    expect(Option.isNone(result)).toBe(true);
  });

  it("fails with InvalidIdentifier for a malformed DOI", async () => {
    const { layer } = stubRouter({});
    await expectFailureInstanceOf(
      withLookup(layer, (lookup) => lookup.byDoi("11.not/a-doi")),
      InvalidIdentifier,
    );
  });

  it("fails with LookupFailed when the body has the wrong shape", async () => {
    const doi = "10.9999/a";
    const { layer } = stubRouter({
      [`https://api.crossref.org/works/${encodeURIComponent(doi)}`]: {
        status: 200,
        // `message` must be an object; a string trips the schema decode.
        body: { message: "not an object" },
      },
    });
    await expectFailureInstanceOf(
      withLookup(layer, (lookup) => lookup.byDoi(doi)),
      LookupFailed,
    );
  });
});
