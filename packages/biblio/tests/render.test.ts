/**
 * Unit tests for the render module (`src/render/*`).
 *
 * Two axes: the shared `format.ts` primitives (name lists, initials, dates,
 * punctuation, classification) tested directly, and the two built-in styles
 * exercised end-to-end against **golden snapshot strings** — a mixed-item-type
 * bibliography rendered in APA (author-date) and Vancouver (numeric). The
 * golden strings ARE the snapshots: same records + style → same string, so a
 * drift fails CI with an exact diff. No network, no database — the engine is
 * pure.
 *
 * @module tests/unit/biblio-render
 */

import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import { describe, expect, it } from "vite-plus/test";
import {
  apaStyle,
  bibliographyToText,
  type BiblioRecord,
  builtInStyles,
  compact,
  type CslName,
  dateFromYear,
  decodeDoi,
  decodeIsbn,
  doiUrl,
  enLocale,
  familyName,
  formatNameList,
  formatOneName,
  getStyle,
  givenInitials,
  issuedYearText,
  joinParts,
  type Locale,
  makeCslName,
  type NameListOptions,
  pagesLabel,
  preferredUrl,
  referenceClass,
  renderBibliography,
  renderReference,
  sortFamily,
  terminate,
  vancouverStyle,
} from "@thomasfosterau/biblio";
import { expectPresent, expectSome } from "./assert.ts";

// ── Test data builders (kept trivial for a low CRAP score) ────────────

const cslName = (family: string, given: string, extra: Record<string, unknown> = {}): CslName =>
  expectPresent(makeCslName({ family, given, ...extra }), "a non-empty name");

const doi = (raw: string) => expectSome(decodeDoi(raw), "a DOI");
const isbn = (raw: string) => expectSome(decodeIsbn(raw), "an ISBN");

const book: BiblioRecord = {
  type: "book",
  title: "Sapiens: A Brief History of Humankind",
  author: [cslName("Harari", "Yuval Noah")],
  publisher: "Harper",
  "publisher-place": "New York",
  edition: "2nd",
  issued: dateFromYear(2015),
  identifiers: { isbn: isbn("9780062316097") },
  provenance: { source: "manual" },
};

const chapter: BiblioRecord = {
  type: "chapter",
  title: "The Cognitive Revolution",
  author: [cslName("Harari", "Yuval Noah")],
  editor: [cslName("Smith", "Jane A"), cslName("Doe", "Robert")],
  "container-title": "Big History Reader",
  page: "12-40",
  publisher: "Academic Press",
  "publisher-place": "London",
  issued: dateFromYear(2018),
  identifiers: {},
  provenance: { source: "manual" },
};

const article: BiblioRecord = {
  type: "article-journal",
  title: "Can loneliness be lethal?",
  author: [cslName("Shubin", "Neil"), cslName("Wilson", "Edward O")],
  "container-title": "Journal of Social Biology",
  volume: "4",
  issue: "3",
  page: "331-345",
  issued: dateFromYear(2004),
  identifiers: { doi: doi("10.1234/jsb.2004.0043") },
  provenance: { source: "crossref" },
};

const webpage: BiblioRecord = {
  type: "webpage",
  title: "The state of open citations",
  author: [cslName("Peroni", "Silvio")],
  "container-title": "OpenCitations Blog",
  URL: "https://opencitations.net/blog",
  issued: dateFromYear(2021),
  identifiers: {},
  provenance: { source: "manual" },
};

const mixed = [book, chapter, article, webpage];

// ── Golden snapshots: mixed item types × two styles ───────────────────

describe("APA style (author-date) — golden snapshots", () => {
  it.each([
    [
      "book",
      book,
      "Harari, Y. N. (2015). Sapiens: A Brief History of Humankind (2nd ed.). Harper.",
    ],
    [
      "chapter",
      chapter,
      "Harari, Y. N. (2018). The Cognitive Revolution. In J. A. Smith, & R. Doe (Eds.), Big History Reader (pp. 12-40). Academic Press.",
    ],
    [
      "article-journal",
      article,
      "Shubin, N., & Wilson, E. O. (2004). Can loneliness be lethal? Journal of Social Biology, 4(3), 331-345. https://doi.org/10.1234/jsb.2004.0043",
    ],
    [
      "webpage",
      webpage,
      "Peroni, S. (2021). The state of open citations. OpenCitations Blog. https://opencitations.net/blog",
    ],
  ])("renders a %s", (_label, record, expected) => {
    expect(renderReference(record, { style: apaStyle })).toBe(expected);
  });

  it("renders the whole bibliography sorted by author, then year", () => {
    expect(bibliographyToText(renderBibliography(mixed, { style: apaStyle }))).toBe(
      [
        "Harari, Y. N. (2015). Sapiens: A Brief History of Humankind (2nd ed.). Harper.",
        "Harari, Y. N. (2018). The Cognitive Revolution. In J. A. Smith, & R. Doe (Eds.), Big History Reader (pp. 12-40). Academic Press.",
        "Peroni, S. (2021). The state of open citations. OpenCitations Blog. https://opencitations.net/blog",
        "Shubin, N., & Wilson, E. O. (2004). Can loneliness be lethal? Journal of Social Biology, 4(3), 331-345. https://doi.org/10.1234/jsb.2004.0043",
      ].join("\n"),
    );
  });
});

