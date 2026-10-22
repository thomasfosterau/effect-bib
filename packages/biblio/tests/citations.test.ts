/**
 * Unit tests for in-text citation rendering (`src/render/citations.ts`),
 * the rich-text output (`src/render/rich.ts`) and the Chicago notes style.
 *
 * A citation pass is pinned by its plain-text output for each style
 * category: author-date (grouping, narrative citations, disambiguation by
 * names, initials and year suffix, with the suffix in the bibliography),
 * numeric (first-citation numbering, range compression) and note
 * (first / subsequent / ibid positions). The rich-text adapters are
 * pinned by their HTML and Markdown, including escaping and unsafe links.
 *
 * @module tests/unit/biblio-citations
 */

import { describe, expect, it } from "vite-plus/test";
import {
  apaStyle,
  type BiblioRecord,
  bibliographyToText,
  bold,
  type CitationCluster,
  type CitationStyle,
  chicagoNotesStyle,
  concat,
  display,
  fromCslJson,
  getStyle,
  italic,
  joinRich,
  link,
  type Locale,
  type LocatorLabel,
  enLocale,
  renderBibliography,
  renderCitations,
  renderReference,
  renderReferenceRich,
  smallCaps,
  subscript,
  superscript,
  terminateRich,
  text,
  toHtml,
  toMarkdown,
  toPlainText,
  vancouverStyle,
} from "@thomasfosterau/biblio";
import * as Option from "effect/Option";
import { expectPresent } from "./assert.ts";

/** A record from loose CSL-JSON. */
const csl = fromCslJson;

const person = (family: string, given: string) => ({ family, given });

const records: ReadonlyArray<readonly [string, BiblioRecord]> = [
  [
    "ray2004",
    csl({
      type: "article-journal",
      title: "Can loneliness be lethal?",
      author: [person("Ray", "Oakley")],
      "container-title": "Nature",
      volume: "431",
      issue: "7006",
      page: "231-232",
      issued: { "date-parts": [[2004]] },
      DOI: "10.1038/431231a",
    }),
  ],
  [
    "smith2001",
    csl({
      type: "book",
      title: "First",
      author: [person("Smith", "Jo")],
      issued: { "date-parts": [[2001]] },
    }),
  ],
  [
    "smith2004a",
    csl({
      type: "book",
      title: "Second",
      author: [person("Smith", "Jo")],
      issued: { "date-parts": [[2004]] },
    }),
  ],
  [
    "smith2004b",
    csl({
      type: "book",
      title: "Third",
      author: [person("Smith", "Jo")],
      issued: { "date-parts": [[2004]] },
    }),
  ],
  [
    "harari",
    csl({
      type: "book",
      title: "Sapiens: A Brief History of Humankind",
      author: [person("Harari", "Yuval Noah")],
      publisher: "Harper",
      "publisher-place": "New York",
      issued: { "date-parts": [[2015]] },
    }),
  ],
];

/** The record cited as `id`. */
const recordOf = (id: string): BiblioRecord =>
  expectPresent(records.find(([key]) => key === id)?.[1], `record ${id}`);

/** The plain text of each rendered cluster. */
const texts = (
  clusters: readonly CitationCluster[],
  style: CitationStyle,
  nocite?: readonly string[] | "*",
) =>
  renderCitations(
    clusters,
    records,
    nocite === undefined ? { style } : { style, nocite },
  ).citations.map((citation) => citation.text);

