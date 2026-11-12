/**
 * Unit tests for the composed {@link BiblioLookup} service
 * (`src/sources/service.ts`, biblio B3, website#1070).
 *
 * Covers the CSL-native surface `byIsbnRecord` / `byDoiRecord` / `byTitle`
 * (the pre-B3 flat `byIsbn` / `byDoi` compatibility methods were removed once
 * B4 (website#1071) migrated `apps/api`'s `ingest.ts` onto `byIsbnRecord`).
 *
 * Reuses the live-recorded OpenLibrary/Crossref/OpenAlex fixtures from the
 * sibling per-source test files. The network is stubbed at
 * `FetchHttpClient.Fetch`; no test here reaches the network.
 *
 * @module tests/unit/biblio-sources-service
 */

import { it } from "@effect/vitest";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import { FetchHttpClient } from "effect/http";
import {
  BiblioLookup,
  biblioLookupClientLayer,
  biblioLookupLayer,
  InvalidIdentifier,
  LookupFailed,
} from "@thomasfosterau/effect-bib/sources";
import { stubRouter, type StubRouter, withLayer } from "./stub-http.ts";
import { expectSome } from "../assert.ts";
import rayResponse from "../fixtures/crossref-ray-2004.json" with { type: "json" };
import searchResponse from "../fixtures/openalex-search-sapiens.json" with { type: "json" };
import ulyssesAuthor from "../fixtures/openlibrary-ulysses-author.json" with { type: "json" };
import ulyssesEdition from "../fixtures/openlibrary-ulysses-edition.json" with { type: "json" };

/** The contact every test layer is built with. */
const CONTACT = { product: "biblio-tests/0.0", email: "biblio+tests@example.org" } as const;
const lookupLayer = biblioLookupClientLayer({ contact: CONTACT });

/**
 * Builds the `BiblioLookup` program over a stub layer, **without running
 * it**: the test `yield*`s it for a happy path, or `Effect.flip`s it to
 * assert on the typed failure of an error path.
 */
const withLookup = <A, E>(
  layer: StubRouter["layer"],
  use: (lookup: BiblioLookup["Service"]) => Effect.Effect<A, E>,
): Effect.Effect<A, E, Scope.Scope> =>
  Effect.gen(function* () {
    const lookup = yield* BiblioLookup;
    return yield* use(lookup);
  }).pipe(withLayer(lookupLayer.pipe(Layer.provide(layer))));

// ── CSL-native surface ──────────────────────────────────────────────────

describe("BiblioLookup.byIsbnRecord", () => {
  it.effect("resolves an OpenLibrary ISBN lookup to a CSL BiblioRecord", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({
        "https://openlibrary.org/isbn/9780199535675.json": { status: 200, body: ulyssesEdition },
        "https://openlibrary.org/authors/OL31827A.json": { status: 200, body: ulyssesAuthor },
      });
      const result = yield* withLookup(layer, (lookup) => lookup.byIsbnRecord("978-0-19-953567-5"));
      const record = expectSome(result, "a record");
      expect(record.type).toBe("book");
      expect(record.title).toBe("Ulysses");
      expect(record.identifiers.isbn).toBe("9780199535675");
    }),
  );

  it.effect("returns Option.none on a clean 404", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({});
      const result = yield* withLookup(layer, (lookup) => lookup.byIsbnRecord("9780199535675"));
      expect(Option.isNone(result)).toBe(true);
    }),
  );

  it.effect("fails with InvalidIdentifier for a malformed ISBN", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({});
      expect(
        yield* Effect.flip(withLookup(layer, (lookup) => lookup.byIsbnRecord("not-an-isbn"))),
      ).toBeInstanceOf(InvalidIdentifier);
    }),
  );

  it.effect("fails with LookupFailed on an upstream 5xx", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({
        "https://openlibrary.org/isbn/9780199535675.json": { status: 503, body: {} },
      });
      expect(
        yield* Effect.flip(withLookup(layer, (lookup) => lookup.byIsbnRecord("9780199535675"))),
      ).toBeInstanceOf(LookupFailed);
    }),
  );
});