describe("Vancouver style (numeric) — golden snapshots", () => {
  it.each([
    [
      "book",
      book,
      "Harari YN. Sapiens: A Brief History of Humankind. 2nd ed. New York: Harper; 2015.",
    ],
    [
      "chapter",
      chapter,
      "Harari YN. The Cognitive Revolution. In: Smith JA, Doe R, editors. Big History Reader. London: Academic Press; 2018. p. 12-40.",
    ],
    [
      "article-journal",
      article,
      "Shubin N, Wilson EO. Can loneliness be lethal? Journal of Social Biology. 2004;4(3):331-345.",
    ],
    [
      "webpage",
      webpage,
      "Peroni S. The state of open citations [Internet]. OpenCitations Blog. 2021. Available from: https://opencitations.net/blog",
    ],
  ])("renders a %s", (_label, record, expected) => {
    expect(renderReference(record, { style: vancouverStyle })).toBe(expected);
  });

  it("numbers the whole bibliography in citation (input) order", () => {
    expect(bibliographyToText(renderBibliography(mixed, { style: vancouverStyle }))).toBe(
      [
        "1. Harari YN. Sapiens: A Brief History of Humankind. 2nd ed. New York: Harper; 2015.",
        "2. Harari YN. The Cognitive Revolution. In: Smith JA, Doe R, editors. Big History Reader. London: Academic Press; 2018. p. 12-40.",
        "3. Shubin N, Wilson EO. Can loneliness be lethal? Journal of Social Biology. 2004;4(3):331-345.",
        "4. Peroni S. The state of open citations [Internet]. OpenCitations Blog. 2021. Available from: https://opencitations.net/blog",
      ].join("\n"),
    );
  });
});

// ── Determinism ───────────────────────────────────────────────────────

describe("determinism", () => {
  it("is order-independent for a sorted (author-date) bibliography", () => {
    const forward = bibliographyToText(renderBibliography(mixed, { style: apaStyle }));
    const reversed = bibliographyToText(
      renderBibliography([...mixed].reverse(), { style: apaStyle }),
    );
    expect(forward).toBe(reversed);
  });

  it("renders identical output across repeated calls", () => {
    const once = renderReference(article, { style: apaStyle });
    const twice = renderReference(article, { style: apaStyle });
    expect(once).toBe(twice);
  });

  it("keeps sort-key ties in input order (stable sort)", () => {
    const a: BiblioRecord = { ...book, title: "Same Title" };
    const b: BiblioRecord = { ...book, title: "Same Title", publisher: "Second" };
    const rendered = renderBibliography([a, b], { style: apaStyle });
    expect(rendered.entries[0].text).toContain("Harper");
    expect(rendered.entries[1].text).toContain("Second");
  });
});

// ── et al. elision ────────────────────────────────────────────────────

describe("author elision", () => {
  const many: BiblioRecord = {
    type: "article-journal",
    title: "A large collaboration study",
    author: Array.makeBy(8, (i) => cslName(`Author${i}`, `First${i}`)),
    "container-title": "Big Science",
    volume: "1",
    page: "1-9",
    issued: dateFromYear(2020),
    identifiers: {},
    provenance: { source: "manual" },
  };

  it("Vancouver lists six names then et al.", () => {
    expect(renderReference(many, { style: vancouverStyle })).toContain(
      "Author0 F, Author1 F, Author2 F, Author3 F, Author4 F, Author5 F, et al.",
    );
  });

  it("APA does not elide at eight authors (cap is 20)", () => {
    expect(renderReference(many, { style: apaStyle })).toContain("& Author7, F.");
  });
});

// ── Edge cases: missing fields exercise the null branches ─────────────