describe("rich text", () => {
  const rich = concat(
    italic(text("Nature")),
    text(" <&> "),
    bold(text("b")),
    smallCaps(text("sc")),
    superscript(text("2")),
    subscript(text("x")),
    link("https://example.org/a b", text("link")),
  );

  it("renders as plain text, HTML and Markdown", () => {
    expect(toPlainText(rich)).toBe("Nature <&> bsc2xlink");
    expect(toHtml(rich)).toBe(
      '<i>Nature</i> &lt;&amp;&gt; <b>b</b><span style="font-variant:small-caps;">sc</span><sup>2</sup><sub>x</sub><a href="https://example.org/a b">link</a>',
    );
    expect(toMarkdown(rich)).toBe(
      '*Nature* \\<&\\> **b**<span style="font-variant:small-caps;">sc</span><sup>2</sup><sub>x</sub>[link](https://example.org/a%20b)',
    );
  });

  it("drops a link whose URL is not http(s) or mailto, keeping its text", () => {
    const hostile = link("javascript:alert(1)", text("click"));
    expect(toHtml(hostile)).toBe("click");
    expect(toMarkdown(hostile)).toBe("click");
    expect(toHtml(link("mailto:me@example.org"))).toBe(
      '<a href="mailto:me@example.org">mailto:me@example.org</a>',
    );
  });

  it("renders display regions and builds nothing from empty parts", () => {
    expect(toHtml(display("left-margin", text("1.")))).toBe(
      '<div class="csl-left-margin">1.</div>',
    );
    expect(toMarkdown(display("block", text("x")))).toBe("x");
    expect(italic([])).toEqual([]);
    expect(link("https://x", [])).toEqual([]);
    expect(display("block", [])).toEqual([]);
  });

  it("trims whitespace inside formatting at either end", () => {
    const padded = concat(italic(text("  ")), text(" a "), bold(text(" ")));
    expect(toHtml(joinRich([Option.some(padded)], ", "))).toBe("a");
  });

  it("joins trimmed non-blank parts and terminates once", () => {
    const joined = joinRich(
      [
        Option.some(text("  a ")),
        Option.none(),
        Option.some(text("   ")),
        Option.some(italic(text("b "))),
      ],
      ", ",
    );
    expect(toHtml(joined)).toBe("a, <i>b</i>");
    expect(toPlainText(terminateRich(joined))).toBe("a, b.");
    expect(terminateRich(text("Done?"))).toEqual(text("Done?"));
    expect(terminateRich([])).toEqual([]);
  });
});

describe("rich references", () => {
  it("italicises APA's journal and volume and links the DOI, with the same plain text", () => {
    const article = recordOf("ray2004");
    const rich = renderReferenceRich(article, { style: apaStyle });
    expect(toHtml(rich)).toBe(
      'Ray, O. (2004). Can loneliness be lethal? <i>Nature</i>, <i>431</i>(7006), 231-232. <a href="https://doi.org/10.1038/431231a">https://doi.org/10.1038/431231a</a>',
    );
    expect(toPlainText(rich)).toBe(renderReference(article, { style: apaStyle }));
  });

  it("gives a style without a rich renderer its plain text, and every entry rich text", () => {
    // Vancouver has no rich renderer: its rich reference is its text.
    const harari = recordOf("harari");
    expect(toPlainText(renderReferenceRich(harari, { style: vancouverStyle }))).toBe(
      renderReference(harari, { style: vancouverStyle }),
    );
    const bibliography = renderBibliography([harari], { style: apaStyle });
    expect(toHtml(bibliography.entries[0]?.rich ?? [])).toBe(
      "Harari, Y. N. (2015). <i>Sapiens: A Brief History of Humankind</i>. Harper.",
    );
  });
});

