/**
 * Unit tests for the Crossref CSL-native source client
 * (`src/sources/crossref.ts`, biblio B3, issue #1070).
 *
 * `crossref-ray-2004.json` is a **live-recorded fixture** (captured
 * 2026-07-23 from `https://api.crossref.org/works/10.1037%2F0003-066x.59.1.29`)
 * — Ray (2004), "How the Mind Hurts and Heals the Body.", also used by
 * `openalex.test.ts`'s cross-source companion fixture for the dedup
 * coherence proof in `coherence.test.ts`. The network is stubbed at
 * `FetchHttpClient.Fetch`; no test here reaches the network.
 *
 * @module tests/unit/biblio-sources-crossref
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { decodeDoi } from "@thomasfosterau/biblio";
import {
  CrossrefResponse,
  lookupCrossrefByDoi,
  normaliseCrossrefRecord,
} from "../../src/sources/crossref";
import { LookupFailed } from "../../src/sources/errors";
import { expectFailureInstanceOf, runTest } from "@test-helpers/effect";
import { filteredClient, stubRouter } from "./stub-http";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8"));

const rayResponseBody = fixture("crossref-ray-2004.json");
const decodeResponse = Schema.decodeUnknownSync(CrossrefResponse);
const REQUESTED_DOI = Option.getOrThrow(decodeDoi("10.1037/0003-066x.59.1.29"));

describe("normaliseCrossrefRecord", () => {
  it("normalises a real journal-article response into a CSL record", () => {
    const response = decodeResponse(rayResponseBody);
    const record = normaliseCrossrefRecord(response, REQUESTED_DOI);
    expect(record).not.toBeNull();
    expect(record!.type).toBe("article-journal");
    expect(record!.title).toBe("How the Mind Hurts and Heals the Body.");
    expect(record!["container-title"]).toBe("American Psychologist");
    expect(record!.publisher).toBe("American Psychological Association (APA)");
    expect(record!.volume).toBe("59");
    expect(record!.issue).toBe("1");
    expect(record!.page).toBe("29-40");
    expect(record!.author).toEqual([{ family: "Ray", given: "Oakley" }]);
    expect(record!.issued).toEqual({ "date-parts": [[2004]] });
    expect(record!.identifiers.doi).toBe(REQUESTED_DOI);
    // Crossref lists the electronic ISSN first for this journal; the
    // normaliser takes the first checksum-valid one in upstream order.
    expect(record!.identifiers.issn).toBe("1935-990X");
  });

  it("maps unlisted Crossref types to article-journal", () => {
    const response = { message: { title: ["X"], type: "some-future-type" } };
    const record = normaliseCrossrefRecord(response, REQUESTED_DOI);
    expect(record!.type).toBe("article-journal");
  });

  it("maps book / chapter / conference / thesis types", () => {
    const of = (type: string) =>
      normaliseCrossrefRecord({ message: { title: ["X"], type } }, REQUESTED_DOI)!.type;
    expect(of("book")).toBe("book");
    expect(of("book-chapter")).toBe("chapter");
    expect(of("proceedings-article")).toBe("paper-conference");
    expect(of("dissertation")).toBe("thesis");
  });

  it("returns null when there is no message", () => {
    expect(normaliseCrossrefRecord({}, REQUESTED_DOI)).toBeNull();
  });

  it("returns null when there is no usable title", () => {
    expect(normaliseCrossrefRecord({ message: {} }, REQUESTED_DOI)).toBeNull();
  });

  it("falls back to the requested DOI when the upstream echo is malformed", () => {
    const record = normaliseCrossrefRecord(
      { message: { title: ["X"], DOI: "not a doi" } },
      REQUESTED_DOI,
    );
    expect(record!.identifiers.doi).toBe(REQUESTED_DOI);
  });

  it("prefers the upstream-echoed DOI over the requested one", () => {
    const record = normaliseCrossrefRecord(
      { message: { title: ["X"], DOI: "10.1038/OTHER" } },
      REQUESTED_DOI,
    );
    expect(record!.identifiers.doi).toBe("10.1038/other");
  });

  it("falls back to an organisation's bare `name` when family/given are absent", () => {
    const record = normaliseCrossrefRecord(
      { message: { title: ["X"], author: [{ name: "World Health Organization" }] } },
      REQUESTED_DOI,
    );
    expect(record!.author).toEqual([{ literal: "World Health Organization" }]);
  });

  it("reads numeric volume/issue as CSL strings", () => {
    const record = normaliseCrossrefRecord(
      { message: { title: ["X"], volume: 12, issue: 3 } },
      REQUESTED_DOI,
    );
    expect(record!.volume).toBe("12");
    expect(record!.issue).toBe("3");
  });

  it("drops an unusable ISSN rather than failing the record", () => {
    const record = normaliseCrossrefRecord(
      { message: { title: ["X"], ISSN: ["not-an-issn"] } },
      REQUESTED_DOI,
    );
    expect(record!.identifiers.issn).toBeUndefined();
  });

  it("omits container-title/publisher/dates when absent", () => {
    const record = normaliseCrossrefRecord({ message: { title: ["X"] } }, REQUESTED_DOI)!;
    expect(record["container-title"]).toBeUndefined();
    expect(record.publisher).toBeUndefined();
    expect(record.issued).toBeUndefined();
  });
});

describe("lookupCrossrefByDoi", () => {
  it("resolves via the percent-encoded Crossref path", async () => {
    const { urls, layer } = stubRouter({
      [`https://api.crossref.org/works/${encodeURIComponent(REQUESTED_DOI)}`]: {
        status: 200,
        body: rayResponseBody,
      },
    });
    const result = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupCrossrefByDoi(client, REQUESTED_DOI);
        }),
        layer,
      ),
    );
    expect(Option.isSome(result)).toBe(true);
    expect(Option.getOrThrow(result).title).toBe("How the Mind Hurts and Heals the Body.");
    expect(urls[0]).toBe(`https://api.crossref.org/works/${encodeURIComponent(REQUESTED_DOI)}`);
  });

  it("returns Option.none on a clean 404", async () => {
    const { layer } = stubRouter({});
    const result = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupCrossrefByDoi(client, REQUESTED_DOI);
        }),
        layer,
      ),
    );
    expect(Option.isNone(result)).toBe(true);
  });

  it("fails with LookupFailed when the body has the wrong shape", async () => {
    const { layer } = stubRouter({
      [`https://api.crossref.org/works/${encodeURIComponent(REQUESTED_DOI)}`]: {
        status: 200,
        body: { message: "not an object" },
      },
    });
    await expectFailureInstanceOf(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupCrossrefByDoi(client, REQUESTED_DOI);
        }),
        layer,
      ),
      LookupFailed,
    );
  });
});
