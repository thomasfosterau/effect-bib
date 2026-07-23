/**
 * Unit tests for the OpenAlex source client (`src/sources/openalex.ts`,
 * biblio B3, issue #1070) — the new modern scholarly-graph source.
 *
 * `openalex-ray-2004.json` is a **live-recorded fixture** (captured
 * 2026-07-23 from `https://api.openalex.org/works/doi:10.1037/0003-066x.59.1.29`)
 * — the OpenAlex side of the same Ray (2004) work `crossref.test.ts` uses,
 * exercised together in `coherence.test.ts`. `openalex-search-sapiens.json`
 * is a live-recorded `GET /works?search=...` envelope (captured the same
 * day) covering the search/ranked-candidates path, including a
 * `book-review` result type outside the modelled vocabulary (the
 * `document` fallback). The network is stubbed at `FetchHttpClient.Fetch`;
 * no test here reaches the network.
 *
 * @module tests/unit/biblio-sources-openalex
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { decodeDoi } from "@thomasfosterau/biblio";
import {
  lookupOpenAlexByDoi,
  normaliseOpenAlexRecord,
  searchOpenAlexByTitle,
  type OpenAlexWork,
} from "../../src/sources/openalex";
import { LookupFailed } from "../../src/sources/errors";
import { expectFailureInstanceOf, runTest } from "@test-helpers/effect";
import { filteredClient, stubRouter } from "./stub-http";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8"));

const rayWork = fixture("openalex-ray-2004.json") as OpenAlexWork;
const searchResponse = fixture("openalex-search-sapiens.json") as { results: unknown[] };
const REQUESTED_DOI = Option.getOrThrow(decodeDoi("10.1037/0003-066x.59.1.29"));
const MAILTO = "mailto=me%40thomasfoster.au";

describe("normaliseOpenAlexRecord", () => {
  it("normalises a real work into a CSL record: container, biblio, structured author", () => {
    const record = normaliseOpenAlexRecord(rayWork);
    expect(record).not.toBeNull();
    expect(record!.type).toBe("article-journal");
    expect(record!.title).toBe("How the Mind Hurts and Heals the Body.");
    expect(record!["container-title"]).toBe("American Psychologist");
    expect(record!.volume).toBe("59");
    expect(record!.issue).toBe("1");
    expect(record!.page).toBe("29-40");
    expect(record!.author).toEqual([{ family: "Ray", given: "Oakley S." }]);
    expect(record!.issued).toEqual({ "date-parts": [[2004]] });
    expect(record!.identifiers.doi).toBe(REQUESTED_DOI);
  });

  it("returns null for a work with no title or display_name", () => {
    expect(normaliseOpenAlexRecord({} as OpenAlexWork)).toBeNull();
  });

  it("falls back to display_name when title is absent", () => {
    const record = normaliseOpenAlexRecord({ display_name: "A Work" } as OpenAlexWork);
    expect(record!.title).toBe("A Work");
  });

  it("maps an unlisted OpenAlex type to the document fallback", () => {
    const record = normaliseOpenAlexRecord({ title: "X", type: "book-review" } as OpenAlexWork);
    expect(record!.type).toBe("document");
  });

  it("falls back to the deprecated host_venue when primary_location is absent", () => {
    const record = normaliseOpenAlexRecord({
      title: "X",
      host_venue: { display_name: "Old Venue" },
    } as unknown as OpenAlexWork);
    expect(record!["container-title"]).toBe("Old Venue");
  });

  it("omits doi/container-title/issued/author when the work carries none", () => {
    const record = normaliseOpenAlexRecord({ title: "X" } as OpenAlexWork)!;
    expect(record.identifiers.doi).toBeUndefined();
    expect(record["container-title"]).toBeUndefined();
    expect(record.issued).toBeUndefined();
    expect(record.author).toBeUndefined();
  });

  it("skips an authorship entry with no author display_name", () => {
    const record = normaliseOpenAlexRecord({
      title: "X",
      authorships: [{ author: {} }, { author: { display_name: "Ada Lovelace" } }],
    } as unknown as OpenAlexWork)!;
    expect(record.author).toEqual([{ family: "Lovelace", given: "Ada" }]);
  });

  it("drops an unusable echoed DOI rather than failing the record", () => {
    const record = normaliseOpenAlexRecord({ title: "X", doi: "not a doi url" } as OpenAlexWork)!;
    expect(record.identifiers.doi).toBeUndefined();
  });
});

describe("lookupOpenAlexByDoi", () => {
  it("resolves via the polite mailto-qualified doi: path", async () => {
    const path = `https://api.openalex.org/works/doi:${encodeURIComponent(REQUESTED_DOI)}?${MAILTO}`;
    const { urls, layer } = stubRouter({ [path]: { status: 200, body: rayWork } });
    const result = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenAlexByDoi(client, REQUESTED_DOI);
        }),
        layer,
      ),
    );
    expect(Option.isSome(result)).toBe(true);
    expect(Option.getOrThrow(result).title).toBe("How the Mind Hurts and Heals the Body.");
    expect(urls).toContain(path);
  });

  it("returns Option.none on a clean 404", async () => {
    const { layer } = stubRouter({});
    const result = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenAlexByDoi(client, REQUESTED_DOI);
        }),
        layer,
      ),
    );
    expect(Option.isNone(result)).toBe(true);
  });

  it("fails with LookupFailed on an upstream 5xx", async () => {
    const path = `https://api.openalex.org/works/doi:${encodeURIComponent(REQUESTED_DOI)}?${MAILTO}`;
    const { layer } = stubRouter({ [path]: { status: 503, body: {} } });
    await expectFailureInstanceOf(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenAlexByDoi(client, REQUESTED_DOI);
        }),
        layer,
      ),
      LookupFailed,
    );
  });
});

describe("searchOpenAlexByTitle", () => {
  it("returns ranked candidates from a real search envelope, skipping types outside the vocabulary gracefully", async () => {
    const path =
      "https://api.openalex.org/works?search=Sapiens&per-page=10&mailto=me%40thomasfoster.au";
    const { urls, layer } = stubRouter({ [path]: { status: 200, body: searchResponse } });
    const results = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, "Sapiens");
        }),
        layer,
      ),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.title.length > 0)).toBe(true);
    expect(urls).toContain(path);
  });

  it("returns [] when the search 404s", async () => {
    const { layer } = stubRouter({});
    const results = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, "nothing");
        }),
        layer,
      ),
    );
    expect(results).toEqual([]);
  });

  it("returns [] when results is absent", async () => {
    const path = "https://api.openalex.org/works?search=x&per-page=10&mailto=me%40thomasfoster.au";
    const { layer } = stubRouter({ [path]: { status: 200, body: {} } });
    const results = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, "x");
        }),
        layer,
      ),
    );
    expect(results).toEqual([]);
  });

  it("skips a malformed result entry rather than failing the whole search", async () => {
    const path = "https://api.openalex.org/works?search=x&per-page=10&mailto=me%40thomasfoster.au";
    const { layer } = stubRouter({
      [path]: { status: 200, body: { results: [null, "not an object", { title: "Real Work" }] } },
    });
    const results = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, "x");
        }),
        layer,
      ),
    );
    expect(results).toEqual([expect.objectContaining({ title: "Real Work" })]);
  });

  it("clamps an oversized query before building the URL", async () => {
    const longQuery = "a".repeat(1000);
    const { urls, layer } = stubRouter({});
    await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, longQuery);
        }),
        layer,
      ),
    );
    const requested = new URL(urls[0]!).searchParams.get("search")!;
    expect(requested.length).toBe(500);
  });
});