describe("author-date citations", () => {
  it("sorts and groups a cluster by author, with locators", () => {
    expect(
      texts(
        [{ cites: [{ id: "smith2001" }, { id: "ray2004", locator: "5" }, { id: "harari" }] }],
        apaStyle,
      ),
    ).toEqual(["(Harari, 2015; Ray, 2004, p. 5; Smith, 2001)"]);
  });

  it("renders narrative, author-only and suppress-author cites", () => {
    expect(
      texts(
        [
          {
            cites: [
              { id: "ray2004", mode: "author-in-text", locator: "231-232" },
              { id: "harari" },
            ],
          },
          { cites: [{ id: "ray2004", mode: "author-only" }] },
          {
            cites: [
              { id: "harari", mode: "suppress-author", prefix: "see", suffix: "for a survey" },
            ],
          },
        ],
        apaStyle,
      ),
    ).toEqual(["Ray (2004, pp. 231-232; Harari, 2015)", "Ray", "(see 2015 for a survey)"]);
  });

  it("disambiguates with year suffixes that the bibliography repeats", () => {
    const result = renderCitations(
      [{ cites: [{ id: "smith2004b" }, { id: "smith2001" }] }, { cites: [{ id: "smith2004a" }] }],
      records,
      { style: apaStyle },
    );
    expect(result.citations.map((citation) => citation.text)).toEqual([
      "(Smith, 2001, 2004b)",
      "(Smith, 2004a)",
    ]);
    expect(bibliographyToText(result.bibliography)).toBe(
      ["Smith, J. (2001). First.", "Smith, J. (2004a). Second.", "Smith, J. (2004b). Third."].join(
        "\n",
      ),
    );
    expect(result.bibliography.entries.map((entry) => entry.id)).toEqual([
      "smith2001",
      "smith2004a",
      "smith2004b",
    ]);
  });

  it("disambiguates by more names, then by initials", () => {
    const local: ReadonlyArray<readonly [string, BiblioRecord]> = [
      [
        "a",
        csl({
          type: "book",
          title: "A",
          author: [person("Lee", "Al"), person("Kim", "Bo"), person("Wu", "Cy")],
          issued: { "date-parts": [[2010]] },
        }),
      ],
      [
        "b",
        csl({
          type: "book",
          title: "B",
          author: [person("Lee", "Al"), person("Park", "Bo"), person("Wu", "Cy")],
          issued: { "date-parts": [[2010]] },
        }),
      ],
      [
        "c",
        csl({
          type: "book",
          title: "C",
          author: [person("Chan", "Jo")],
          issued: { "date-parts": [[2012]] },
        }),
      ],
      [
        "d",
        csl({
          type: "book",
          title: "D",
          author: [person("Chan", "Mo")],
          issued: { "date-parts": [[2012]] },
        }),
      ],
      ["e", csl({ type: "book", title: "E" })],
      ["f", csl({ type: "book", title: "F" })],
    ];
    const result = renderCitations(
      [
        { cites: [{ id: "a" }, { id: "b" }] },
        { cites: [{ id: "c" }, { id: "d" }] },
        { cites: [{ id: "e" }, { id: "f" }] },
      ],
      local,
      { style: apaStyle },
    );
    expect(result.citations.map((citation) => citation.text)).toEqual([
      "(Lee, Kim, et al., 2010; Lee, Park, et al., 2010)",
      "(J. Chan, 2012; M. Chan, 2012)",
      "(E, n.d.; F, n.d.)",
    ]);
  });

  it("gives identical citations year suffixes, n.d.-a for undated works", () => {
    const local: ReadonlyArray<readonly [string, BiblioRecord]> = [
      ["x", csl({ type: "book", title: "Same", author: [person("Doe", "Jo")] })],
      ["y", csl({ type: "book", title: "Same too", author: [person("Doe", "Jo")] })],
    ];
    expect(
      renderCitations([{ cites: [{ id: "x" }, { id: "y" }] }], local, { style: apaStyle })
        .citations[0]?.text,
    ).toBe("(Doe, n.d.-a, n.d.-b)");
  });

  it("marks an unknown id and reports it as missing", () => {
    expect(texts([{ cites: [{ id: "gone", mode: "author-in-text" }] }], apaStyle)).toEqual([
      "gone? (gone?)",
    ]);
    expect(
      texts(
        [{ cites: [{ id: "gone" }, { id: "lost", locator: "2" }, { id: "harari" }] }],
        vancouverStyle,
      ),
    ).toEqual(["[1, gone?, lost?]"]);
    const result = renderCitations([{ cites: [{ id: "nope" }, { id: "ray2004" }] }], records, {
      style: apaStyle,
    });
    expect(result.citations[0]?.text).toBe("(nope?; Ray, 2004)");
    expect(toHtml(result.citations[0]?.rich ?? [])).toBe("(<b>nope?</b>; Ray, 2004)");
    expect(result.missing).toEqual(["nope"]);
  });

  it("adds nocite records to the bibliography, or every record with *", () => {
    const listed = renderCitations([{ cites: [{ id: "ray2004" }] }], records, {
      style: apaStyle,
      nocite: ["harari", "unknown"],
    });
    expect(listed.bibliography.entries.map((entry) => entry.id)).toEqual(["harari", "ray2004"]);
    const all = renderCitations([], records, { style: apaStyle, nocite: "*" });
    expect(all.bibliography.entries).toHaveLength(records.length);
  });

  it("shows a locator with an unknown label bare", () => {
    // SAFETY: a caller outside TypeScript can pass any label; it renders without a term.
    const label = "bogus" as LocatorLabel;
    expect(texts([{ cites: [{ id: "harari", locator: "7", label }] }], apaStyle)).toEqual([
      "(Harari, 2015, 7)",
    ]);
  });

  it("labels locators from the locale, plural for a range", () => {
    const locale: Locale = { ...enLocale, locators: { chapter: ["ch.", "chs."] } };
    const result = renderCitations(
      [
        {
          cites: [
            { id: "ray2004", locator: "3-4", label: "chapter" },
            { id: "harari", locator: "2", label: "section" },
            { id: "smith2001", locator: "12:30", label: "timestamp" },
          ],
        },
      ],
      records,
      { style: apaStyle, locale },
    );
    expect(result.citations[0]?.text).toBe(
      "(Harari, 2015, sec. 2; Ray, 2004, chs. 3-4; Smith, 2001, 12:30)",
    );
  });
});

