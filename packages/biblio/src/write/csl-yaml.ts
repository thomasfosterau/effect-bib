/**
 * Records as CSL YAML, the inverse of `parseCslYaml`.
 *
 * @copyright Thomas Foster
 * @module biblio/write/csl-yaml
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as Schema from "effect/Schema";
import { type BiblioRecord, toCslJson } from "../record.ts";
import { writeYamlMapping } from "../yaml.ts";

/** CSL-JSON as JSON data (it always is: `toCslJson` writes only JSON values). */
const toJson = Schema.decodeUnknownOption(Schema.Json);

/**
 * Writes records as CSL YAML: a `references:` list of the records'
 * CSL-JSON ({@link toCslJson}) in YAML form, between `---` and `...`
 * markers, so the text is both a Pandoc bibliography file and a Markdown
 * front-matter block. Strings are double-quoted (so no title reads as a
 * number or a date), `date-parts` are flow lists. Pure and total.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { fromCslJson, parseCslYaml, toCslYaml } from "@thomasfosterau/biblio"
 *
 * const record = fromCslJson({
 *   id: "harari2015",
 *   type: "book",
 *   title: "Sapiens",
 *   author: [{ family: "Harari", given: "Yuval Noah" }],
 *   issued: { "date-parts": [[2015]] },
 * })
 *
 * assert.strictEqual(
 *   toCslYaml([record]),
 *   [
 *     "---",
 *     "references:",
 *     '- type: "book"',
 *     '  id: "harari2015"',
 *     '  title: "Sapiens"',
 *     "  author:",
 *     '  - family: "Harari"',
 *     '    given: "Yuval Noah"',
 *     "  issued:",
 *     "    date-parts: [[2015]]",
 *     "...",
 *     "",
 *   ].join("\n"),
 * )
 *
 * const [parsed] = parseCslYaml(toCslYaml([record]), { mode: "lenient" })
 * assert.strictEqual(parsed.outcome === "parsed" ? parsed.record.title : undefined, "Sapiens")
 * ```
 *
 * @since 1.0.0
 */
export function toCslYaml(records: readonly BiblioRecord[]): string {
  const lines = Array.match(records, {
    onEmpty: () => ["references: []"],
    onNonEmpty: (list) =>
      writeYamlMapping({
        references: Array.getSomes(list.map((record) => toJson(toCslJson(record)))),
      }),
  });
  return ["---", ...lines, "...", ""].join("\n");
}
