/**
 * Unit tests for the fuzzy dedup matcher
 * (`src/lib/server/biblio/dedup-match.ts`).
 *
 * The matcher is the pure, deterministic decision behind ingestion's
 * second dedup pass (#610): given an incoming record's title + authors and
 * a candidate existing Book's, it decides whether they are confidently the
 * **same work**. These tests pin the normalisation, the two-axis scoring,
 * and — most importantly — the **high-precision** threshold: a true
 * reprint collapses, but a merely similar different work does not (no
 * silent merge).
 *
 * @module tests/unit/biblio-dedup-match
 */

import * as Eq from "effect/Equal";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import {
  authorSurname,
  bestConfidentMatch,
  type BiblioRecord,
  isConfidentMatch,
  matchConfidence,
  normaliseForMatch,
  recordMatchInput,
  scoreMatch,
  titleTokens,
} from "@thomasfosterau/biblio";

describe("normaliseForMatch", () => {
  it("strips diacritics, punctuation, and case", () => {
    expect(normaliseForMatch("Lévi-Strauss, Claude")).toBe("levi strauss claude");
  });

  it("collapses runs of non-alphanumeric characters to single spaces", () => {
    expect(normaliseForMatch("  A.I.:  A   Modern   Approach!  ")).toBe("a i a modern approach");
  });
});

describe("titleTokens", () => {
  it("drops leading-article stopwords so 'The Hobbit' and 'Hobbit' agree", () => {
    expect([...titleTokens("The Hobbit")]).toEqual(["hobbit"]);
    expect([...titleTokens("Hobbit")]).toEqual(["hobbit"]);
  });

  it("is order- and repetition-insensitive (a set)", () => {
    // `HashSet` equality is structural, so this compares membership rather
    // than the (insertion-order-dependent) internal trie layout.
    expect(Eq.equals(titleTokens("Lord of the Rings"), titleTokens("Rings of the Lord"))).toBe(
      true,
    );
  });
});

describe("authorSurname", () => {
  it("reduces given-name variants to a shared surname", () => {
    expect(authorSurname("J. R. R. Tolkien")).toBe("tolkien");
    expect(authorSurname("John Ronald Reuel Tolkien")).toBe("tolkien");
  });

  it("normalises accents in the surname", () => {
    expect(authorSurname("Gabriel García Márquez")).toBe("marquez");
  });

  it("handles the 'Surname, Given' ordering used by many sources", () => {
    expect(authorSurname("Harari, Yuval Noah")).toBe("harari");
    // Same author, both orderings, reduce to the same surname.
    expect(authorSurname("Harari, Yuval Noah")).toBe(authorSurname("Yuval Noah Harari"));
  });
});

