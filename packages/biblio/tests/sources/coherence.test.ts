/**
 * Cross-source dedup coherence proof (biblio B3, website#1070 "done when").
 *
 * The same work — Ray (2004), "How the Mind Hurts and Heals the Body.",
 * DOI `10.1037/0003-066x.59.1.29` — normalised independently from its
 * **Crossref** and **OpenAlex** live-recorded fixtures must score as a
 * confident same-work match under the existing `dedup-match.ts` scorer.
 * This is the proof that B3's two DOI-capable sources emit records the
 * B2 dedup module agrees on, not just records that individually validate.
 *
 * @module tests/unit/biblio-sources-coherence
 */

import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { decodeDoi, isConfidentMatch, recordMatchInput, scoreMatch } from "@thomasfosterau/biblio";
import { CrossrefResponse, normaliseCrossrefRecord } from "../../src/sources/crossref.ts";
import { normaliseOpenAlexRecord, OpenAlexWork } from "../../src/sources/openalex.ts";
import { expectSome } from "../assert.ts";
import crossrefRayBody from "../fixtures/crossref-ray-2004.json" with { type: "json" };
import openAlexRayBody from "../fixtures/openalex-ray-2004.json" with { type: "json" };

describe("cross-source dedup coherence: Crossref vs OpenAlex", () => {
  it("scores the same DOI'd work from both sources as a confident match", () => {
    const doi = expectSome(decodeDoi("10.1037/0003-066x.59.1.29"), "a DOI");

    const crossrefResponse = Schema.decodeUnknownSync(CrossrefResponse)(crossrefRayBody);
    const crossrefRecord = expectSome(
      normaliseCrossrefRecord(crossrefResponse, doi),
      "a Crossref record",
    );
    const openAlexRecord = expectSome(
      normaliseOpenAlexRecord(Schema.decodeUnknownSync(OpenAlexWork)(openAlexRayBody)),
      "an OpenAlex record",
    );

    // Both sources resolved the same DOI — the identity a real ingestion
    // pipeline would already dedup on before ever reaching the fuzzy
    // scorer. The coherence proof is that the *fuzzy* title/author scorer
    // — the one that runs when records disagree on identifier — also
    // agrees, independent of that shared DOI.
    expect(crossrefRecord.identifiers.doi).toBe(openAlexRecord.identifiers.doi);

    const incoming = recordMatchInput(crossrefRecord);
    const candidate = recordMatchInput(openAlexRecord);
    const score = scoreMatch(incoming, candidate);

    expect(isConfidentMatch(score)).toBe(true);
  });
});