describe("BiblioLookup.byDoiRecord", () => {
  const doi = "10.1037/0003-066x.59.1.29";

  it.effect("resolves a Crossref DOI lookup to a CSL BiblioRecord", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({
        [`https://api.crossref.org/works/${encodeURIComponent(doi)}`]: {
          status: 200,
          body: rayResponse,
        },
      });
      const result = yield* withLookup(layer, (lookup) => lookup.byDoiRecord(doi));
      const record = expectSome(result, "a record");
      expect(record.type).toBe("article-journal");
      expect(record.title).toBe("How the Mind Hurts and Heals the Body.");
      expect(record.identifiers.doi).toBe(doi);
    }),
  );

  it.effect("returns Option.none on a clean 404", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({});
      const result = yield* withLookup(layer, (lookup) => lookup.byDoiRecord("10.9999/missing"));
      expect(Option.isNone(result)).toBe(true);
    }),
  );

  it.effect("fails with InvalidIdentifier for a malformed DOI", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({});
      expect(
        yield* Effect.flip(withLookup(layer, (lookup) => lookup.byDoiRecord("11.not/a-doi"))),
      ).toBeInstanceOf(InvalidIdentifier);
    }),
  );
});

/** A lookup client layer whose resolver answers `answer` for every host. */
const resolving = (answer: string) =>
  biblioLookupClientLayer({
    contact: CONTACT,
    resolveAddresses: () => Effect.succeed([answer]),
  });

