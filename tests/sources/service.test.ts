/**
 * Unit tests for the composed {@link BiblioLookup} service
 * (`src/sources/service.ts`, biblio B3, issue #1070).
 *
 * Covers the CSL-native surface `byIsbnRecord` / `byDoiRecord` / `byTitle`
 * (the pre-B3 flat `byIsbn` / `byDoi` compatibility methods were removed once
 * B4 (#1071) migrated `apps/api`'s `ingest.ts` onto `byIsbnRecord`).
 *
 * Reuses the live-recorded OpenLibrary/Crossref/OpenAlex fixtures from the
 * sibling per-source test files. The network is stubbed at
 * `FetchHttpClient.Fetch`; no test here reaches the network.
 *
 * @module tests/unit/biblio-sources-service
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  BiblioLookup,
  biblioLookupClientLayer,
  InvalidIdentifier,
  LookupFailed,
} from "@thomasfosterau/biblio";
import { expectFailureInstanceOf, runTest } from "@thomasfosterau/test-helpers/effect";
import { stubRouter } from "./stub-http.ts";
import { expectSome } from "../assert.ts";
import rayResponse from "../fixtures/crossref-ray-2004.json" with { type: "json" };
import searchResponse from "../fixtures/openalex-search-sapiens.json" with { type: "json" };
import ulyssesAuthor from "../fixtures/openlibrary-ulysses-author.json" with { type: "json" };
import ulyssesEdition from "../fixtures/openlibrary-ulysses-edition.json" with { type: "json" };

/**
 * Builds the `BiblioLookup` program over a stub layer, **without running
 * it** — returns the raw `Effect`, exactly as the pre-B3 `lookup.test.ts`
 * did. Callers `runTest` the happy paths and pass the un-run Effect
 * straight to `expectFailureInstanceOf` for the failure paths (which runs
 * it itself via `Effect.runPromiseExit`); running it here first would hand
 * `expectFailureInstanceOf` an already-settled `Promise` instead of an
 * `Effect`, and `Effect.runPromiseExit` on a non-Effect value dies with
 * "Not a valid effect" — a **defect**, not the typed `Fail` the assertion
 * is looking for.
 */
const withLookup = <A, E>(
  layer: ReturnType<typeof stubRouter>["layer"],
  use: (lookup: BiblioLookup["Service"]) => Effect.Effect<A, E>,
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const lookup = yield* BiblioLookup;
    return yield* use(lookup);
  }).pipe(Effect.provide(biblioLookupClientLayer.pipe(Layer.provide(layer)))) as Effect.Effect<
    A,
    E,
    never
  >;

// ── CSL-native surface ──────────────────────────────────────────────────

describe("BiblioLookup.byIsbnRecord", () => {
  it("resolves an OpenLibrary ISBN lookup to a CSL BiblioRecord", async () => {
    const { layer } = stubRouter({
      "https://openlibrary.org/isbn/9780199535675.json": { status: 200, body: ulyssesEdition },
      "https://openlibrary.org/authors/OL31827A.json": { status: 200, body: ulyssesAuthor },
    });
    const result = await runTest(
      withLookup(layer, (lookup) => lookup.byIsbnRecord("978-0-19-953567-5")),
    );
    const record = expectSome(result, "a record");
    expect(record.type).toBe("book");
    expect(record.title).toBe("Ulysses");
    expect(record.identifiers.isbn).toBe("9780199535675");
  });

  it("returns Option.none on a clean 404", async () => {
    const { layer } = stubRouter({});
    const result = await runTest(
      withLookup(layer, (lookup) => lookup.byIsbnRecord("9780199535675")),
    );
    expect(Option.isNone(result)).toBe(true);
  });

  it("fails with InvalidIdentifier for a malformed ISBN", async () => {
    const { layer } = stubRouter({});
    await expectFailureInstanceOf(
      withLookup(layer, (lookup) => lookup.byIsbnRecord("not-an-isbn")),
      InvalidIdentifier,
    );
  });

  it("fails with LookupFailed on an upstream 5xx", async () => {
    const { layer } = stubRouter({
      "https://openlibrary.org/isbn/9780199535675.json": { status: 503, body: {} },
    });
    await expectFailureInstanceOf(
      withLookup(layer, (lookup) => lookup.byIsbnRecord("9780199535675")),
      LookupFailed,
    );
  });
});

describe("BiblioLookup.byDoiRecord", () => {
  const doi = "10.1037/0003-066x.59.1.29";

  it("resolves a Crossref DOI lookup to a CSL BiblioRecord", async () => {
    const { layer } = stubRouter({
      [`https://api.crossref.org/works/${encodeURIComponent(doi)}`]: {
        status: 200,
        body: rayResponse,
      },
    });
    const result = await runTest(withLookup(layer, (lookup) => lookup.byDoiRecord(doi)));
    const record = expectSome(result, "a record");
    expect(record.type).toBe("article-journal");
    expect(record.title).toBe("How the Mind Hurts and Heals the Body.");
    expect(record.identifiers.doi).toBe(doi);
  });

  it("returns Option.none on a clean 404", async () => {
    const { layer } = stubRouter({});
    const result = await runTest(
      withLookup(layer, (lookup) => lookup.byDoiRecord("10.9999/missing")),
    );
    expect(Option.isNone(result)).toBe(true);
  });

  it("fails with InvalidIdentifier for a malformed DOI", async () => {
    const { layer } = stubRouter({});
    await expectFailureInstanceOf(
      withLookup(layer, (lookup) => lookup.byDoiRecord("11.not/a-doi")),
      InvalidIdentifier,
    );
  });
});

describe("BiblioLookup.byTitle", () => {
  it("returns ranked OpenAlex candidates for a title search", async () => {
    const path =
      "https://api.openalex.org/works?search=Sapiens&per-page=10&mailto=me%40thomasfoster.au";
    const { layer } = stubRouter({ [path]: { status: 200, body: searchResponse } });
    const results = await runTest(withLookup(layer, (lookup) => lookup.byTitle("Sapiens")));
    expect(results.length).toBeGreaterThan(0);
  });

  it("never fails on an empty result set", async () => {
    const { layer } = stubRouter({});
    const results = await runTest(
      withLookup(layer, (lookup) => lookup.byTitle("nothing matches this")),
    );
    expect(results).toEqual([]);
  });
});
