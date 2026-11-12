/**
 * Unit tests for the OpenAlex source client (`src/sources/openalex.ts`,
 * biblio B3, website#1070) — the new modern scholarly-graph source.
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

import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { decodeDoi } from "@thomasfosterau/effect-bib";
import {
  lookupOpenAlexByDoi,
  normaliseOpenAlexRecord,
  OpenAlexWork,
  searchOpenAlexByTitle,
} from "../../src/sources/openalex.ts";
import { LookupFailed } from "../../src/sources/errors.ts";
import { filteredClient, stubRouter, withLayer } from "./stub-http.ts";
import { expectSome } from "../assert.ts";
import rayWorkBody from "../fixtures/openalex-ray-2004.json" with { type: "json" };
import searchResponse from "../fixtures/openalex-search-sapiens.json" with { type: "json" };

/** Decodes a loose object literal through the lenient `Work` schema. */
const asWork = Schema.decodeUnknownSync(OpenAlexWork);

const rayWork = asWork(rayWorkBody);
const REQUESTED_DOI = expectSome(decodeDoi("10.1037/0003-066x.59.1.29"), "a DOI");
/** A contact whose address needs percent-encoding (`+` and `@`). */
const CONTACT = { product: "biblio-tests/0.0", email: "biblio+tests@example.org" } as const;
const MAILTO = "mailto=biblio%2Btests%40example.org";

describe("normaliseOpenAlexRecord", () => {
  it("normalises a real work into a CSL record: container, biblio, structured author", () => {
    const record = expectSome(normaliseOpenAlexRecord(rayWork), "a record");
    expect(record.type).toBe("article-journal");
    expect(record.title).toBe("How the Mind Hurts and Heals the Body.");
    expect(record["container-title"]).toBe("American Psychologist");
    expect(record.volume).toBe("59");
    expect(record.issue).toBe("1");
    expect(record.page).toBe("29-40");
    expect(record.author).toEqual([{ family: "Ray", given: "Oakley S." }]);
    expect(record.issued).toEqual({ "date-parts": [[2004]] });
    expect(record.identifiers.doi).toBe(REQUESTED_DOI);
  });

  it("returns null for a work with no title or display_name", () => {
    expect(normaliseOpenAlexRecord(asWork({}))).toStrictEqual(Option.none());
  });

  it("falls back to display_name when title is absent", () => {
    const record = expectSome(normaliseOpenAlexRecord(asWork({ display_name: "A Work" })));
    expect(record.title).toBe("A Work");
  });

  it("maps an unlisted OpenAlex type to the document fallback", () => {
    const record = expectSome(normaliseOpenAlexRecord(asWork({ title: "X", type: "book-review" })));
    expect(record.type).toBe("document");
  });

  it("never reads an inherited object key as a type mapping", () => {
    const record = expectSome(normaliseOpenAlexRecord(asWork({ title: "X", type: "constructor" })));
    expect(record.type).toBe("document");
  });

  it("uses the first page alone when the work has no last page", () => {
    const record = expectSome(
      normaliseOpenAlexRecord(asWork({ title: "X", biblio: { volume: "3", first_page: "7" } })),
    );
    expect(record.volume).toBe("3");
    expect(record.page).toBe("7");
  });

  it("falls back to the deprecated host_venue when primary_location is absent", () => {
    const record = expectSome(
      normaliseOpenAlexRecord(asWork({ title: "X", host_venue: { display_name: "Old Venue" } })),
    );
    expect(record["container-title"]).toBe("Old Venue");
  });

  it("omits doi/container-title/issued/author when the work carries none", () => {
    const record = expectSome(normaliseOpenAlexRecord(asWork({ title: "X" })));
    expect(record.identifiers.doi).toBeUndefined();
    expect(record["container-title"]).toBeUndefined();
    expect(record.issued).toBeUndefined();
    expect(record.author).toBeUndefined();
  });

  it("skips an authorship entry with no author display_name", () => {
    const record = expectSome(
      normaliseOpenAlexRecord(
        asWork({
          title: "X",
          authorships: [{ author: {} }, { author: { display_name: "Ada Lovelace" } }],
        }),
      ),
    );
    expect(record.author).toEqual([{ family: "Lovelace", given: "Ada" }]);
  });

  it("drops an unusable echoed DOI rather than failing the record", () => {
    const record = expectSome(
      normaliseOpenAlexRecord(asWork({ title: "X", doi: "not a doi url" })),
    );
    expect(record.identifiers.doi).toBeUndefined();
  });
});