describe("BiblioLookup.byDoiCsl", () => {
  const doi = "10.5281/zenodo.1234567";
  const url = "https://doi.org/10.5281/zenodo.1234567";

  it.effect("asks doi.org for CSL-JSON and reads it into a record", () =>
    Effect.gen(function* () {
      const { layer, urls, accepts, userAgents } = stubRouter({
        [url]: {
          status: 200,
          body: {
            type: "dataset",
            title: "A Dataset",
            DOI: doi,
            author: [{ family: "Doe", given: "Jane" }],
            issued: { "date-parts": [[2021]] },
            publisher: "Zenodo",
          },
        },
      });
      const record = expectSome(
        yield* withLookup(layer, (lookup) => lookup.byDoiCsl(doi)),
        "a record",
      );
      expect(urls).toEqual([url]);
      expect(accepts).toEqual(["application/vnd.citationstyles.csl+json"]);
      expect(userAgents[0]).toContain("biblio-tests/0.0");
      expect(record).toMatchObject({ type: "dataset", title: "A Dataset", publisher: "Zenodo" });
      expect(record.identifiers.doi).toBe(doi);
      expect(record.provenance).toEqual({
        source: "csl-json",
        retrievedBy: { identifierType: "doi", identifier: doi, endpoint: "https://doi.org" },
      });
    }),
  );

  it.effect("percent-encodes each path segment of the DOI", () =>
    Effect.gen(function* () {
      const odd = "10.1000/a#b?c";
      const { layer, urls } = stubRouter({});
      yield* withLookup(layer, (lookup) => lookup.byDoiCsl(odd));
      expect(urls).toEqual(["https://doi.org/10.1000/a%23b%3Fc"]);
    }),
  );

  it.effect("returns Option.none on a clean 404 and fails with LookupFailed on a 5xx", () =>
    Effect.gen(function* () {
      const missing = stubRouter({});
      expect(
        Option.isNone(yield* withLookup(missing.layer, (lookup) => lookup.byDoiCsl(doi))),
      ).toBe(true);
      const down = stubRouter({ [url]: { status: 503, body: {} } });
      const failure = yield* Effect.flip(withLookup(down.layer, (lookup) => lookup.byDoiCsl(doi)));
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure).toMatchObject({ source: "doi" });
    }),
  );

  it.effect(
    "follows a redirect to a registration agency by hand, never letting fetch follow it",
    () =>
      Effect.gen(function* () {
        const agency = "https://api.crossref.org/v1/works/10.5281%2Fzenodo.1234567/transform";
        const { layer, urls, redirects } = stubRouter({
          [url]: { status: 302, body: {}, location: agency },
          [agency]: { status: 200, body: { type: "dataset", title: "Via Crossref", DOI: doi } },
        });
        const record = expectSome(
          yield* withLookup(layer, (lookup) => lookup.byDoiCsl(doi)),
          "a record",
        );
        expect(record.title).toBe("Via Crossref");
        expect(urls).toEqual([url, agency]);
        expect(redirects).toEqual(["manual", "manual"]);
      }),
  );

  it.effect.each([
    ["an internal host", "http://169.254.169.254/latest/meta-data/"],
    ["a loopback address over https", "https://127.0.0.1/admin"],
    ["an unknown host", "https://evil.example/record"],
    ["plain http to an agency", "http://api.crossref.org/works/x"],
    ["an agency with credentials", "https://user:pw@api.crossref.org/works/x"],
    ["an agency on another port", "https://api.crossref.org:8443/works/x"],
    ["an unparseable location", "https://[bad"],
  ])("refuses a redirect to %s", ([, location]) =>
    Effect.gen(function* () {
      const { layer, urls } = stubRouter({ [url]: { status: 302, body: {}, location } });
      const failure = yield* Effect.flip(withLookup(layer, (lookup) => lookup.byDoiCsl(doi)));
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure).toMatchObject({ source: "doi" });
      expect(urls).toEqual([url]);
    }),
  );

  it.effect("fails on a redirect loop, a redirect without a location and a non-JSON body", () =>
    Effect.gen(function* () {
      const loop = stubRouter({ [url]: { status: 302, body: {}, location: url } });
      expect(
        yield* Effect.flip(withLookup(loop.layer, (lookup) => lookup.byDoiCsl(doi))),
      ).toBeInstanceOf(LookupFailed);
      expect(loop.urls).toHaveLength(6);
      const bare = stubRouter({ [url]: { status: 303, body: {} } });
      expect(
        yield* Effect.flip(withLookup(bare.layer, (lookup) => lookup.byDoiCsl(doi))),
      ).toBeInstanceOf(LookupFailed);
      const html = stubRouter({ [url]: { status: 200, body: {}, raw: "<html>not json</html>" } });
      expect(
        yield* Effect.flip(withLookup(html.layer, (lookup) => lookup.byDoiCsl(doi))),
      ).toBeInstanceOf(LookupFailed);
    }),
  );

  it.effect("holds a redirect to an agency host to the configured resolver", () =>
    Effect.gen(function* () {
      const agency = "https://api.crossref.org/v1/works/10.5281%2Fzenodo.1234567/transform";
      const { layer, urls } = stubRouter({
        [url]: { status: 302, body: {}, location: agency },
        [agency]: { status: 200, body: { type: "dataset", title: "Rebound" } },
      });
      const refused = Effect.gen(function* () {
        const lookup = yield* BiblioLookup;
        return yield* lookup.byDoiCsl(doi);
      }).pipe(withLayer(resolving("127.0.0.1").pipe(Layer.provide(layer))));
      const failure = yield* Effect.flip(refused);
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure).toMatchObject({ source: "doi" });
      expect(urls).toEqual([url]);
      const allowed = Effect.gen(function* () {
        const lookup = yield* BiblioLookup;
        return yield* lookup.byDoiCsl(doi);
      }).pipe(withLayer(resolving("104.18.0.1").pipe(Layer.provide(layer))));
      expect(expectSome(yield* allowed, "a record").title).toBe("Rebound");
    }),
  );

  it.effect("refuses a CSL-JSON body declared larger than the input cap", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({
        [url]: { status: 200, body: {}, headers: { "content-length": "8000001" } },
      });
      const failure = yield* Effect.flip(withLookup(layer, (lookup) => lookup.byDoiCsl(doi)));
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure).toMatchObject({ description: expect.stringContaining("larger than") });
    }),
  );

  it.effect("fails with InvalidIdentifier for a malformed DOI, before any request", () =>
    Effect.gen(function* () {
      const { layer, urls } = stubRouter({});
      expect(
        yield* Effect.flip(withLookup(layer, (lookup) => lookup.byDoiCsl("11.not/a-doi"))),
      ).toBeInstanceOf(InvalidIdentifier);
      expect(urls).toEqual([]);
    }),
  );
});

