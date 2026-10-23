/**
 * Unit tests for the writers (`src/write/`): `toBibtex` (both dialects),
 * `toRis` and `toCslYaml`, each pinned by its output for a small record and
 * by a round trip — every field the format models survives
 * `parse(write(records))` — over a corpus that exercises each mapping.
 *
 * @module tests/unit/biblio-write
 */

import * as Array from "effect/Array";
import * as Record from "effect/Record";
import { describe, expect, it } from "vite-plus/test";
import {
  type BiblioRecord,
  fromCslJson,
  parseBibtex,
  parseCslYaml,
  parseRis,
  type ParseOutcome,
  toBibtex,
  toCslJson,
  toCslYaml,
  toRis,
} from "@thomasfosterau/biblio";

/** The records of parsed outcomes, failing the test on a skipped one. */
function records(outcomes: readonly ParseOutcome[]): BiblioRecord[] {
  return outcomes.map((outcome) => {
    if (outcome.outcome !== "parsed") expect.fail(`skipped: ${outcome.reason}`);
    return outcome.record;
  });
}

/** A record's CSL-JSON, restricted to `keys`. */
const project = (record: BiblioRecord, keys: readonly string[]) =>
  Record.filter(toCslJson(record), (_, key) => keys.includes(key));

/** The round-trip corpus: one record per mapping worth pinning. */
const corpus: BiblioRecord[] = [
  {
    id: "harari2015",
    type: "book",
    title: "Sapiens: A Brief History of Humankind",
    "title-short": "Sapiens",
    author: [{ family: "Harari", given: "Yuval Noah" }],
    publisher: "Harper",
    "publisher-place": "New York",
    edition: "2",
    issued: { "date-parts": [[2015, 3, 14]] },
    language: "en-GB",
    keyword: "history, anthropology",
    note: "Translated from Hebrew.",
    abstract: "A history of the species.",
    URL: "https://example.org/sapiens?a=1&b=2",
    ISBN: "9780062316097",
  },
  {
    id: "kuhn",
    type: "article-journal",
    title: "Structure & Function of 50% of the_Things: $5 #1",
    author: [
      { family: "Berg", given: "Anna", "dropping-particle": "van der" },
      { family: "King", given: "Martin Luther", suffix: "Jr." },
      { literal: "World Health Organization" },
      { family: "de la Fuente", given: "María" },
    ],
    "container-title": "Journal of Science",
    "container-title-short": "J. Sci.",
    volume: "59",
    issue: "1",
    page: "29-40",
    issued: { "date-parts": [[2004, 6]] },
    DOI: "10.1037/0003-066X.59.1.29",
    ISSN: "0028-0836",
  },
  {
    id: "chapter1",
    type: "chapter",
    title: "On Method",
    author: [{ family: "Doe", given: "Jane" }],
    editor: [{ family: "Smith", given: "John" }],
    "container-title": "The Handbook",
    "collection-title": "Handbooks in Philosophy",
    "collection-number": "12",
    publisher: "Oxford University Press",
    page: "1-20",
    issued: { "date-parts": [[2015]] },
  },
  {
    id: "thesis1",
    type: "thesis",
    title: "On Things",
    author: [{ family: "Doe", given: "Jane" }],
    genre: "PhD thesis",
    publisher: "MIT",
    issued: { "date-parts": [[2020]] },
  },
  {
    id: "report1",
    type: "report",
    title: "Annual Report",
    author: [{ literal: "Acme Corp" }],
    number: "TR-7",
    genre: "Technical report",
    publisher: "Acme",
    issued: { "date-parts": [[2001], [2004]] },
  },
  {
    id: "conf1",
    type: "paper-conference",
    title: "A Paper",
    author: [{ family: "Lee", given: "Kim" }],
    "container-title": "Proceedings of Things",
    "event-title": "Things Conference",
    "event-place": "Sydney",
    "event-date": {
      "date-parts": [
        [2019, 7, 1],
        [2019, 7, 5],
      ],
    },
    issued: { "date-parts": [[2019]], season: 2 },
  },
  {
    id: "web1",
    type: "webpage",
    title: "A Page",
    URL: "https://example.org/page_1",
    accessed: { "date-parts": [[2024, 1, 2]] },
    issued: { "date-parts": [[2023]], circa: true },
  },
  {
    id: "arxiv1",
    type: "article-journal",
    URL: "https://arxiv.org/abs/1706.03762",
    title: "Attention",
    author: [{ family: "Vaswani", given: "Ashish" }],
    number: "arXiv:1706.03762",
    issued: { "date-parts": [[2017]] },
  },
  {
    id: "unicode",
    type: "book",
    title: "Schön’s “Straße” – Øresund {braces} \\ back ~ tilde ^ caret -- dash '' quotes",
    author: [
      { family: "Gödel", given: "Kurt" },
      { family: "Çelik", given: "Ayşe" },
    ],
    "original-title": "Ursprünglich",
    issued: { literal: "forthcoming" },
  },
  {
    id: "pubmed1",
    type: "article-journal",
    title: "A Study",
    PMID: "12345678",
    PMCID: "PMC1234567",
    issued: { "date-parts": [[2010]] },
  },
].map((item) => fromCslJson({ ...item, "citation-key": item.id }));

