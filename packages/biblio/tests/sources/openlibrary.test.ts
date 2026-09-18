/**
 * Unit tests for the OpenLibrary CSL-native source client
 * (`src/sources/openlibrary.ts`, biblio B3, issue #1070).
 *
 * `openlibrary-ulysses-edition.json` / `openlibrary-ulysses-author.json`
 * are **live-recorded fixtures** (captured 2026-07-23 from
 * `https://openlibrary.org/isbn/9780199535675.json` and
 * `https://openlibrary.org/authors/OL31827A.json`) — a real edition that
 * carries the direct author reference, publish places, and subjects the
 * B3 lift adds. The network is stubbed at `FetchHttpClient.Fetch`; no test
 * here reaches the network.
 *
 * @module tests/unit/biblio-sources-openlibrary
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { decodeIsbn } from "@thomasfosterau/biblio";
import {
  lookupOpenLibraryByIsbn,
  normaliseOpenLibraryRecord,
  OpenLibraryAuthor,
  openLibraryAuthorKeys,
  openLibraryAuthorName,
  OpenLibraryEdition,
} from "../../src/sources/openlibrary.ts";
import { LookupFailed } from "../../src/sources/errors.ts";
import { expectFailureInstanceOf, runTest } from "../effect.ts";
import { filteredClient, stubRouter } from "./stub-http.ts";
import { expectSome } from "../assert.ts";
import ulyssesAuthorBody from "../fixtures/openlibrary-ulysses-author.json" with { type: "json" };
import ulyssesEditionBody from "../fixtures/openlibrary-ulysses-edition.json" with { type: "json" };

/** Decodes a loose object literal through the lenient upstream schemas. */
const asEdition = Schema.decodeUnknownSync(OpenLibraryEdition);
const asAuthor = Schema.decodeUnknownSync(OpenLibraryAuthor);

const ulyssesEdition = asEdition(ulyssesEditionBody);
const ulyssesAuthor = asAuthor(ulyssesAuthorBody);

const REQUESTED_ISBN = expectSome(decodeIsbn("9780199535675"), "an ISBN");

describe("openLibraryAuthorKeys", () => {
  it("extracts valid /authors/OL...A keys, bounded", () => {
    expect(openLibraryAuthorKeys(ulyssesEdition)).toEqual(["/authors/OL31827A"]);
  });

  it("ignores refs without a well-formed author key", () => {
    const edition = asEdition({ authors: [{ key: "/works/OL1W" }, { key: "not-a-key" }, {}] });
    expect(openLibraryAuthorKeys(edition)).toEqual([]);
  });

  it("returns [] when there is no authors field", () => {
    expect(openLibraryAuthorKeys(asEdition({}))).toEqual([]);
  });
});

describe("openLibraryAuthorName", () => {
  it("sanitises the author's display name", () => {
    expect(openLibraryAuthorName(ulyssesAuthor)).toStrictEqual(Option.some("James Joyce"));
  });

  it("returns null for a missing name", () => {
    expect(openLibraryAuthorName(asAuthor({}))).toStrictEqual(Option.none());
  });
});

