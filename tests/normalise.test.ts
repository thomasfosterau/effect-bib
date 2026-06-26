/**
 * Unit tests for the bibliographic response normalisers
 * (`src/lib/server/biblio/normalise.ts`).
 *
 * Decodes representative OpenLibrary / Crossref payloads through the
 * lenient schemas and asserts the neutral `IngestedRecord` mapping,
 * including the untrusted-data clamps. No network, no database.
 *
 * @module tests/unit/biblio-normalise
 */

import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  CrossrefResponse,
  normaliseCrossref,
  normaliseOpenLibrary,
  openLibraryAuthorKeys,
  OpenLibraryEdition,
} from "@thomasfosterau/biblio/normalise";

const decodeEdition = Schema.decodeUnknownSync(OpenLibraryEdition);
const decodeCrossref = Schema.decodeUnknownSync(CrossrefResponse);

describe("normaliseOpenLibrary", () => {
  it("maps a typical edition with subtitle, publisher, year and authors", () => {
    const edition = decodeEdition({
      title: "Sapiens",
      subtitle: "A Brief History of Humankind",
      publish_date: "Jan 2015",
      publishers: ["Harper"],
      isbn_13: ["9780062316097"],
      authors: [{ key: "/authors/OL1A" }],
    });

    const record = normaliseOpenLibrary(edition, "9780062316097", ["Yuval Noah Harari"]);

    expect(record).not.toBeNull();
    expect(record!).toMatchObject({
      source: "openlibrary",
      authorityId: "9780062316097",
      kind: "book",
      title: "Sapiens: A Brief History of Humankind",
      publicationYear: 2015,
      publisher: "Harper",
      isbn13: "9780062316097",
      isbn10: null,
      doi: null,
      authors: [{ name: "Yuval Noah Harari" }],
    });
  });

  it("falls back to the requested ISBN when the upstream omits it", () => {
    const edition = decodeEdition({ title: "Untitled Edition" });
    const record = normaliseOpenLibrary(edition, "080442957X", []);
    expect(record!.isbn10).toBe("080442957X");
    expect(record!.isbn13).toBeNull();
  });

  it("returns null when there is no usable title", () => {
    const edition = decodeEdition({ publishers: ["Nobody"] });
    expect(normaliseOpenLibrary(edition, "9780062316097", [])).toBeNull();
  });

  it("extracts only well-formed author keys (SSRF guard)", () => {
    const edition = decodeEdition({
      title: "x",
      authors: [
        { key: "/authors/OL1A" },
        { key: "/authors/../../evil" },
        { key: "not-a-key" },
        { nope: true },
      ],
    });
    expect(openLibraryAuthorKeys(edition)).toEqual(["/authors/OL1A"]);
  });

  it("tolerates a malformed but decodable payload without throwing", () => {
    // `publishers` is the wrong type; the lenient schema keeps it as
    // unknown and the normaliser drops it rather than failing.
    const edition = decodeEdition({ title: "Resilient", publishers: [42, null] });
    const record = normaliseOpenLibrary(edition, "9780062316097", []);
    expect(record!.publisher).toBeNull();
  });
});

describe("normaliseCrossref", () => {
  it("maps a typical work with title, authors and issued year", () => {
    const response = decodeCrossref({
      message: {
        DOI: "10.1037/0003-066X.59.1.29",
        title: ["The Structure of Scientific Revolutions"],
        publisher: "American Psychological Association",
        author: [{ given: "Thomas", family: "Kuhn" }, { family: "Anonymous" }],
        issued: { "date-parts": [[2004, 1]] },
      },
    });

    const record = normaliseCrossref(response, "10.1037/0003-066x.59.1.29");

    expect(record).not.toBeNull();
    expect(record!).toMatchObject({
      source: "crossref",
      authorityId: "10.1037/0003-066x.59.1.29",
      kind: "article",
      title: "The Structure of Scientific Revolutions",
      publisher: "American Psychological Association",
      publicationYear: 2004,
      doi: "10.1037/0003-066x.59.1.29",
      authors: [{ name: "Thomas Kuhn" }, { name: "Anonymous" }],
    });
  });

  it("prefers `published` over `issued` for the year", () => {
    const response = decodeCrossref({
      message: {
        title: ["t"],
        published: { "date-parts": [[2010]] },
        issued: { "date-parts": [[1999]] },
      },
    });
    expect(normaliseCrossref(response, "10.1/a")!.publicationYear).toBe(2010);
  });

  it("returns null when there is no title", () => {
    const response = decodeCrossref({ message: { DOI: "10.1/a" } });
    expect(normaliseCrossref(response, "10.1/a")).toBeNull();
  });

  it("re-normalises an echoed DOI so a hostile echo can't smuggle a bad value", () => {
    const response = decodeCrossref({
      message: { title: ["t"], DOI: "not a doi" },
    });
    // The echo is rejected; the requested (already-normalised) DOI stands.
    expect(normaliseCrossref(response, "10.1/a")!.doi).toBe("10.1/a");
  });
});