describe("numeric citations", () => {
  it("numbers sources by first citation and compresses runs", () => {
    const clusters: CitationCluster[] = [
      { cites: [{ id: "ray2004" }] },
      { cites: [{ id: "harari" }, { id: "smith2001" }, { id: "smith2004a" }] },
      {
        cites: [
          { id: "smith2004a" },
          { id: "ray2004" },
          { id: "smith2001" },
          { id: "harari" },
          { id: "smith2004b" },
        ],
      },
      {
        cites: [
          { id: "harari", locator: "12" },
          { id: "ray2004", mode: "author-in-text" },
        ],
      },
      { cites: [{ id: "ray2004", mode: "author-in-text" }, { id: "harari" }] },
      { cites: [{ id: "ray2004", mode: "author-only" }] },
    ];
    expect(texts(clusters, vancouverStyle)).toEqual([
      "[1]",
      "[2–4]",
      "[1–5]",
      "[1, 2, p. 12]",
      "Ray [1, 2]",
      "Ray",
    ]);
    const result = renderCitations(clusters, records, { style: vancouverStyle });
    expect(result.bibliography.entries.map((entry) => entry.label)).toEqual(
      ["1.", "2.", "3.", "4.", "5."].map(Option.some),
    );
  });
});

describe("note citations", () => {
  it("gives first, subsequent and ibid notes their forms", () => {
    const result = renderCitations(
      [
        { cites: [{ id: "harari", locator: "23" }] },
        { cites: [{ id: "harari", locator: "23" }] },
        { cites: [{ id: "harari", locator: "40" }] },
        { cites: [{ id: "harari" }] },
        {
          cites: [
            { id: "ray2004", locator: "231" },
            { id: "harari", prefix: "see also" },
          ],
        },
        { cites: [{ id: "ray2004", locator: "232" }] },
        { cites: [{ id: "ray2004", locator: "232" }, { id: "ray2004" }] },
        { cites: [{ id: "smith2001", mode: "author-only" }, { id: "nope" }] },
      ],
      records,
      { style: chicagoNotesStyle },
    );
    expect(result.citations.map((citation) => citation.text)).toEqual([
      "Yuval Noah Harari, Sapiens: A Brief History of Humankind (New York: Harper, 2015), 23.",
      "Ibid.",
      "Ibid., 40.",
      "Harari, Sapiens.",
      "Oakley Ray, “Can loneliness be lethal?” Nature 431, no. 7006 (2004), 231; see also Harari, Sapiens.",
      "Ray, “Can loneliness be lethal?” 232.",
      // A repeat without the locator the cite before had is "subsequent", not "ibid".
      "Ibid.; Ray, “Can loneliness be lethal?”",
      "Smith; nope?",
    ]);
    expect(result.citations.map((citation) => citation.positions)).toEqual([
      ["first"],
      ["ibid"],
      ["ibid-with-locator"],
      ["subsequent"],
      ["first", "subsequent"],
      ["subsequent"],
      ["ibid", "subsequent"],
      ["first", "first"],
    ]);
  });

  it("renders a Chicago bibliography for each kind of work", () => {
    const works = [
      csl({
        type: "chapter",
        title: "On Method",
        author: [person("Doe", "Jane"), person("Roe", "Ann")],
        editor: [person("Poe", "Ed")],
        "container-title": "The Handbook",
        publisher: "OUP",
        "publisher-place": "Oxford",
        page: "1-20",
        issued: { "date-parts": [[2010]] },
      }),
      csl({
        type: "webpage",
        title: "A Page",
        "container-title": "Site",
        URL: "https://example.org",
        issued: { "date-parts": [[2020]] },
      }),
      csl({
        type: "report",
        title: "A Report",
        author: [{ literal: "WHO" }],
        publisher: "WHO",
        edition: "2",
      }),
      csl({
        type: "book",
        title: "Many",
        edition: "3",
        author: Array.from({ length: 11 }, (_, i) => person(`F${i}`, "G")),
      }),
    ];
    expect(
      renderBibliography(works, { style: chicagoNotesStyle }).entries.map((entry) => entry.text),
    ).toEqual([
      "“A Page.” Site. 2020. https://example.org.",
      "Doe, Jane, and Ann Roe. “On Method.” In The Handbook, edited by Ed Poe, 1-20. Oxford: OUP, 2010.",
      "F0, G, G F1, G F2, G F3, G F4, G F5, G F6, et al. Many. 3 ed. n.d.",
      "WHO. A Report. WHO, n.d.",
    ]);
    const notes = renderCitations(
      works.map((_, i) => ({ cites: [{ id: `${i}` }] })),
      works.map((record, i) => [`${i}`, record] as const),
      { style: chicagoNotesStyle },
    );
    expect(notes.citations.map((citation) => citation.text)).toEqual([
      "Jane Doe and Ann Roe, “On Method,” in The Handbook, ed. Ed Poe (Oxford: OUP, 2010).",
      "“A Page,” Site, 2020.",
      "WHO, A Report (WHO, n.d.).",
      "G F0 et al., Many (n.d.).",
    ]);
    const untitled = renderCitations(
      [{ cites: [{ id: "u" }] }],
      [["u", csl({ type: "book", author: [person("Poe", "Ed")], publisher: "P" })]],
      { style: chicagoNotesStyle },
    );
    expect(untitled.citations[0]?.text).toBe("Ed Poe, (P, n.d.).");
  });

  it("defaults a note style's forms to the reference and a short title", () => {
    const plainNotes: CitationStyle = { ...apaStyle, id: "notes", category: "note" };
    expect(
      renderCitations(
        [
          { cites: [{ id: "harari" }] },
          { cites: [{ id: "ray2004" }] },
          { cites: [{ id: "harari", locator: "5" }] },
        ],
        records,
        { style: plainNotes },
      ).citations.map((citation) => citation.text),
    ).toEqual([
      "Harari, Y. N. (2015). Sapiens: A Brief History of Humankind. Harper.",
      "Ray, O. (2004). Can loneliness be lethal? Nature, 431(7006), 231-232. https://doi.org/10.1038/431231a.",
      "Harari, Sapiens, p. 5.",
    ]);
    expect(getStyle("chicago-notes")).toBe(chicagoNotesStyle);
  });
});
