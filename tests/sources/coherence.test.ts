/**
 * Cross-source dedup coherence proof (biblio B3, issue #1070 "done when").
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { decodeDoi, isConfidentMatch, recordMatchInput, scoreMatch } from "@thomasfosterau/biblio";
import { CrossrefResponse, normaliseCrossrefRecord } from "../../src/sources/crossref";
import { normaliseOpenAlexRecord, type OpenAlexWork } from "../../src/sources/openalex";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8"));

describe("cross-source dedup coherence: Crossref vs OpenAlex", () => {
  it("scores the same DOI'd work from both sources as a confident match", () => {
    const doi = Option.getOrThrow(decodeDoi("10.1037/0003-066x.59.1.29"));

    const crossrefResponse = Schema.decodeUnknownSync(CrossrefResponse)(
      fixture("crossref-ray-2004.json"),
    );
    const crossrefRecord = normaliseCrossrefRecord(crossrefResponse, doi);
    const openAlexRecord = normaliseOpenAlexRecord(
      fixture("openalex-ray-2004.json") as OpenAlexWork,
    );

    expect(crossrefRecord).not.toBeNull();
    expect(openAlexRecord).not.toBeNull();
    // Both sources resolved the same DOI — the identity a real ingestion
    // pipeline would already dedup on before ever reaching the fuzzy
    // scorer. The coherence proof is that the *fuzzy* title/author scorer
    // — the one that runs when records disagree on identifier — also
    // agrees, independent of that shared DOI.
    expect(crossrefRecord!.identifiers.doi).toBe(openAlexRecord!.identifiers.doi);

    const incoming = recordMatchInput(crossrefRecord!);
    const candidate = recordMatchInput(openAlexRecord!);
    const score = scoreMatch(incoming, candidate);

    expect(isConfidentMatch(score)).toBe(true);
  });
});