describe("lookupOpenAlexByDoi", () => {
  it.effect("resolves via the doi: path qualified with the caller's encoded mailto", () =>
    Effect.gen(function* () {
      const path = `https://api.openalex.org/works/doi:${encodeURIComponent(REQUESTED_DOI)}?${MAILTO}`;
      const { urls, layer } = stubRouter({ [path]: { status: 200, body: rayWork } });
      const result = yield* withLayer(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenAlexByDoi(client, REQUESTED_DOI, CONTACT);
        }),
        layer,
      );
      expect(Option.isSome(result)).toBe(true);
      expect(expectSome(result).title).toBe("How the Mind Hurts and Heals the Body.");
      expect(urls).toContain(path);
    }),
  );

  it.effect("returns Option.none on a clean 404", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({});
      const result = yield* withLayer(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenAlexByDoi(client, REQUESTED_DOI, CONTACT);
        }),
        layer,
      );
      expect(Option.isNone(result)).toBe(true);
    }),
  );

  it.effect("fails with LookupFailed on an upstream 5xx", () =>
    Effect.gen(function* () {
      const path = `https://api.openalex.org/works/doi:${encodeURIComponent(REQUESTED_DOI)}?${MAILTO}`;
      const { layer } = stubRouter({ [path]: { status: 503, body: {} } });
      expect(
        yield* Effect.flip(
          withLayer(
            Effect.gen(function* () {
              const client = yield* filteredClient;
              return yield* lookupOpenAlexByDoi(client, REQUESTED_DOI, CONTACT);
            }),
            layer,
          ),
        ),
      ).toBeInstanceOf(LookupFailed);
    }),
  );
});

describe("searchOpenAlexByTitle", () => {
  it.effect(
    "returns ranked candidates from a real search envelope, skipping types outside the vocabulary gracefully",
    () =>
      Effect.gen(function* () {
        const path = `https://api.openalex.org/works?search=Sapiens&per-page=10&${MAILTO}`;
        const { urls, layer } = stubRouter({ [path]: { status: 200, body: searchResponse } });
        const results = yield* withLayer(
          Effect.gen(function* () {
            const client = yield* filteredClient;
            return yield* searchOpenAlexByTitle(client, "Sapiens", CONTACT);
          }),
          layer,
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((r) => (r.title?.length ?? 0) > 0)).toBe(true);
        expect(urls).toContain(path);
      }),
  );

  it.effect("returns [] when the search 404s", () =>
    Effect.gen(function* () {
      const { layer } = stubRouter({});
      const results = yield* withLayer(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, "nothing", CONTACT);
        }),
        layer,
      );
      expect(results).toEqual([]);
    }),
  );

  it.effect("returns [] when results is absent", () =>
    Effect.gen(function* () {
      const path = `https://api.openalex.org/works?search=x&per-page=10&${MAILTO}`;
      const { layer } = stubRouter({ [path]: { status: 200, body: {} } });
      const results = yield* withLayer(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, "x", CONTACT);
        }),
        layer,
      );
      expect(results).toEqual([]);
    }),
  );

  it.effect("skips a malformed result entry rather than failing the whole search", () =>
    Effect.gen(function* () {
      const path = `https://api.openalex.org/works?search=x&per-page=10&${MAILTO}`;
      const { layer } = stubRouter({
        [path]: { status: 200, body: { results: [null, "not an object", { title: "Real Work" }] } },
      });
      const results = yield* withLayer(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, "x", CONTACT);
        }),
        layer,
      );
      expect(results).toEqual([expect.objectContaining({ title: "Real Work" })]);
    }),
  );

  it.effect("clamps an oversized query before building the URL", () =>
    Effect.gen(function* () {
      const longQuery = "a".repeat(1000);
      const { urls, layer } = stubRouter({});
      yield* withLayer(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, longQuery, CONTACT);
        }),
        layer,
      );
      const requested = expectSome(
        Option.fromNullishOr(
          new URL(expectSome(Arr.head(urls), "a requested URL")).searchParams.get("search"),
        ),
        "a search parameter",
      );
      expect(requested.length).toBe(500);
    }),
  );

  it.effect("sends the caller's contact address as the mailto parameter", () =>
    Effect.gen(function* () {
      const { urls, layer } = stubRouter({});
      yield* withLayer(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* searchOpenAlexByTitle(client, "x", CONTACT);
        }),
        layer,
      );
      const mailto = new URL(expectSome(Arr.head(urls), "a requested URL")).searchParams.get(
        "mailto",
      );
      expect(mailto).toBe(CONTACT.email);
    }),
  );
});
