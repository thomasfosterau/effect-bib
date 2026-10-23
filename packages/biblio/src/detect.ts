/**
 * Format sniffing for bibliographic files.
 *
 * @copyright Thomas Foster
 * @module biblio/detect
 * @since 1.0.0
 */

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ImportFormat } from "./parse.ts";

/** How much of the input the sniffing reads: the formats show themselves in their first entries. */
const SNIFF_LENGTH = 64_000;

/** True when the text is JSON. */
const isJson = (text: string): boolean =>
  Option.isSome(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(text));

/** A CSV header naming a title column (the column the CSV parser requires). */
const CSV_TITLE_HEADER = /^(?:[^\n,]*,)*\s*"?(?:title|name)"?\s*(?:,|$)/i;

/**
 * Guesses the {@link ImportFormat} of a bibliographic file from its
 * content: CSL-JSON (`zotero-json`) when it is a JSON array or object, RIS
 * when a line is a `TY  - ` tag, CSL YAML when it holds a `references:` key
 * (a bibliography file or Markdown front matter), BibTeX when a line opens
 * an `@type{` entry, and CSV when its first line is a header with a `title`
 * column. `Option.none()` when it is none of them. Reads at most the first
 * 64 000 characters (all of a JSON document); pure and total.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { detectFormat } from "@thomasfosterau/biblio"
 *
 * assert.deepStrictEqual(detectFormat("% my library\n@article{key, title = {T}}"), Option.some("bibtex"))
 * assert.deepStrictEqual(detectFormat("TY  - JOUR\nTI  - T\nER  - "), Option.some("ris"))
 * assert.deepStrictEqual(detectFormat('[{"type": "book", "title": "T"}]'), Option.some("zotero-json"))
 * assert.deepStrictEqual(detectFormat("---\nreferences:\n- id: a\n"), Option.some("csl-yaml"))
 * assert.deepStrictEqual(detectFormat("Title,Author\nSapiens,Harari"), Option.some("csv"))
 * assert.deepStrictEqual(detectFormat("just some notes"), Option.none())
 * ```
 *
 * @since 1.0.0
 */
export function detectFormat(content: string): Option.Option<ImportFormat> {
  const text = content.replace(/^﻿/, "").trimStart();
  const head = text.slice(0, SNIFF_LENGTH);
  if ((text.startsWith("[") || text.startsWith("{")) && isJson(text))
    return Option.some("zotero-json");
  if (/^TY {2}- /m.test(head)) return Option.some("ris");
  if (/^references\s*:/m.test(head)) return Option.some("csl-yaml");
  if (/^\s*@\s*[A-Za-z]+\s*[{(]/m.test(head)) return Option.some("bibtex");
  if (CSV_TITLE_HEADER.test(head.split(/\r?\n/, 1)[0] ?? "")) return Option.some("csv");
  return Option.none();
}
