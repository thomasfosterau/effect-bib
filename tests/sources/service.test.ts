/**
 * Unit tests for the composed {@link BiblioLookup} service
 * (`src/sources/service.ts`, biblio B3, issue #1070).
 *
 * Covers both surfaces the module doc describes:
 * - the **pre-B3 flat shape** `byIsbn` / `byDoi` — kept for `apps/api`'s
 *   un-migrated `ingest.ts` consumer, now backed by the CSL-native source
 *   clients and collapsed through `cslRecordToIngestedRecord`;
 * - the **CSL-native additions** `byIsbnRecord` / `byDoiRecord` / `byTitle`.
 *
 * Reuses the live-recorded OpenLibrary/Crossref/OpenAlex fixtures from the
 * sibling per-source test files. The network is stubbed at
 * `FetchHttpClient.Fetch`; no test here reaches the network.
 *
 * @module tests/unit/biblio-sources-service
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  BiblioLookup,
  biblioLookupClientLayer,
  type IngestedRecord,
  InvalidIdentifier,
  LookupFailed,
} from "@thomasfosterau/biblio";
import { expectFailureInstanceOf, runTest } from "@test-helpers/effect";
import { stubRouter } from "./stub-http";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8"));

const ulyssesEdition = fixture("openlibrary-ulysses-edition.json");
const ulyssesAuthor = fixture("openlibrary-ulysses-author.json");
const rayResponse = fixture("crossref-ray-2004.json");
const searchResponse = fixture("openalex-search-sapiens.json");

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
  }).pipe(Effect.provide(biblioLookupClientLayer), Effect.provide(layer)) as Effect.Effect<
    A,
    E,
    never
  >;

// ── Legacy flat shape (apps/api compatibility) ─────────────────────────

describe("BiblioLookup.byIsbn (legacy)", () => {
  it("collapses the OpenLibrary CSL record into the flat IngestedRecord shape", async () => {
    const { layer } = stubRouter({
      "https://openlibrary.org/isbn/9780199535675.json": { status: 200, body: ulyssesEdition },
      "https://openlibrary.org/authors/OL31827A.json": { status: 200, body: ulyssesAuthor },
    });
    const result = (await runTest(
      withLookup(layer, (lookup) => lookup.byIsbn("978-0-19-953567-5")),
    )) as Option.Option<IngestedRecord>;
    const record = Option.getOrThrow(result);
    expect(record.source).toBe("openlibrary");
    expect(record.kind).toBe("book");
    expect(record.title).toBe("Ulysses");
    expect(record.authors).toEqual([{ name: "James Joyce" }]);
    expect(record.isbn13).toBe("9780199535675");
    expect(record.publicationYear).toBe(2008);
    expect(record.publisher).toBe("Oxford University Press");
    expect(record.doi).toBeNull();
  });

  it("returns Option.none on a clean 404", async () => {
    const { layer } = stubRouter({});
    const result = await runTest(withLookup(layer, (lookup) => lookup.byIsbn("9780199535675")));
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
      "https://openlibrary.org/isbn/9780199535675.json": { status: 503, body: {} },
    });
    await expectFailureInstanceOf(
      withLookup(layer, (lookup) => lookup.byIsbn("9780199535675")),
      LookupFailed,
    );
  });
});

describe("BiblioLookup.byDoi (legacy)", () => {
  const doi = "10.1037/0003-066x.59.1.29";

  it("collapses the Crossref CSL record into the flat IngestedRecord shape", async () => {
    const { layer } = stubRouter({
      [`https://api.crossref.org/works/${encodeURIComponent(doi)}`]: {
        status: 200,
        body: rayResponse,
      },
    });
    const result = (await runTest(
      withLookup(layer, (lookup) => lookup.byDoi(doi)),
    )) as Option.Option<IngestedRecord>;
    const record = Option.getOrThrow(result);
    expect(record.source).toBe("crossref");
    expect(record.kind).toBe("article");
    expect(record.title).toBe("How the Mind Hurts and Heals the Body.");
    expect(record.doi).toBe(doi);
    expect(record.publicationYear).toBe(2004);
    expect(record.authors).toEqual([{ name: "Oakley Ray" }]);
  });

  it("returns Option.none on a clean 404", async () => {
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
});

// ── CSL-native additions ────────────────────────────────────────────────

describe("BiblioLookup.byIsbnRecord", () => {
  it("resolves the same lookup as byIsbn but yields a CSL BiblioRecord", async () => {
    const { layer } = stubRouter({
      "https://openlibrary.org/isbn/9780199535675.json": { status: 200, body: ulyssesEdition },
      "https://openlibrary.org/authors/OL31827A.json": { status: 200, body: ulyssesAuthor },
    });
    const result = await runTest(
      withLookup(layer, (lookup) => lookup.byIsbnRecord("9780199535675")),
    );
    const record = Option.getOrThrow(result);
    expect(record.type).toBe("book");
    expect(record.identifiers.isbn).toBe("9780199535675");
  });
});

describe("BiblioLookup.byDoiRecord", () => {
  it("resolves the same lookup as byDoi but yields a CSL BiblioRecord", async () => {
    const doi = "10.1037/0003-066x.59.1.29";
    const { layer } = stubRouter({
      [`https://api.crossref.org/works/${encodeURIComponent(doi)}`]: {
        status: 200,
        body: rayResponse,
      },
    });
    const result = await runTest(withLookup(layer, (lookup) => lookup.byDoiRecord(doi)));
    const record = Option.getOrThrow(result);
    expect(record.type).toBe("article-journal");
    expect(record.identifiers.doi).toBe(doi);
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