/** The CSL variables a BibLaTeX round trip keeps. */
const BIBLATEX_KEYS = [
  "id",
  "citation-key",
  "type",
  "title",
  "title-short",
  "author",
  "editor",
  "container-title",
  "container-title-short",
  "collection-title",
  "collection-number",
  "publisher",
  "publisher-place",
  "edition",
  "volume",
  "issue",
  "number",
  "page",
  "genre",
  "language",
  "keyword",
  "note",
  "abstract",
  "URL",
  "issued",
  "accessed",
  "event-date",
  "event-title",
  "event-place",
  "original-title",
  "ISBN",
  "DOI",
  "ISSN",
  "PMID",
  "PMCID",
];

describe("toBibtex", () => {
  it("writes a BibLaTeX entry", () => {
    expect(toBibtex([corpus[0]])).toBe(
      [
        "@book{harari2015,",
        "  author = {Harari, Yuval Noah},",
        "  title = {Sapiens: A Brief History of Humankind},",
        "  shorttitle = {Sapiens},",
        "  edition = {2},",
        "  publisher = {Harper},",
        "  location = {New York},",
        "  date = {2015-03-14},",
        "  langid = {british},",
        "  keywords = {history, anthropology},",
        "  isbn = {9780062316097},",
        "  url = {https://example.org/sapiens?a=1&b=2},",
        "  abstract = {A history of the species.},",
        "  note = {Translated from Hebrew.},",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes a classic BibTeX entry: journal, year / month, ASCII accents", () => {
    const bib = toBibtex([corpus[1], corpus[8]], { dialect: "bibtex" });
    expect(bib).toContain("@article{kuhn,");
    expect(bib).toContain("  journal = {Journal of Science},");
    expect(bib).toContain("  number = {1},");
    expect(bib).toContain("  year = {2004},\n  month = jun,");
    expect(bib).toContain("  pages = {29--40},");
    expect(bib).toContain(
      "  author = {van der Berg, Anna and King, Jr., Martin Luther and {World Health Organization} and {de la Fuente}, Mar{\\'\\i}a},",
    );
    expect(bib).toContain("@book{unicode,");
    expect(bib).toContain("Sch{\\\"o}n's ``Stra{\\ss}e'' -- {\\O}resund");
    expect(bib).toContain('author = {G{\\"o}del, Kurt and {\\c{C}}elik, Ay{\\c{s}}e}');
    expect(Array.fromIterable(bib).every((char) => char.charCodeAt(0) < 128)).toBe(true);
  });

  it("escapes LaTeX specials and keeps markup as commands", () => {
    const [record] = [
      fromCslJson({
        type: "article-journal",
        title: 'The <i>E. coli</i> <span class="nocase">DNA</span> and CO<sub>2</sub> <b>bold</b>',
      }),
    ];
    const bib = toBibtex([record]);
    expect(bib).toContain(
      "  title = {The \\emph{E. coli} {DNA} and CO\\textsubscript{2} \\textbf{bold}},",
    );
    expect(toBibtex([corpus[1]])).toContain(
      "  title = {Structure \\& Function of 50\\% of the\\_Things: \\$5 \\#1},",
    );
  });

  it("generates keys, and suffixes a key already used", () => {
    const anonymous = fromCslJson({
      type: "book",
      title: "The Origin of Species",
      author: [{ family: "Darwin", given: "Charles" }],
      issued: { "date-parts": [[1859]] },
    });
    const keyed = (key: string) => fromCslJson({ type: "book", title: "T", "citation-key": key });
    const keys = toBibtex([anonymous, anonymous, keyed("a b,c"), keyed("ab,c"), fromCslJson({})])
      .split("\n")
      .filter((line) => line.startsWith("@"));
    expect(keys).toEqual([
      "@book{darwin1859origin,",
      "@book{darwin1859origina,",
      "@book{abc,",
      "@book{abca,",
      "@misc{ref,",
    ]);
  });

  it("writes `and others` back and the tex.* passthrough", () => {
    const [parsed] = records(
      parseBibtex(
        "@misc{k, title = {T}, author = {Doe, Jane and others}, howpublished = {Print}, foo = {Bar}}",
        {
          mode: "lenient",
        },
      ),
    );
    const bib = toBibtex([parsed]);
    expect(bib).toContain("  author = {Doe, Jane and others},");
    expect(bib).toContain("  foo = {Bar},");
  });

  it("round-trips every modelled field through parseBibtex (BibLaTeX)", () => {
    const back = records(parseBibtex(toBibtex(corpus), { mode: "lenient" }));
    expect(back.map((record) => project(record, BIBLATEX_KEYS))).toEqual(
      corpus.map((record) => project(record, BIBLATEX_KEYS)),
    );
    expect(back[7].identifiers.arxiv).toBe("1706.03762");
  });

  it("round-trips the classic BibTeX types and fields", () => {
    const classic = Array.filter(corpus, (record) =>
      ["book", "article-journal", "chapter", "thesis", "report", "paper-conference"].includes(
        record.type,
      ),
    );
    const keys = BIBLATEX_KEYS.filter(
      (key) => !["title", "language", "event-date", "issued"].includes(key),
    );
    const back = records(
      parseBibtex(toBibtex(classic, { dialect: "bibtex" }), { mode: "lenient" }),
    );
    expect(back.map((record) => project(record, keys))).toEqual(
      classic.map((record) => project(record, keys)),
    );
    // The ASCII spelling decodes back to the same title, except the
    // typographic quotes and the apostrophe, which BibTeX writes as ASCII.
    expect(back.map((record) => record.title)).toEqual(
      classic.map((record) => record.title?.replace("’", "'")),
    );
  });

  it("writes a type with no entry type of its own as @misc", () => {
    const bib = toBibtex([fromCslJson({ type: "article", title: "A preprint" })]);
    expect(bib.split("\n")[0]).toBe("@misc{preprint,");
  });

  it("writes nothing for no records", () => {
    expect(toBibtex([])).toBe("");
  });
});

describe("toRis", () => {
  it("writes an RIS record with CRLF line ends", () => {
    expect(toRis([corpus[1]])).toBe(
      [
        "TY  - JOUR",
        "ID  - kuhn",
        "TI  - Structure & Function of 50% of the_Things: $5 #1",
        "AU  - van der Berg, Anna",
        "AU  - King, Martin Luther, Jr.",
        "AU  - World Health Organization",
        "AU  - de la Fuente, María",
        "T2  - Journal of Science",
        "J2  - J. Sci.",
        "PY  - 2004",
        "DA  - 2004/06//",
        "VL  - 59",
        "IS  - 1",
        "SP  - 29",
        "EP  - 40",
        "SN  - 0028-0836",
        "DO  - 10.1037/0003-066x.59.1.29",
        "ER  - ",
        "",
      ].join("\r\n"),
    );
  });

  it("round-trips the fields parseRis reads", () => {
    const keys = [
      "id",
      "citation-key",
      "type",
      "title",
      "editor",
      "container-title",
      "publisher",
      "volume",
      "issue",
      "page",
      "ISBN",
      "DOI",
      "ISSN",
    ];
    const ris = Array.filter(corpus, (record) =>
      ["book", "article-journal", "chapter", "thesis", "report", "paper-conference"].includes(
        record.type,
      ),
    );
    const back = records(parseRis(toRis(ris), { mode: "lenient" }));
    expect(back.map((record) => project(record, keys))).toEqual(
      ris.map((record) => project(record, keys)),
    );
    expect(back.map((record) => record.issued?.["date-parts"]?.[0]?.[0])).toEqual(
      ris.map((record) => record.issued?.["date-parts"]?.[0]?.[0]),
    );
    // Personal names (and their suffixes) survive; RIS has no corporate form.
    expect(back[1].author?.slice(0, 2)).toEqual([
      { family: "van der Berg", given: "Anna" },
      { family: "King", given: "Martin Luther", suffix: "Jr." },
    ]);
  });
});

describe("CSL YAML", () => {
  it("round-trips every CSL variable through parseCslYaml", () => {
    const back = records(parseCslYaml(toCslYaml(corpus), { mode: "lenient" }));
    expect(back.map(toCslJson)).toEqual(
      corpus.map(toCslJson).map((item, index) =>
        // A mapping's plain number reads back as text (as Pandoc reads it), and
        // CSL admits a season either way.
        index === 5 ? { ...item, issued: { "date-parts": [[2019]], season: "2" } } : item,
      ),
    );
  });

  it("writes an empty list for no records", () => {
    expect(toCslYaml([])).toBe("---\nreferences: []\n...\n");
    expect(parseCslYaml(toCslYaml([]))).toEqual([]);
  });

  it("reads the YAML Pandoc writes: plain scalars, block lists, block scalars, comments", () => {
    const yaml = [
      "---",
      "# a bibliography",
      "references:",
      "- type: article-journal",
      "  id: doe2020",
      "  author:",
      "    - family: Doe",
      "      given: Jane",
      "    - {family: Roe, given: 'Richard ''Dick'''}",
      "  title: >-",
      "    A long title",
      "    folded onto lines",
      "  abstract: |",
      "    First line.",
      "    Second line.",
      '  container-title: "Journal of \\"Things\\""  # trailing comment',
      "  issued:",
      "    date-parts:",
      "    - - 2020",
      "      - 5",
      "  DOI: 10.1000/xyz123",
      "  URL: https://example.org/#frag",
      "...",
    ].join("\n");
    const [record] = records(parseCslYaml(yaml));
    expect(record).toMatchObject({
      type: "article-journal",
      id: "doe2020",
      title: "A long title folded onto lines",
      abstract: "First line. Second line.",
      "container-title": 'Journal of "Things"',
      author: [
        { family: "Doe", given: "Jane" },
        { family: "Roe", given: "Richard 'Dick'" },
      ],
      issued: { "date-parts": [[2020, 5]] },
      URL: "https://example.org/#frag",
    });
    expect(record.identifiers.doi).toBe("10.1000/xyz123");
  });

  it("applies the import policy and reads a bare list", () => {
    const outcomes = parseCslYaml(
      "- title: No identifier\n- type: book\n  title: T\n  ISBN: 9780062316097\n",
    );
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["skipped", "parsed"]);
  });

  it("rejects YAML outside the subset, and a document with no references, as malformed", () => {
    expect(parseCslYaml("references:\n- &a {title: T}\n- *a\n")).toEqual([
      { outcome: "skipped", reason: "malformed" },
    ]);
    expect(parseCslYaml("title: Just a document\n")).toEqual([
      { outcome: "skipped", reason: "malformed" },
    ]);
    expect(parseCslYaml("references:\n  - [unclosed\n")).toEqual([
      { outcome: "skipped", reason: "malformed" },
    ]);
  });
});

describe("CSL YAML reader edge cases", () => {
  /** The single record a lenient read yields, or the outcome when it is not one. */
  const one = (yaml: string) => parseCslYaml(yaml, { mode: "lenient" });

  it("reads quoted escapes, multi-line scalars and null values", () => {
    const [outcome] = one(
      [
        "references:",
        "- type: book",
        '  title: "Tab\\there \\u00e9\\x41\\U0001F600 \\"q\\""',
        "  note: a plain scalar",
        "    continued here",
        "  abstract: >",
        "    folded",
        "",
        "    paragraph",
        "  annote: |+",
        "    kept",
        "  publisher: ~",
        "  edition: null",
        "  categories: [a, 'b, c', \"d\"]",
        "  author:",
        "  -",
        "    family: Nested",
        "  - {}",
        "  issued: {date-parts: [[2001, 2]], circa: true}",
        "  volume:",
        "  keyword: true",
      ].join("\n"),
    );
    if (outcome.outcome !== "parsed") return expect.fail("expected a record");
    expect(outcome.record).toMatchObject({
      title: 'Tab here éA😀 "q"',
      note: "a plain scalar continued here",
      abstract: "folded paragraph",
      annote: "kept",
      categories: ["a", "b, c", "d"],
      author: [{ family: "Nested" }],
      issued: { "date-parts": [[2001, 2]], circa: true },
    });
    expect(outcome.record.publisher).toBeUndefined();
  });

  it("reads a block scalar that ends the document, and an empty value at the end", () => {
    const [outcome] = one("references:\n- title: T\n  abstract: |-\n    last");
    expect(outcome.outcome === "parsed" ? outcome.record.abstract : undefined).toBe("last");
    expect(one("references:\n- title: T\n  note:")[0].outcome).toBe("parsed");
    expect(one("references:\n- title: T\n  abstract: |\n")[0].outcome).toBe("parsed");
    expect(one("")).toEqual([{ outcome: "skipped", reason: "malformed" }]);
  });

  it.each([
    ["a bad escape", 'references:\n- title: "\\q"'],
    ["an escape past Unicode", 'references:\n- title: "\\UFFFFFFFF"'],
    ["an unclosed quote", "references:\n- title: 'open"],
    ["a stray single quote", "references:\n- title: 'a'b'"],
    ["an unescaped double quote", 'references:\n- title: "a"b"'],
    ["a tag", "references:\n- title: !!str T"],
    ["a mapping in a plain scalar's continuation", "references:\n- note: a\n    b: c"],
    ["a tab indent", "references:\n\t- title: T"],
    ["a bad flow mapping", "references:\n- {title T}"],
    ["a bad flow value", "references:\n- {title: [x}"],
    ["a flow alias", "references:\n- [*a]"],
    ["a bad quoted flow value", "references:\n- ['open]"],
    ["text after a flow list", "references:\n- [a] b"],
    ["flow nesting past the limit", `references:\n- ${"[".repeat(70)}${"]".repeat(70)}`],
    ["a list entry after the root mapping", "references: []\n- y"],
  ])("rejects %s", (_, yaml) => {
    expect(parseCslYaml(yaml)).toEqual([{ outcome: "skipped", reason: "malformed" }]);
  });

  it("rejects block nesting past the limit", () => {
    const deep = Array.makeBy(70, (level) => `${"  ".repeat(level)}k:`).join("\n");
    expect(parseCslYaml(`references:\n- ${deep}`)).toEqual([
      { outcome: "skipped", reason: "malformed" },
    ]);
  });
});

describe("writer edge cases", () => {
  it("writes BibTeX names, languages and subtypes the corpus does not", () => {
    const record = fromCslJson({
      type: "article-magazine",
      title: "中文 and ż",
      author: [{ family: "Smith", suffix: "III" }, { family: "Two Words" }, { given: "Only" }],
      editor: [{ family: "Gogh", given: "Vincent", "non-dropping-particle": "van" }],
      language: "x-klingon",
      genre: "Field notes",
      issued: { "date-parts": [[2020, 5]], season: 1 },
    });
    const biblatex = toBibtex([record]);
    expect(biblatex).toContain("  author = {Smith, III, and Two Words, and , Only},");
    expect(biblatex).toContain("  entrysubtype = {magazine},");
    expect(biblatex).toContain("  language = {x-klingon},");
    expect(biblatex).toContain("  type = {Field notes},");
    expect(biblatex).toContain("  options = {useprefix=true},");
    const bibtex = toBibtex([record], { dialect: "bibtex" });
    expect(bibtex).toContain("  title = {中文 and {\\.z}},");
    expect(bibtex).not.toContain("entrysubtype");
    expect(bibtex).toContain("  year = {2020-05},");
    const [back] = records(parseBibtex(biblatex, { mode: "lenient" }));
    expect(back.editor).toEqual([
      { family: "Gogh", given: "Vincent", "non-dropping-particle": "van" },
    ]);
  });

  it("writes a type RIS has no tag for as GEN, and skips an empty RIS name", () => {
    const ris = toRis([
      fromCslJson({ type: "interview", title: "Talk", author: [{ literal: "Anon" }] }),
    ]);
    expect(ris.split("\r\n")[0]).toBe("TY  - GEN");
    expect(
      records(parseRis("TY  - GEN\r\nTI  - T\r\nAU  - , , \r\nER  - ", { mode: "lenient" }))[0]
        .author,
    ).toBeUndefined();
    expect(toRis([])).toBe("");
  });

  it("writes an empty mapping in a list as {}", () => {
    const record = fromCslJson({ type: "book", title: "T", custom: [{}] });
    expect(toCslYaml([record])).toContain("- custom:\n  - {}");
  });
});