describe("sparse records", () => {
  const bare = (type: BiblioRecord["type"]): BiblioRecord => ({
    type,
    identifiers: {},
    provenance: { source: "manual" },
  });

  it("APA renders a year-only reference when there is no author", () => {
    const r: BiblioRecord = { ...bare("book"), issued: dateFromYear(1999), title: "Anon Work" };
    expect(renderReference(r, { style: apaStyle })).toBe("(1999). Anon Work.");
  });

  it("APA uses n.d. when there is no issued date", () => {
    const r: BiblioRecord = { ...bare("book"), author: [cslName("Roe", "Jane")], title: "Undated" };
    expect(renderReference(r, { style: apaStyle })).toBe("Roe, J. (n.d.). Undated.");
  });

  it("APA chapter without editors omits the In-clause", () => {
    const r: BiblioRecord = {
      ...bare("chapter"),
      title: "Loose Chapter",
      "container-title": "Some Book",
      author: [cslName("Roe", "Jane")],
      issued: dateFromYear(2000),
    };
    expect(renderReference(r, { style: apaStyle })).toBe(
      "Roe, J. (2000). Loose Chapter. Some Book.",
    );
  });

  it("Vancouver book without place or edition renders a bare year imprint", () => {
    const r: BiblioRecord = {
      ...bare("book"),
      title: "Minimal Book",
      author: [cslName("Roe", "Jane")],
      issued: dateFromYear(2001),
    };
    expect(renderReference(r, { style: vancouverStyle })).toBe("Roe J. Minimal Book. 2001.");
  });

  it("Vancouver chapter without editors omits the In-clause and pages", () => {
    const r: BiblioRecord = {
      ...bare("chapter"),
      title: "Loose Chapter",
      "container-title": "Some Book",
      author: [cslName("Roe", "Jane")],
      issued: dateFromYear(2002),
    };
    expect(renderReference(r, { style: vancouverStyle })).toBe(
      "Roe J. Loose Chapter. Some Book. 2002.",
    );
  });

  it("Vancouver webpage without a URL omits the availability clause", () => {
    const r: BiblioRecord = {
      ...bare("webpage"),
      title: "No Link",
      author: [cslName("Roe", "Jane")],
      issued: dateFromYear(2003),
    };
    expect(renderReference(r, { style: vancouverStyle })).toBe("Roe J. No Link [Internet]. 2003.");
  });

  it("renders an unknown/long-tail item type through the generic body", () => {
    const r: BiblioRecord = {
      type: "map",
      title: "A Rare Map",
      author: [cslName("Roe", "Jane")],
      "container-title": "Atlas",
      publisher: "Cartography Co",
      issued: dateFromYear(2010),
      identifiers: {},
      provenance: { source: "manual" },
    };
    expect(renderReference(r, { style: apaStyle })).toBe(
      "Roe, J. (2010). A Rare Map. Atlas. Cartography Co.",
    );
    expect(renderReference(r, { style: vancouverStyle })).toBe(
      "Roe J. A Rare Map. Atlas. Cartography Co. 2010.",
    );
  });

  it("APA article without volume/issue/page renders just the container", () => {
    const r: BiblioRecord = {
      ...bare("article-journal"),
      title: "Thin Article",
      author: [cslName("Roe", "Jane")],
      "container-title": "Some Journal",
      issued: dateFromYear(2005),
    };
    expect(renderReference(r, { style: apaStyle })).toBe(
      "Roe, J. (2005). Thin Article. Some Journal.",
    );
  });
});

// ── Custom locale ─────────────────────────────────────────────────────

describe("locale input", () => {
  it("threads a caller-supplied locale (no network, pure data)", () => {
    const frLike: Locale = { ...enLocale, id: "custom", noDate: "sans date", and: "et" };
    const r: BiblioRecord = {
      type: "book",
      title: "Livre",
      author: [cslName("Roe", "Jane")],
      identifiers: {},
      provenance: { source: "manual" },
    };
    expect(renderReference(r, { style: apaStyle, locale: frLike })).toBe(
      "Roe, J. (sans date). Livre.",
    );
  });

  it("defaults to en-US when no locale is supplied", () => {
    expect(enLocale.id).toBe("en-US");
  });
});

// ── Style registry ────────────────────────────────────────────────────

describe("getStyle / builtInStyles", () => {
  it("resolves a known style by id", () => {
    expect(getStyle("apa")).toBe(apaStyle);
    expect(getStyle("vancouver")).toBe(vancouverStyle);
  });

  it("returns undefined for an unknown id", () => {
    expect(getStyle("chicago")).toBeUndefined();
  });

  it("exposes both built-in styles", () => {
    expect(Record.keys(builtInStyles)).toEqual(["apa", "vancouver"]);
  });
});

// ── format.ts primitives ──────────────────────────────────────────────