describe("BiblioLookup.byTitle", () => {
  it.effect("returns ranked OpenAlex candidates for a title search", () =>
    Effect.gen(function* () {
      const path =
        "https://api.openalex.org/works?search=Sapiens&per-page=10&mailto=biblio%2Btests%40example.org";
      const { layer } = stubRouter({ [path]: { status: 200, body: searchResponse } });
      const results = yield* withLookup(layer, (lookup) => lookup.byTitle("Sapiens"));
      expect(results.length).toBeGreaterThan(0);
    }),
  );

  it.effect("never fails on an empty result set", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({});
      const results = yield* withLookup(layer, (lookup) => lookup.byTitle("nothing matches this"));
      expect(results).toEqual([]);
    }),
  );
});

describe("BiblioLookup key", () => {
  it("is namespaced to the package", () => {
    expect(BiblioLookup.key).toBe("@thomasfosterau/effect-bib/BiblioLookup");
  });
});

describe("BiblioLookup contact", () => {
  const userAgent = "biblio-tests/0.0 (mailto:biblio+tests@example.org)";

  it.effect("sends the configured User-Agent to every source", () =>
    Effect.gen(function* () {
      const { userAgents, layer } = stubRouter({});
      yield* withLookup(layer, (lookup) =>
        Effect.all(
          [
            lookup.byIsbnRecord("9780199535675"),
            lookup.byDoiRecord("10.9999/missing"),
            lookup.byTitle("Sapiens"),
          ],
          { concurrency: 1 },
        ),
      );
      expect(userAgents).toEqual([userAgent, userAgent, userAgent]);
    }),
  );

  it.effect("sends the configured address as OpenAlex's mailto", () =>
    Effect.gen(function* () {
      const { urls, layer } = stubRouter({});
      yield* withLookup(layer, (lookup) => lookup.byTitle("Sapiens"));
      const mailto = new URL(expectSome(Arr.head(urls), "a requested URL")).searchParams.get(
        "mailto",
      );
      expect(mailto).toBe(CONTACT.email);
    }),
  );

  it.effect("identifies each layer by its own contact", () =>
    Effect.gen(function* () {
      const { userAgents, layer } = stubRouter({});
      const other = biblioLookupClientLayer({
        contact: { product: "other-app/2.1", email: "someone@example.net" },
      });
      yield* Effect.gen(function* () {
        const lookup = yield* BiblioLookup;
        return yield* lookup.byIsbnRecord("9780199535675");
      }).pipe(withLayer(other.pipe(Layer.provide(layer))));
      expect(userAgents).toEqual(["other-app/2.1 (mailto:someone@example.net)"]);
    }),
  );
});

describe("biblioLookupLayer", () => {
  // The production layer brings its own `FetchHttpClient`, so the stub goes
  // in at `FetchHttpClient.Fetch`, which that client reads on every request.
  // The global `fetch` is swapped for one that answers a network error, so a
  // request that bypassed the stub fails the lookup rather than reaching the
  // network.
  const unreachable = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.error()));
  beforeEach(() => {
    vi.stubGlobal("fetch", unreachable);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    unreachable.mockClear();
  });

  it.effect("serves BiblioLookup over FetchHttpClient, identified by its contact", () =>
    Effect.gen(function* () {
      const editionUrl = "https://openlibrary.org/isbn/9780199535675.json";
      const authorUrl = "https://openlibrary.org/authors/OL31827A.json";
      const { urls, userAgents, fetch } = stubRouter({
        [editionUrl]: { status: 200, body: ulyssesEdition },
        [authorUrl]: { status: 200, body: ulyssesAuthor },
      });
      const result = yield* Effect.gen(function* () {
        const lookup = yield* BiblioLookup;
        return yield* lookup.byIsbnRecord("978-0-19-953567-5");
      }).pipe(
        withLayer(biblioLookupLayer({ contact: CONTACT })),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );
      expect(expectSome(result, "a record").title).toBe("Ulysses");
      expect(urls).toEqual([editionUrl, authorUrl]);
      const userAgent = "biblio-tests/0.0 (mailto:biblio+tests@example.org)";
      expect(userAgents).toEqual([userAgent, userAgent]);
      expect(unreachable).not.toHaveBeenCalled();
    }),
  );
});