describe("scoreMatch + isConfidentMatch", () => {
  const sapiens = {
    title: "Sapiens: A Brief History of Humankind",
    authors: ["Yuval Noah Harari"],
  };

  it("confidently matches a reprint: same title + author, different identifier", () => {
    const score = scoreMatch(sapiens, {
      title: "Sapiens: A Brief History of Humankind",
      authors: ["Yuval Noah Harari"],
    });
    expect(score.title).toBe(1);
    expect(score.author).toStrictEqual(Option.some(1));
    expect(isConfidentMatch(score)).toBe(true);
  });

  it("confidently matches across punctuation / accent / given-name variation", () => {
    const score = scoreMatch(
      { title: "One Hundred Years of Solitude", authors: ["Gabriel García Márquez"] },
      { title: "One Hundred Years of Solitude!", authors: ["G. García Márquez"] },
    );
    expect(score.title).toBe(1);
    expect(score.author).toStrictEqual(Option.some(1));
    expect(isConfidentMatch(score)).toBe(true);
  });

  it("does NOT merge a different work with a similar title (author disagrees)", () => {
    const score = scoreMatch(sapiens, {
      title: "Sapiens: A Brief History of Humankind",
      authors: ["Some Other Author"],
    });
    expect(score.title).toBe(1);
    expect(score.author).toStrictEqual(Option.some(0));
    expect(isConfidentMatch(score)).toBe(false);
  });

  it("does NOT merge across a subtitle/extra-word difference even with matching author", () => {
    const score = scoreMatch(
      { title: "Dune", authors: ["Frank Herbert"] },
      { title: "Dune Messiah", authors: ["Frank Herbert"] },
    );
    expect(score.title).toBeLessThan(0.9);
    expect(isConfidentMatch(score)).toBe(false);
  });

  it("treats absent authors on either side as no signal (None), not a match", () => {
    const score = scoreMatch(
      { title: "Beowulf", authors: [] },
      { title: "Beowulf", authors: ["Seamus Heaney"] },
    );
    expect(score.author).toStrictEqual(Option.none());
  });

  it("with no author signal, confidently matches a near-exact multi-token title", () => {
    const exact = scoreMatch(
      { title: "The Great Gatsby", authors: [] },
      { title: "The Great Gatsby", authors: [] },
    );
    expect(exact.author).toStrictEqual(Option.none());
    expect(isConfidentMatch(exact)).toBe(true);

    const looser = scoreMatch(
      { title: "The Great Gatsby", authors: [] },
      { title: "The Great Gatsby: An Annotated Edition", authors: [] },
    );
    expect(isConfidentMatch(looser)).toBe(false);
  });

  it("does NOT auto-merge an uncorroborated one-word title (over-merge guard)", () => {
    // Two genuinely different works both titled "It", neither carrying an
    // author, must not collapse onto one Book just because the lone title
    // token matches.
    const score = scoreMatch({ title: "It", authors: [] }, { title: "It", authors: [] });
    expect(score.title).toBe(1);
    expect(score.author).toStrictEqual(Option.none());
    expect(score.sharedTitleTokens).toBe(1);
    expect(isConfidentMatch(score)).toBe(false);
  });

  it("scores empty/garbage titles as no match", () => {
    const score = scoreMatch(
      { title: "   ", authors: ["X"] },
      { title: "Real Book", authors: ["X"] },
    );
    expect(score.title).toBe(0);
    expect(isConfidentMatch(score)).toBe(false);
  });
});

describe("matchConfidence", () => {
  it("ranks a full title+author match above a title-only one", () => {
    const both = matchConfidence({ title: 1, author: Option.some(1), sharedTitleTokens: 2 });
    const titleOnly = matchConfidence({ title: 1, author: Option.none(), sharedTitleTokens: 2 });
    const weakerAuthor = matchConfidence({
      title: 1,
      author: Option.some(0.5),
      sharedTitleTokens: 2,
    });
    expect(both).toBeGreaterThan(weakerAuthor);
    expect(titleOnly).toBe(1);
  });
});

describe("bestConfidentMatch", () => {
  const incoming = { title: "Sapiens", authors: ["Yuval Noah Harari"] };

  it("returns null when no candidate is a confident match", () => {
    const result = bestConfidentMatch(incoming, [
      { id: "a", title: "A Different Book", authors: ["Someone Else"] },
      { id: "b", title: "Sapiens", authors: ["A Different Harari Impostor"] },
    ]);
    expect(result).toBeNull();
  });

  it("picks the highest-confidence confident candidate regardless of order", () => {
    const result = bestConfidentMatch(incoming, [
      // Confident but weaker: an extra coauthor halves the author overlap.
      { id: "weaker", title: "Sapiens", authors: ["Yuval Noah Harari", "Extra Coauthor"] },
      // Confident and exact on both axes.
      { id: "strong", title: "Sapiens", authors: ["Yuval Noah Harari"] },
    ]);
    expect(result?.id).toBe("strong");
  });
});

describe("recordMatchInput", () => {
  it("projects a CSL record onto the title + display-name shape the scorer needs", () => {
    const record: BiblioRecord = {
      type: "book",
      title: "Sapiens",
      author: [{ family: "Harari", given: "Yuval Noah" }, { literal: "World Bank" }, {}],
      identifiers: {},
      provenance: { source: "bibtex" },
    };
    expect(recordMatchInput(record)).toEqual({
      title: "Sapiens",
      authors: ["Yuval Noah Harari", "World Bank"],
    });
  });

  it("tolerates a record with no title or authors", () => {
    expect(
      recordMatchInput({ type: "document", identifiers: {}, provenance: { source: "manual" } }),
    ).toEqual({ title: "", authors: [] });
  });
});