describe("compact / joinParts", () => {
  it("drops absent and blank parts and trims", () => {
    expect(
      compact([
        Option.some("a"),
        Option.none(),
        Option.none(),
        Option.some("  "),
        Option.some(" b "),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("joins the surviving parts with a separator", () => {
    expect(joinParts([Option.some("a"), Option.none(), Option.some("b")], ", ")).toBe("a, b");
    expect(joinParts([Option.none(), Option.none()], " ")).toBe("");
  });
});

describe("terminate", () => {
  it.each([
    ["", ""],
    ["Title", "Title."],
    ["Ends already.", "Ends already."],
    ["A question?", "A question?"],
    ["Bang!", "Bang!"],
  ])("terminates %j", (input, expected) => {
    expect(terminate(input)).toBe(expected);
  });
});

describe("givenInitials", () => {
  it("APA-style spaced initials with periods", () => {
    expect(givenInitials("John Ronald Reuel", { periods: true, spaced: true })).toBe("J. R. R.");
  });

  it("Vancouver-style bare initials", () => {
    expect(givenInitials("John Ronald", { periods: false, spaced: false })).toBe("JR");
  });

  it("preserves hyphenated given names", () => {
    expect(givenInitials("Jean-Paul", { periods: true, spaced: true })).toBe("J.-P.");
    expect(givenInitials("Jean-Paul", { periods: false, spaced: false })).toBe("J-P");
  });
});

describe("familyName / sortFamily", () => {
  it("folds particles into the family cluster for display", () => {
    const n = cslName("Beauvoir", "Simone", { droppingParticle: "de" });
    expect(familyName(n)).toBe("de Beauvoir");
  });

  it("excludes the dropping particle from the sort key and lowercases", () => {
    const n = cslName("Beauvoir", "Simone", { droppingParticle: "de" });
    expect(sortFamily(n)).toBe("beauvoir");
  });

  it("includes a non-dropping particle in both display and sort", () => {
    const n = cslName("Gogh", "Vincent", { nonDroppingParticle: "van" });
    expect(familyName(n)).toBe("van Gogh");
    expect(sortFamily(n)).toBe("van gogh");
  });

  it("sorts an organisational (literal) name by its literal", () => {
    const org = expectPresent(
      makeCslName({ literal: "World Health Organization" }),
      "a literal name",
    );
    expect(sortFamily(org)).toBe("world health organization");
  });
});

describe("formatOneName", () => {
  const apaOpts: NameListOptions = {
    initials: { periods: true, spaced: true },
    familyFirst: true,
    familyGivenSeparator: ", ",
    delimiter: ", ",
    finalDelimiter: ", & ",
    includeSuffix: true,
    maxNames: 20,
    displayBeforeEtAl: 19,
    etAl: "et al.",
  };

  it("renders a literal name verbatim", () => {
    const org = expectPresent(makeCslName({ literal: "OpenAI" }), "a literal name");
    expect(formatOneName(org, apaOpts)).toBe("OpenAI");
  });

  it("renders family-first with a suffix", () => {
    const n = cslName("King", "Martin Luther", { suffix: "Jr." });
    expect(formatOneName(n, apaOpts)).toBe("King, M. L., Jr.");
  });

  it("renders given-first when familyFirst is false", () => {
    const n = cslName("Smith", "Jane A");
    expect(formatOneName(n, { ...apaOpts, familyFirst: false })).toBe("J. A. Smith");
  });

  it("renders a family-only name", () => {
    const n = expectPresent(makeCslName({ family: "Aristotle" }), "a family name");
    expect(formatOneName(n, apaOpts)).toBe("Aristotle");
  });

  it("renders a given-only name", () => {
    const n = expectPresent(makeCslName({ given: "Cher" }), "a given name");
    expect(formatOneName(n, apaOpts)).toBe("C.");
  });

  it("omits the suffix when includeSuffix is false", () => {
    const n = cslName("King", "Martin Luther", { suffix: "Jr." });
    expect(formatOneName(n, { ...apaOpts, includeSuffix: false })).toBe("King, M. L.");
  });
});

describe("formatNameList", () => {
  const opts: NameListOptions = {
    initials: { periods: true, spaced: true },
    familyFirst: true,
    familyGivenSeparator: ", ",
    delimiter: ", ",
    finalDelimiter: ", & ",
    includeSuffix: false,
    maxNames: 3,
    displayBeforeEtAl: 2,
    etAl: "et al.",
  };
  const names = (n: number) => Array.makeBy(n, (i) => cslName(`Fam${i}`, `Giv${i}`));

  it("returns empty string for no names", () => {
    expect(formatNameList([], opts)).toBe("");
  });

  it("renders a single name", () => {
    expect(formatNameList(names(1), opts)).toBe("Fam0, G.");
  });

  it("joins two names with the final delimiter", () => {
    expect(formatNameList(names(2), opts)).toBe("Fam0, G., & Fam1, G.");
  });

  it("elides past the cap with et al.", () => {
    expect(formatNameList(names(5), opts)).toBe("Fam0, G., Fam1, G., et al.");
  });
});

describe("issuedYearText", () => {
  it("returns the year of the issued date", () => {
    expect(issuedYearText(Option.some(dateFromYear(1984)), enLocale)).toBe("1984");
  });

  it("returns the no-date term when the date is absent", () => {
    expect(issuedYearText(Option.none(), enLocale)).toBe("n.d.");
  });
});

describe("pagesLabel", () => {
  it("uses the singular label for a single page", () => {
    expect(pagesLabel("42", enLocale)).toBe("p.");
  });

  it.each(["12-40", "12–40"])("uses the plural label for a range (%s)", (range) => {
    expect(pagesLabel(range, enLocale)).toBe("pp.");
  });
});

describe("doiUrl / preferredUrl", () => {
  it("builds a resolver URL for a DOI", () => {
    expect(doiUrl("10.1/x")).toBe("https://doi.org/10.1/x");
  });

  it("prefers an explicit URL", () => {
    expect(preferredUrl({ URL: "https://example.com", identifiers: {} })).toStrictEqual(
      Option.some("https://example.com"),
    );
  });

  it("falls back to a DOI resolver URL", () => {
    expect(preferredUrl({ identifiers: { doi: doi("10.1234/jsb.2004.0043") } })).toStrictEqual(
      Option.some("https://doi.org/10.1234/jsb.2004.0043"),
    );
  });

  it("returns None when neither is present", () => {
    expect(preferredUrl({ identifiers: {} })).toStrictEqual(Option.none());
  });
});

describe("referenceClass", () => {
  it.each([
    ["book", "book"],
    ["classic", "book"],
    ["chapter", "chapter"],
    ["entry-encyclopedia", "chapter"],
    ["article-journal", "article"],
    ["paper-conference", "article"],
    ["webpage", "webpage"],
    ["dataset", "webpage"],
    ["map", "generic"],
    ["motion_picture", "generic"],
  ])("maps %s to the %s class", (type, expected) => {
    expect(referenceClass(type)).toBe(expected);
  });
});

// ── Structured output shape ───────────────────────────────────────────

describe("renderBibliography output shape", () => {
  it("numbers numeric-style entries and leaves author-date entries unlabelled", () => {
    const numeric = renderBibliography(mixed, { style: vancouverStyle });
    expect(numeric.style).toBe("vancouver");
    expect(numeric.entries[0].label).toStrictEqual(Option.some("1."));
    expect(numeric.entries[0].index).toBe(1);

    const dated = renderBibliography(mixed, { style: apaStyle });
    expect(dated.entries[0].label).toStrictEqual(Option.none());
  });
});

// ── Remaining branch coverage ─────────────────────────────────────────

describe("coverage edges", () => {
  const bare = (type: BiblioRecord["type"]): BiblioRecord => ({
    type,
    identifiers: {},
    provenance: { source: "manual" },
  });

  it("a numeric style's sort key is an inert empty string", () => {
    expect(vancouverStyle.sortKey(book)).toBe("");
  });

  it("Vancouver renders an author-less webpage", () => {
    const r: BiblioRecord = {
      ...bare("webpage"),
      title: "Orphan",
      "container-title": "Site",
      URL: "https://x.test",
      issued: dateFromYear(2009),
    };
    expect(renderReference(r, { style: vancouverStyle })).toBe(
      "Orphan [Internet]. Site. 2009. Available from: https://x.test",
    );
  });

  it("Vancouver renders an article with no volume/issue/page", () => {
    const r: BiblioRecord = {
      ...bare("article-journal"),
      title: "Bare Article",
      author: [cslName("Roe", "Jane")],
      "container-title": "J",
      issued: dateFromYear(2007),
    };
    expect(renderReference(r, { style: vancouverStyle })).toBe("Roe J. Bare Article. J. 2007.");
  });

  it("APA sorting falls back to the title (and year 0) for author-less, undated records", () => {
    const anon: BiblioRecord = { ...bare("book"), title: "Anonymous" };
    const bib = renderBibliography([book, anon], { style: apaStyle });
    expect(bib.entries[0].text).toContain("Anonymous");
  });
});