describe("normaliseOpenLibraryRecord", () => {
  it("lifts a real edition into a CSL book record: publisher-place, subjects, structured author", () => {
    const record = expectSome(
      normaliseOpenLibraryRecord(ulyssesEdition, REQUESTED_ISBN, ["James Joyce"]),
      "a record",
    );
    expect(record.type).toBe("book");
    expect(record.title).toBe("Ulysses");
    expect(record.publisher).toBe("Oxford University Press");
    expect(record["publisher-place"]).toBe("Oxford");
    expect(record.author).toEqual([{ family: "Joyce", given: "James" }]);
    expect(record.issued).toEqual({ "date-parts": [[2008]] });
    expect(record.identifiers.isbn).toBe(REQUESTED_ISBN);
    expect(record.provenance).toEqual({
      source: "openlibrary",
      retrievedBy: {
        identifierType: "isbn",
        identifier: REQUESTED_ISBN,
        endpoint: `https://openlibrary.org/isbn/${REQUESTED_ISBN}.json`,
      },
    });
    expect(record.extra?.subject).toEqual([
      "City and town life -- Fiction",
      "Married people -- Fiction",
      "Jewish men -- Fiction",
      "Artists -- Fiction",
      "Psychological fiction",
      "Domestic fiction",
      "Dublin (Ireland) -- Fiction",
    ]);
  });

  it("folds a subtitle into the title", () => {
    const edition = asEdition({ title: "Sapiens", subtitle: "A Brief History of Humankind" });
    const record = expectSome(normaliseOpenLibraryRecord(edition, REQUESTED_ISBN, []));
    expect(record.title).toBe("Sapiens: A Brief History of Humankind");
  });

  it("returns null when there is no usable title", () => {
    expect(normaliseOpenLibraryRecord(asEdition({}), REQUESTED_ISBN, [])).toStrictEqual(
      Option.none(),
    );
  });

  it("falls back to the requested ISBN when the upstream echoes none", () => {
    const edition = asEdition({ title: "A Book" });
    const record = expectSome(normaliseOpenLibraryRecord(edition, REQUESTED_ISBN, []));
    expect(record.identifiers.isbn).toBe(REQUESTED_ISBN);
  });

  it("prefers an upstream-echoed checksum-valid ISBN over the requested one", () => {
    const edition = asEdition({ title: "A Book", isbn_13: ["9780062316097"] });
    const record = expectSome(normaliseOpenLibraryRecord(edition, REQUESTED_ISBN, []));
    expect(record.identifiers.isbn).toBe("9780062316097");
  });

  it("drops an unusable echoed ISBN and keeps the requested one", () => {
    const edition = asEdition({ title: "A Book", isbn_13: ["not-an-isbn"] });
    const record = expectSome(normaliseOpenLibraryRecord(edition, REQUESTED_ISBN, []));
    expect(record.identifiers.isbn).toBe(REQUESTED_ISBN);
  });

  it("omits issued/publisher-place/extra when the upstream carries none", () => {
    const record = expectSome(
      normaliseOpenLibraryRecord(asEdition({ title: "A Book" }), REQUESTED_ISBN, []),
    );
    expect(record.issued).toBeUndefined();
    expect(record["publisher-place"]).toBeUndefined();
    expect(record.extra).toBeUndefined();
  });
});

describe("lookupOpenLibraryByIsbn", () => {
  it("resolves the edition and follows its author record", async () => {
    const { urls, layer } = stubRouter({
      "https://openlibrary.org/isbn/9780199535675.json": { status: 200, body: ulyssesEdition },
      "https://openlibrary.org/authors/OL31827A.json": { status: 200, body: ulyssesAuthor },
    });
    const result = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenLibraryByIsbn(client, REQUESTED_ISBN);
        }),
        layer,
      ),
    );
    expect(Option.isSome(result)).toBe(true);
    const record = expectSome(result, "a record");
    expect(record.title).toBe("Ulysses");
    expect(record.author).toEqual([{ family: "Joyce", given: "James" }]);
    expect(urls).toContain("https://openlibrary.org/isbn/9780199535675.json");
    expect(urls).toContain("https://openlibrary.org/authors/OL31827A.json");
  });

  it("returns Option.none on a clean edition 404", async () => {
    const { layer } = stubRouter({});
    const result = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenLibraryByIsbn(client, REQUESTED_ISBN);
        }),
        layer,
      ),
    );
    expect(Option.isNone(result)).toBe(true);
  });

  it("still returns a record when an author follow-up 404s", async () => {
    const { layer } = stubRouter({
      "https://openlibrary.org/isbn/9780199535675.json": { status: 200, body: ulyssesEdition },
      // author lookup unmapped -> 404
    });
    const result = await runTest(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenLibraryByIsbn(client, REQUESTED_ISBN);
        }),
        layer,
      ),
    );
    const record = expectSome(result, "a record");
    expect(record.author).toBeUndefined();
  });

  it("fails with LookupFailed on an upstream 5xx", async () => {
    const { layer } = stubRouter({
      "https://openlibrary.org/isbn/9780199535675.json": { status: 503, body: {} },
    });
    await expectFailureInstanceOf(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenLibraryByIsbn(client, REQUESTED_ISBN);
        }),
        layer,
      ),
      LookupFailed,
    );
  });

  it("fails with LookupFailed when the body has the wrong shape", async () => {
    const { layer } = stubRouter({
      "https://openlibrary.org/isbn/9780199535675.json": { status: 200, body: "not an object" },
    });
    await expectFailureInstanceOf(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* filteredClient;
          return yield* lookupOpenLibraryByIsbn(client, REQUESTED_ISBN);
        }),
        layer,
      ),
      LookupFailed,
    );
  });
});
