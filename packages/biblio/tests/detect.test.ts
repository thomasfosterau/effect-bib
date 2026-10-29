/**
 * Unit tests for `detectFormat` (`src/detect.ts`): each format is
 * recognised from its own shape, and the parser it names reads the content.
 *
 * @module tests/unit/biblio-detect
 */

import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import { detectFormat, parseBibliographicFile } from "@thomasfosterau/biblio";

describe("detectFormat", () => {
  it.each([
    ["﻿% exported\n\n@Book{k, title = {T}, isbn = {9780062316097}}", "bibtex"],
    ["Provider: Zotero\r\n\r\nTY  - BOOK\r\nTI  - T\r\nSN  - 9780062316097\r\nER  - \r\n", "ris"],
    ['{"items": [{"type": "book", "title": "T", "ISBN": "9780062316097"}]}', "zotero-json"],
    ["---\nreferences:\n- type: book\n  title: T\n  ISBN: '9780062316097'\n...\n", "csl-yaml"],
    ['"Title","ISBN"\n"T",9780062316097\n', "csv"],
    ["PMID- 1\r\nTI  - T\r\nLID - 10.1000/x [doi]\r\n", "medline"],
    ["%0 Book\n%T T\n%@ 9780062316097\n", "refer"],
  ] as const)("recognises %j as %s, which its parser reads", (content, format) => {
    expect(detectFormat(content)).toEqual(Option.some(format));
    expect(parseBibliographicFile(content, format)[0].outcome).toBe("parsed");
  });

  it("recognises a parenthesised BibTeX entry", () => {
    expect(detectFormat("@article(k, title = {T})")).toEqual(Option.some("bibtex"));
  });

  it("is none for content in no known format", () => {
    expect(detectFormat("")).toEqual(Option.none());
    expect(detectFormat("[not json")).toEqual(Option.none());
    expect(detectFormat("Author,Year\nDoe,2020")).toEqual(Option.none());
    expect(detectFormat("email me @ home")).toEqual(Option.none());
    expect(detectFormat("%A just one tag line")).toEqual(Option.none());
  });
});
