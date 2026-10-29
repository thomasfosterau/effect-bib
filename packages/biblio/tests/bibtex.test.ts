/**
 * Unit tests for full-fidelity BibTeX / BibLaTeX parsing (`parseBibtex`):
 * `@string` macros and `#` concatenation, LaTeX → Unicode decoding, BibTeX
 * name rules, `crossref` / `xdata` inheritance, the BibLaTeX field set and
 * dates, the entry-type mapping, and the `extra` passthrough for fields
 * with no typed slot. The import policy (a title and an ISBN or DOI) is
 * unchanged, so every fixture carries a DOI.
 *
 * @module tests/unit/biblio-bibtex
 */

import * as Record from "effect/Record";
import { describe, expect, it } from "vite-plus/test";
import {
  MAX_AUTHORS,
  MAX_INPUT_LENGTH,
  MAX_TEXT_FIELD_LENGTH,
  parseBibtex,
  type ParseOutcome,
} from "@thomasfosterau/biblio";

/** Narrows a `ParseOutcome` to its parsed record, failing the test otherwise. */
function expectParsed(outcome: ParseOutcome) {
  if (outcome.outcome !== "parsed") {
    expect.fail(`expected a parsed outcome, got skipped (${outcome.reason})`);
  }
  return outcome.record;
}

/** Parses one `@<kind>{key, <fields>}` entry that carries a DOI, and returns its record. */
const parseEntry = (kind: string, fields: string) =>
  expectParsed(parseBibtex(`@${kind}{key, ${fields}, doi = {10.1000/x}}`)[0]);

describe("entry delimiters", () => {
  it("reads a parenthesised entry as it reads the braced one", () => {
    const fields = "title = {Title}, doi = {10.1000/xyz123}";
    const [braced] = parseBibtex(`@article{k, ${fields}}`, { mode: "lenient" });
    const [parens] = parseBibtex(`@article(k, ${fields})`, { mode: "lenient" });
    const record = expectParsed(parens);
    expect(record.type).toBe("article-journal");
    expect(record["citation-key"]).toBe("k");
    expect(record.title).toBe("Title");
    expect(record.identifiers.doi).toBe("10.1000/xyz123");
    expect(parens).toEqual(braced);
  });

  it("ends a parenthesised entry at the first `)` outside a brace group", () => {
    const outcomes = parseBibtex(
      "@article(a, title = {One (with parens)}, doi = {10.1000/a})\n@book{b, title = {Two}, isbn = {9780062316097}}",
    );
    expect(outcomes.map((outcome) => expectParsed(outcome).title)).toEqual([
      "One (with parens)",
      "Two",
    ]);
  });

  it("reads @string and @comment blocks in parentheses", () => {
    const [outcome, ...rest] = parseBibtex(
      '@comment(skipped) @string(j = "Journal") @article(k, title = {T}, journal = j, doi = {10.1000/x})',
    );
    expect(rest).toEqual([]);
    expect(expectParsed(outcome)["container-title"]).toBe("Journal");
  });

  it("treats an unclosed parenthesised entry like an unclosed braced one", () => {
    expect(parseBibtex("@article(k, title = {T}, doi = {10.1000/x}", { mode: "lenient" })).toEqual(
      parseBibtex("@article{k, title = {T}, doi = {10.1000/x}", { mode: "lenient" }),
    );
  });
});

describe("@string macros", () => {
  it("expands macros and `#` concatenation into later values", () => {
    const record = expectParsed(
      parseBibtex(`
        @string{pub = "Harper"}
        @STRING{ place = {New} # " " # "York" }
        @book{k, title = "Volume " # 2, publisher = pub # {Collins}, address = place, doi = {10.1000/x}}
      `)[0],
    );
    expect(record.title).toBe("Volume 2");
    expect(record.publisher).toBe("HarperCollins");
    expect(record["publisher-place"]).toBe("New York");
  });

  it("predefines the month macros and reads them into the date", () => {
    expect(parseEntry("article", "title = {T}, year = 2015, month = mar").issued).toEqual({
      "date-parts": [[2015, 3]],
    });
  });

  it("keeps an undefined macro's name rather than dropping the value", () => {
    expect(parseEntry("book", "title = {T}, publisher = undefinedpub").publisher).toBe(
      "undefinedpub",
    );
  });

  it("clamps self-doubling macros instead of growing exponentially", () => {
    const doubling = Array.from({ length: 40 }, (_, i) => `@string{m${i + 1} = m${i} # m${i}}`);
    const content = [
      `@string{m0 = "abcdefgh"}`,
      ...doubling,
      `@book{k, title = m40, doi = {10.1000/x}}`,
    ].join("\n");
    const record = expectParsed(parseBibtex(content)[0]);
    expect(record.title?.startsWith("abcdefgh")).toBe(true);
  });
});

describe("LaTeX decoding", () => {
  it("decodes accents, special letters and escaped specials", () => {
    const record = parseEntry(
      "book",
      String.raw`title = {{\"O}sterreich, \'{e}t\'e, {\aa}r, gar\c{c}on, \v{S}koda, na\"{\i}ve, \o rsted, Stra{\ss}e: 50\% \& more}`,
    );
    expect(record.title).toBe(
      "Österreich, été, år, garçon, Škoda, naïve, ørsted, Straße: 50% & more",
    );
  });

  it("decodes dashes, quotes and ties, and keeps the text of formatting commands", () => {
    const record = parseEntry(
      "book",
      "title = {\\emph{Homo} \\textbf{sapiens} in ``{DNA}'' studies, 1990--2000~---~a \\textsc{review}}",
    );
    expect(record.title).toBe("Homo sapiens in “DNA” studies, 1990–2000 — a review");
  });

  it("keeps a link's text and a URL's markup characters", () => {
    const record = parseEntry(
      "misc",
      String.raw`title = {See \href{https://example.org}{the site}}, howpublished = {\url{https://example.org/~a_b--c}}`,
    );
    expect(record.title).toBe("See the site");
    expect(record.URL).toBe("https://example.org/~a_b--c");
  });

  it("unescapes a verbatim url and DOI without decoding them as text", () => {
    const record = expectParsed(
      parseBibtex(
        String.raw`@online{k, title = {T}, url = {https://example.org/a\_b?x=1\&y=2}, doi = {10.1000/a\_b}}`,
      )[0],
    );
    expect(record.URL).toBe("https://example.org/a_b?x=1&y=2");
    expect(record.identifiers.doi).toBe("10.1000/a_b");
  });
});

describe("verbatim fields wrapped in a brace group", () => {
  it("keeps the identifier of a doubly braced DOI, ISSN and URL", () => {
    const record = expectParsed(
      parseBibtex(
        "@article{k, title = {T}, doi = {{10.1016/j.buildenv.2018.07.033}}, issn = {{0360-1323}}, url = {{https://example.org/a}}}",
      )[0],
    );
    expect(record.identifiers.doi).toBe("10.1016/j.buildenv.2018.07.033");
    expect(record.identifiers.issn).toBe("0360-1323");
    expect(record.URL).toBe("https://example.org/a");
  });

  it("removes every group that wraps the whole value, and only those", () => {
    const url = (value: string) =>
      expectParsed(parseBibtex(`@misc{k, title = {T}, doi = {10.1000/x}, url = ${value}}`)[0]).URL;
    expect(url("{{{https://example.org/deep}}}")).toBe("https://example.org/deep");
    expect(url("{ {https://example.org/spaced} }")).toBe("https://example.org/spaced");
    expect(url("{{a}{b}}")).toBe("{a}{b}");
    expect(url("{{a}x{b}}")).toBe("{a}x{b}");
    expect(url('"{https://example.org/quoted}"')).toBe("https://example.org/quoted");
  });

  it("removes as many wrapping groups as the scanner accepts", () => {
    // The scanner caps brace nesting at 32, so 30 groups inside the field's own braces is the deepest value.
    const deep = `${"{".repeat(30)}10.1000/deep${"}".repeat(30)}`;
    const record = expectParsed(parseBibtex(`@misc{k, title = {T}, doi = {${deep}}}`)[0]);
    expect(record.identifiers.doi).toBe("10.1000/deep");
  });
});

describe("names", () => {
  it("reads the three BibTeX name forms and particles", () => {
    const record = parseEntry(
      "book",
      String.raw`title = {T}, author = {Ludwig van Beethoven and von Neumann, Jr, John and de la Fontaine, Jean and {\'E}mile Zola}`,
    );
    expect(record.author).toEqual([
      { family: "Beethoven", given: "Ludwig", "dropping-particle": "van" },
      { family: "Neumann", given: "John", "dropping-particle": "von", suffix: "Jr" },
      { family: "Fontaine", given: "Jean", "dropping-particle": "de la" },
      { family: "Zola", given: "Émile" },
    ]);
  });

  it("reads BibLaTeX's extended name format", () => {
    const record = parseEntry(
      "book",
      "title = {T}, author = {family=Rabble, given=Richard, prefix=von, useprefix=true and given={Jean Paul}, family={de la Fontaine}, suffix=Jr and family=Smith, given=J., given-i=J, prefix=van and Doe, John}",
    );
    expect(record.author).toEqual([
      { family: "Rabble", given: "Richard", "non-dropping-particle": "von" },
      { family: "de la Fontaine", given: "Jean Paul", suffix: "Jr" },
      { family: "Smith", given: "J.", "dropping-particle": "van" },
      { family: "Doe", given: "John" },
    ]);
  });

  it("lets a name's own useprefix override the field's", () => {
    const record = parseEntry(
      "book",
      "title = {T}, options = {useprefix=true}, author = {family=Rabble, prefix=von, useprefix=false}",
    );
    expect(record.author).toEqual([{ family: "Rabble", "dropping-particle": "von" }]);
  });

  it("reads a braced particle that ends in a hyphen or apostrophe as non-dropping", () => {
    const record = parseEntry(
      "book",
      "title = {T}, author = {Abdul {al-}Hasan and {d'}Alembert, Jean and {Smith}son, Ann}",
    );
    expect(record.author).toEqual([
      { family: "Hasan", given: "Abdul", "non-dropping-particle": "al-" },
      { family: "Alembert", given: "Jean", "non-dropping-particle": "d'" },
      { family: "Smithson", given: "Ann" },
    ]);
  });

  it("makes the particle non-dropping under useprefix", () => {
    const record = parseEntry(
      "book",
      "title = {T}, author = {van Gogh, Vincent}, options = {useprefix=true}",
    );
    expect(record.author).toEqual([
      { family: "Gogh", given: "Vincent", "non-dropping-particle": "van" },
    ]);
  });

  it("reads a braced corporate name as a literal, its `and` protected", () => {
    const record = parseEntry(
      "report",
      "title = {T}, author = {{Barnes and Noble} and {World Health Organization}}",
    );
    expect(record.author).toEqual([
      { literal: "Barnes and Noble" },
      { literal: "World Health Organization" },
    ]);
  });

  it("records `and others` as an et al. marker, not a name", () => {
    const record = parseEntry(
      "book",
      "title = {T}, author = {Doe, Jane and others}, editor = {Roe, Rick}",
    );
    expect(record.author).toEqual([{ family: "Doe", given: "Jane" }]);
    expect(record.editor).toEqual([{ family: "Roe", given: "Rick" }]);
    expect(record.extra).toEqual({ "tex.others": ["author"] });
  });

  it("maps translators and book authors", () => {
    const record = parseEntry(
      "inbook",
      "title = {T}, booktitle = {B}, translator = {Smith, Ann}, bookauthor = {Jones, Bob}",
    );
    expect(record.translator).toEqual([{ family: "Smith", given: "Ann" }]);
    expect(record["container-author"]).toEqual([{ family: "Jones", given: "Bob" }]);
  });
});

describe("BibLaTeX field semantics, as Pandoc reads them", () => {
  it("splits list fields at each top-level `and` and joins them with `; `", () => {
    const record = parseEntry(
      "book",
      "title = {T}, publisher = {Routledge and {Clapp and Clopp} Press}, location = {Westport, Conn. and London}",
    );
    expect(record.publisher).toBe("Routledge; Clapp and Clopp Press");
    expect(record["publisher-place"]).toBe("Westport, Conn.; London");
  });

  it("bounds a huge list field: clamped once, items capped, linear in its length", () => {
    const started = performance.now();
    const huge = parseEntry(
      "book",
      `title = {T}, publisher = {${"x".repeat(4_000_000)} and Y}, location = {${"A and ".repeat(500_000)}B}`,
    );
    expect(huge.publisher?.length).toBeLessThanOrEqual(MAX_TEXT_FIELD_LENGTH);
    expect(huge["publisher-place"]?.split("; ").length).toBeLessThanOrEqual(MAX_AUTHORS);
    // Long blank runs, before and around an `and`, cannot make the splitter backtrack.
    const spaced = parseEntry(
      "book",
      `title = {T}, location = {a${" ".repeat(30_000)}b${" \t".repeat(10_000)}and${" ".repeat(10_000)}c}`,
    );
    expect(spaced["publisher-place"]).toBe("a b; c");
    expect(
      parseEntry("book", `title = {T}, location = {a${" ".repeat(3_000_000)}b}`)["publisher-place"],
    ).toBe("a");
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  it("joins every publisher-like field present, school first", () => {
    const record = parseEntry(
      "thesis",
      "title = {T}, school = {University of West Grantham}, institution = {University of East Grantham}",
    );
    expect(record.publisher).toBe("University of West Grantham; University of East Grantham");
  });

  it("makes a multi-volume book's maintitle its title and its own title the volume title", () => {
    const record = parseEntry(
      "book",
      "maintitle = {The Collected Works}, mainsubtitle = {Volume Seven}, title = {Biographia Literaria}, volume = {7}, part = {2}",
    );
    expect(record.title).toBe("The Collected Works: Volume Seven");
    expect(record["volume-title"]).toBe("Biographia Literaria");
    expect(record.volume).toBe("7.2");
    expect(record["collection-title"]).toBeUndefined();
  });

  it("makes a contained entry's maintitle its container and its booktitle the volume title", () => {
    const record = parseEntry(
      "inbook",
      "title = {Kritik der Urtheilskraft}, maintitle = {Kants Werke}, booktitle = {Band 5}, series = {Akademie}",
    );
    expect(record.title).toBe("Kritik der Urtheilskraft");
    expect(record["container-title"]).toBe("Kants Werke");
    expect(record["volume-title"]).toBe("Band 5");
    expect(record["collection-title"]).toBe("Akademie");
  });

  it("keeps the booktitle as the container of a contained entry without a maintitle", () => {
    const record = parseEntry("incollection", "title = {Chapter}, booktitle = {The Book}");
    expect(record["container-title"]).toBe("The Book");
    expect(record["volume-title"]).toBeUndefined();
  });

  it("spells out BibLaTeX's localisation keys", () => {
    const record = parseEntry(
      "patent",
      "title = {T}, type = {patentus}, pubstate = {inpress}, series = {newseries}",
    );
    expect(record.genre).toBe("U.S. patent");
    expect(record.status).toBe("in press");
    expect(record["collection-title"]).toBe("new series");
    expect(parseEntry("article", "title = {T}, series = {3}")["collection-title"]).toBe(
      "3rd series",
    );
    expect(parseEntry("article", "title = {T}, series = {12}")["collection-title"]).toBe(
      "12th series",
    );
    expect(parseEntry("article", "title = {T}, series = {22}")["collection-title"]).toBe(
      "22nd series",
    );
  });

  it("reads the language from hyphenation, with a langidopts variant", () => {
    expect(parseEntry("book", "title = {T}, hyphenation = {german}").language).toBe("de-DE");
    expect(
      parseEntry("book", "title = {T}, langid = {english}, langidopts = {variant=british}")
        .language,
    ).toBe("en-GB");
    expect(
      parseEntry("book", "title = {T}, langid = {en}, langidopts = {variant=american}").language,
    ).toBe("en");
  });

  it("keeps a volume without a part, and a pubstate that is not a key, as written", () => {
    const record = parseEntry(
      "book",
      "title = {T}, volume = {7}, part = {}, pubstate = {under review}",
    );
    expect(record.volume).toBe("7");
    expect(record.status).toBe("under review");
  });

  it("quotes \\mkbibquote and italicises \\mkbibemph under CSL markup", () => {
    const [outcome] = parseBibtex(
      "@article{k, title = {Blah \\mkbibemph{this} and \\mkbibquote{that}}, doi = {10.1000/x}}",
      { bibtexMarkup: true },
    );
    expect(expectParsed(outcome).title).toBe("Blah <i>this</i> and “that”");
  });

  it("decodes \\hyphen and \\mkbibquote", () => {
    const record = parseEntry(
      "article",
      "title = {Methodology\\hyphen{}independent \\mkbibquote{energies}}",
    );
    expect(record.title).toBe("Methodology-independent “energies”");
  });
});

describe("crossref and xdata", () => {
  it("inherits a parent book's title as an inbook's container, with its publisher and author", () => {
    const outcomes = parseBibtex(`
      @inbook{ch, crossref = {bk}, title = {Chapter}, pages = {1--10}, doi = {10.1000/ch}}
      @book{bk, title = {The Book}, subtitle = {A Study}, author = {Doe, Jane}, publisher = {Pub}, year = 2001, doi = {10.1000/bk}}
    `);
    expect(outcomes).toHaveLength(2);
    const chapter = expectParsed(outcomes[0]);
    expect(chapter).toMatchObject({
      type: "chapter",
      title: "Chapter",
      "container-title": "The Book: A Study",
      publisher: "Pub",
      author: [{ family: "Doe", given: "Jane" }],
      "container-author": [{ family: "Doe", given: "Jane" }],
      issued: { "date-parts": [[2001]] },
      page: "1-10",
    });
    expect(chapter.extra).toBeUndefined();
    expect(expectParsed(outcomes[1]).title).toBe("The Book: A Study");
  });

  it("maps a proceedings title to booktitle and a periodical title to the journal", () => {
    const outcomes = parseBibtex(`
      @inproceedings{p, crossref = {conf}, title = {Paper}, doi = {10.1000/p}}
      @proceedings{conf, title = {Proc. of Things}, year = 1999}
      @article{a, crossref = {per}, title = {Article}, doi = {10.1000/a}}
      @periodical{per, title = {Journal of Things}, issn = {0378-5955}}
    `);
    expect(expectParsed(outcomes[0])["container-title"]).toBe("Proc. of Things");
    expect(expectParsed(outcomes[2])["container-title"]).toBe("Journal of Things");
    expect(expectParsed(outcomes[2]).identifiers.issn).toBe("0378-5955");
  });

  it("does not let a child's own field be overwritten, and keeps xref as a plain field", () => {
    const record = expectParsed(
      parseBibtex(`
        @incollection{c, crossref = {col}, xref = {col}, title = {C}, publisher = {Own}, doi = {10.1000/c}}
        @collection{col, title = {Col}, publisher = {Parent}}
      `)[0],
    );
    expect(record.publisher).toBe("Own");
    expect(record.extra).toEqual({ "tex.xref": "col" });
  });

  it("fills fields from xdata entries, which yield no outcome of their own", () => {
    const outcomes = parseBibtex(`
      @xdata{pubdata, publisher = {Shared Press}, location = {Paris}}
      @book{b, title = {B}, xdata = {pubdata}, doi = {10.1000/b}}
    `);
    expect(outcomes).toHaveLength(1);
    expect(expectParsed(outcomes[0])).toMatchObject({
      publisher: "Shared Press",
      "publisher-place": "Paris",
    });
  });

  it("follows a chain of parents and stops on a cycle without throwing", () => {
    const outcomes = parseBibtex(`
      @inbook{a, crossref = {b}, title = {A}, doi = {10.1000/a}}
      @book{b, crossref = {c}, title = {B}}
      @book{c, crossref = {b}, publisher = {C Press}}
    `);
    expect(expectParsed(outcomes[0])).toMatchObject({
      "container-title": "B",
      publisher: "C Press",
    });
  });
});

describe("BibLaTeX fields", () => {
  it("maps the BibLaTeX field set onto the record and its CSL variables", () => {
    const record = parseEntry(
      "article",
      [
        "title = {T}",
        "shorttitle = {Short}",
        "journaltitle = {Journal}",
        "shortjournal = {J.}",
        "volume = {12}",
        "number = {3}",
        "pages = {101--110}",
        "date = {2020-05-17}",
        "urldate = {2021-01-02}",
        "url = {https://example.org}",
        "langid = {british}",
        "abstract = {An abstract.}",
        "keywords = {one, two}",
        "note = {A note}",
        "addendum = {An addendum}",
        "file = {:/home/me/paper.pdf:PDF}",
        "custom = {Kept {Value}}",
      ].join(", "),
    );
    expect(record).toMatchObject({
      type: "article-journal",
      title: "T",
      "container-title": "Journal",
      volume: "12",
      issue: "3",
      page: "101-110",
      issued: { "date-parts": [[2020, 5, 17]] },
      accessed: { "date-parts": [[2021, 1, 2]] },
      URL: "https://example.org",
      language: "en-GB",
      abstract: "An abstract.",
      note: "A note. An addendum",
      "title-short": "Short",
      "container-title-short": "J.",
      keyword: "one, two",
    });
    expect(record.extra).toEqual({ "tex.custom": "Kept Value" });
  });

  it("maps a book's series, edition, location and volumes", () => {
    const record = parseEntry(
      "book",
      "title = {T}, series = {Lecture Notes}, number = {42}, edition = {2}, location = {Berlin}, volumes = {3}, pagetotal = {300}",
    );
    expect(record).toMatchObject({
      "collection-title": "Lecture Notes",
      edition: "2",
      "publisher-place": "Berlin",
      "collection-number": "42",
      "number-of-volumes": "3",
      "number-of-pages": "300",
    });
    expect(record.number).toBeUndefined();
    expect(record.extra).toBeUndefined();
  });

  it("maps theses, reports and institutions", () => {
    const thesis = parseEntry("phdthesis", "title = {T}, school = {MIT}");
    expect(thesis).toMatchObject({ type: "thesis", publisher: "MIT" });
    expect(thesis.genre).toBe("PhD thesis");
    const report = parseEntry(
      "report",
      "title = {T}, type = {techreport}, institution = {Lab}, number = {TR-7}",
    );
    expect(report).toMatchObject({ type: "report", publisher: "Lab", number: "TR-7" });
    expect(report.genre).toBe("Technical report");
  });

  it("maps an arXiv eprint to a number and a URL", () => {
    const record = parseEntry(
      "online",
      "title = {T}, eprint = {2101.00001}, eprinttype = {arXiv}, eprintclass = {cs.CL}",
    );
    expect(record).toMatchObject({
      type: "webpage",
      number: "arXiv:2101.00001",
      URL: "https://arxiv.org/abs/2101.00001",
      identifiers: { arxiv: "2101.00001" },
    });
    expect(record.extra).toEqual({ "tex.eprintclass": "cs.CL" });
  });

  it("keeps an eprint that is not a valid arXiv or PubMed id in extra", () => {
    const record = parseEntry("online", "title = {T}, eprint = {not an id}, eprinttype = {arXiv}");
    expect(record.identifiers.arxiv).toBeUndefined();
    expect(record.number).toBeUndefined();
    expect(record.extra).toEqual({ "tex.eprint": "not an id", "tex.eprinttype": "arXiv" });
  });

  it("maps pmid and pmcid fields to identifiers, keeping an invalid one in extra", () => {
    expect(
      parseEntry("article", "title = {T}, pmid = {15371539}, pmcid = {pmc3159421}").identifiers,
    ).toEqual({
      doi: "10.1000/x",
      pmid: "15371539",
      pmcid: "PMC3159421",
    });
    expect(parseEntry("article", "title = {T}, pmid = {n/a}").extra).toEqual({ "tex.pmid": "n/a" });
  });

  it("maps event fields and a PubMed eprint", () => {
    const record = parseEntry(
      "inproceedings",
      "title = {T}, booktitle = {Proc}, eventtitle = {Conf 2020}, venue = {Online}, eventdate = {2020-06-01/2020-06-03}, eprint = {123456}, eprinttype = {pubmed}",
    );
    expect(record["event-date"]).toEqual({
      "date-parts": [
        [2020, 6, 1],
        [2020, 6, 3],
      ],
    });
    expect(record).toMatchObject({
      "event-title": "Conf 2020",
      "event-place": "Online",
      identifiers: { pmid: "123456" },
    });
    expect(record.extra).toBeUndefined();
  });
});

describe("dates", () => {
  it("reads era years with astronomical numbering, as CSL counts BC years", () => {
    const issued = (date: string) => parseEntry("book", `title = {T}, date = {${date}}`).issued;
    // EDTF -0379 is 380 BC, which CSL writes as -380; 0000 is 1 BC.
    expect(issued("-0379-02")).toEqual({ "date-parts": [[-380, 2]] });
    expect(issued("-0221/-0219")).toEqual({ "date-parts": [[-222], [-220]] });
    expect(issued("0000")).toEqual({ "date-parts": [[-1]] });
    expect(issued("0250-03-02")).toEqual({ "date-parts": [[250, 3, 2]] });
    expect(issued("-19XX")).toEqual({ literal: "-19XX" });
  });

  it("drops a time of day and keeps the date", () => {
    const issued = (date: string) => parseEntry("book", `title = {T}, date = {${date}}`).issued;
    expect(issued("2001-01-03T15:00:00")).toEqual({ "date-parts": [[2001, 1, 3]] });
    expect(issued("2001-01-03T17:07:34+05:00")).toEqual({ "date-parts": [[2001, 1, 3]] });
    expect(issued("2016-01-19T14:20:00.000Z")).toEqual({ "date-parts": [[2016, 1, 19]] });
    expect(issued("1999-01T10:00")).toEqual({ literal: "1999-01T10:00" });
  });

  it("reads an open start as a range whose start is empty", () => {
    const issued = (date: string) => parseEntry("book", `title = {T}, date = {${date}}`).issued;
    expect(issued("../2000")).toEqual({ "date-parts": [[0], [2000]], raw: "../2000" });
    expect(issued("/1034")).toEqual({ "date-parts": [[0], [1034]], raw: "/1034" });
    expect(issued("/2004-01-01~")).toEqual({
      "date-parts": [[0], [2004, 1, 1]],
      raw: "/2004-01-01~",
      circa: true,
    });
  });

  it("reads unspecified digits as an approximate date", () => {
    const issued = (date: string) => parseEntry("book", `title = {T}, date = {${date}}`).issued;
    expect(issued("199X")).toEqual({ "date-parts": [[1990]], circa: true });
    expect(issued("19XX")).toEqual({ "date-parts": [[1900]], circa: true });
    expect(issued("1999-XX")).toEqual({ "date-parts": [[1999]], circa: true });
    expect(issued("1999-01-XX")).toEqual({ "date-parts": [[1999, 1]], circa: true });
    expect(issued("1999-XX-XX")).toEqual({ "date-parts": [[1999]], circa: true });
  });

  it("keeps EDTF level 2 quarters as a literal", () => {
    expect(parseEntry("book", "title = {T}, date = {2002-33}").issued).toEqual({
      literal: "2002-33",
    });
  });

  it("reads EDTF ranges, open ranges, seasons and approximate dates", () => {
    expect(parseEntry("book", "title = {T}, date = {2001/2004}").issued).toEqual({
      "date-parts": [[2001], [2004]],
    });
    expect(parseEntry("book", "title = {T}, date = {2001/..}").issued).toEqual({
      "date-parts": [[2001]],
      raw: "2001/..",
    });
    expect(parseEntry("book", "title = {T}, date = {2015-22}").issued).toEqual({
      "date-parts": [[2015]],
      season: 2,
    });
    expect(parseEntry("book", "title = {T}, date = {1850~}").issued).toEqual({
      "date-parts": [[1850]],
      circa: true,
    });
  });

  it("refines a year with a month and day, and keeps a non-date year as a literal", () => {
    expect(
      parseEntry("book", "title = {T}, year = {2015}, month = {12}, day = {25}").issued,
    ).toEqual({
      "date-parts": [[2015, 12, 25]],
    });
    const forthcoming = parseEntry("book", "title = {T}, year = {forthcoming}, month = {Smarch}");
    expect(forthcoming.issued).toEqual({ literal: "forthcoming" });
    expect(forthcoming.extra).toEqual({ "tex.month": "Smarch" });
    expect(parseEntry("book", "title = {T}, date = {2015-13-01}").issued).toEqual({
      literal: "2015-13-01",
    });
  });
});

describe("entry types", () => {
  it("maps BibTeX and BibLaTeX types to CSL item types", () => {
    const typeOf = (kind: string, extra = "") => parseEntry(kind, `title = {T}${extra}`).type;
    expect(typeOf("booklet")).toBe("pamphlet");
    expect(typeOf("inreference")).toBe("entry-encyclopedia");
    expect(typeOf("unpublished")).toBe("manuscript");
    expect(typeOf("online")).toBe("webpage");
    expect(typeOf("software")).toBe("software");
    expect(typeOf("article", ", entrysubtype = {magazine}")).toBe("article-magazine");
    expect(typeOf("constructor")).toBe("document");
  });
});

describe("hostile input", () => {
  it("keeps at most 256 distinct fields per entry, however many it lists", () => {
    const fields = Array.from({ length: 600_000 }, (_, i) => `f${i}=v`).join(",");
    const record = expectParsed(
      parseBibtex(`@misc{k, title = {T}, doi = {10.1000/x}, ${fields}}`)[0],
    );
    expect(Record.keys(record.extra ?? {})).toHaveLength(254);
  });

  it("bounds macro expansion across a document, however many fields name a large macro", () => {
    const big = "a".repeat(60_000);
    const fields = Array.from({ length: 250 }, (_, i) => `f${i}=m`).join(",");
    const content = `@string{m = {${big}}}\n@misc{k, title = {T}, ${fields}, doi = {10.1000/x}}`;
    expect(content.length).toBeLessThanOrEqual(MAX_INPUT_LENGTH);
    const record = expectParsed(parseBibtex(content)[0]);
    // Only the first fields within the expansion budget expand.
    const expanded = Record.keys(record.extra ?? {}).length;
    expect(expanded).toBeGreaterThan(0);
    expect(expanded).toBeLessThan(200);
  });

  it("bounds decoding across a document, however many children inherit a large parent", () => {
    const parentFields = Array.from(
      { length: 100 },
      (_, i) => `g${i} = {${"b".repeat(60_000)}}`,
    ).join(",");
    const children = Array.from(
      { length: 4999 },
      (_, i) => `@inbook{c${i}, crossref = {p}, title = {T}, doi = {10.1000/x}}`,
    ).join("\n");
    const content = `@book{p, author = {Doe, Jane}, ${parentFields}}\n${children}`;
    expect(content.length).toBeLessThanOrEqual(MAX_INPUT_LENGTH);
    const outcomes = parseBibtex(content);
    expect(outcomes).toHaveLength(5000);
    // The first children decode the inherited fields; the budget stops the rest.
    expect(Record.keys(expectParsed(outcomes[1]).extra ?? {})).toHaveLength(100);
    expect(expectParsed(outcomes[1]).author).toEqual([{ family: "Doe", given: "Jane" }]);
    expect(expectParsed(outcomes[4999]).extra).toBeUndefined();
    expect(expectParsed(outcomes[4999]).author).toBeUndefined();
  });

  it("decodes a long value at the source cap without throwing", () => {
    const long = String.raw`\"o`.repeat(Math.floor(MAX_INPUT_LENGTH / 8));
    expect(() => parseBibtex(`@book{k, title = {${long}}, doi = {10.1000/x}}`)).not.toThrow();
  });
});

describe("edge cases", () => {
  it("decodes the less common LaTeX forms", () => {
    const record = parseEntry(
      "book",
      String.raw`title = {Ma\'\i z \enquote{quoted} \url{a~b} \url plain \t{oo} \"{} x\'\relax y end\'}`,
    );
    expect(record.title).toBe("Maíz “quoted” a~b plain o͡o xy end");
  });

  it("joins a title addon and keeps an unrecognised genre and language", () => {
    const record = parseEntry(
      "thesis",
      "title = {T}, subtitle = {S}, titleaddon = {Addon}, type = {Habilitation}, language = {Klingon}, note = {Only a note.}",
    );
    expect(record.title).toBe("T: S. Addon");
    expect(record.note).toBe("Only a note.");
    expect(record.language).toBeUndefined();
    expect(record.genre).toBe("Habilitation");
    expect(record.extra).toEqual({ "tex.language": "Klingon" });
    expect(parseEntry("book", "title = {T}, langid = {en-AU}").language).toBe("en-AU");
    expect(parseEntry("book", "title = {T}, addendum = {Only an addendum}").note).toBe(
      "Only an addendum",
    );
  });

  it("keeps a non-link howpublished as the publisher, and a bare URL as the URL", () => {
    expect(parseEntry("misc", "title = {T}, howpublished = {Privately printed}").publisher).toBe(
      "Privately printed",
    );
    expect(parseEntry("misc", "title = {T}, howpublished = {https://example.org/x}").URL).toBe(
      "https://example.org/x",
    );
  });

  it("skips empty names and treats a word with no letters as part of the given name", () => {
    expect(parseEntry("book", "title = {T}, author = {{} and Ann 3 Lee}").author).toEqual([
      { family: "Lee", given: "Ann 3" },
    ]);
  });

  it("ignores an unknown xdata key and keeps the first of two entries with one key", () => {
    const outcomes = parseBibtex(`
      @book{dup, title = {First}, xdata = {missing}, doi = {10.1000/a}}
      @book{dup, title = {Second}, doi = {10.1000/b}}
      @inbook{child, crossref = {DUP}, title = {C}, doi = {10.1000/c}}
    `);
    expect(outcomes).toHaveLength(3);
    expect(expectParsed(outcomes[2])["container-title"]).toBe("First");
  });

  it("does not let xdata pass on its own inheritance links", () => {
    const outcomes = parseBibtex(`
      @xdata{x, ids = {alias}, publisher = {P}}
      @book{b, title = {B}, xdata = {x}, doi = {10.1000/b}}
    `);
    expect(expectParsed(outcomes[0]).extra).toBeUndefined();
  });

  it("reads month-precision dates and rejects out-of-range parts", () => {
    const issued = (fields: string) => parseEntry("book", `title = {T}, ${fields}`).issued;
    expect(issued("date = {2015-03}")).toEqual({ "date-parts": [[2015, 3]] });
    expect(issued("date = {2015-03-32}")).toEqual({ literal: "2015-03-32" });
    expect(issued("date = {3000}")).toEqual({ literal: "3000" });
    expect(issued("date = {2001/2002/2003}")).toEqual({ literal: "2001/2002/2003" });
    expect(issued("date = {2001/2002-13}")).toEqual({ literal: "2001/2002-13" });
    expect(issued("date = {  }, year = {2010}")).toEqual({ "date-parts": [[2010]] });
    expect(issued("year = {2010}, month = {13}")).toEqual({ "date-parts": [[2010]] });
    expect(issued("year = {2010}, month = {5}, day = {40}")).toEqual({ "date-parts": [[2010, 5]] });
    expect(issued("year = {2001/2004}, month = {5}")).toEqual({ "date-parts": [[2001], [2004]] });
  });

  it("keeps a subtitle with no title in extra rather than dropping it", () => {
    const record = parseEntry("article", "title = {T}, journalsubtitle = {Orphan}");
    expect(record["container-title"]).toBeUndefined();
    expect(record.extra).toEqual({ "tex.journalsubtitle": "Orphan" });
  });

  it("reads an entry with no fields as having none", () => {
    expect(parseBibtex(`@book{onlykey}`)).toEqual([
      { outcome: "skipped", reason: "no-title", position: { offset: 0, line: 1, column: 1 } },
    ]);
    expect(parseBibtex(`@book{onlykey}`, { mode: "lenient" })).toEqual([
      {
        outcome: "parsed",
        record: {
          type: "book",
          id: "onlykey",
          "citation-key": "onlykey",
          identifiers: {},
          provenance: { source: "bibtex" },
        },
        position: { offset: 0, line: 1, column: 1 },
      },
    ]);
  });
});

describe("citation keys, positions and lenient mode", () => {
  it("keys every record by its entry key and positions every outcome at its @", () => {
    const content = [
      "% a comment",
      "@book{harari2015, title = {Sapiens}, isbn = {9780062316097}}",
      "",
      "  @misc{web, title = {A page}, url = {https://example.org}}",
    ].join("\r\n");
    const [book, page] = parseBibtex(content);
    expect(expectParsed(book)).toMatchObject({ id: "harari2015", "citation-key": "harari2015" });
    expect(book.position).toEqual({ offset: 13, line: 2, column: 1 });
    expect(page).toMatchObject({
      outcome: "skipped",
      reason: "no-identifier",
      position: { offset: content.indexOf("@misc"), line: 4, column: 3 },
    });
  });

  it("keeps entries without a title or identifier in lenient mode", () => {
    const outcomes = parseBibtex(
      "@misc{web, title = {A page}, url = {https://example.org}}\n@article{untitled, author = {Doe, Jane}, year = 2020}",
      { mode: "lenient" },
    );
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["parsed", "parsed"]);
    expect(expectParsed(outcomes[0])).toMatchObject({
      type: "document",
      URL: "https://example.org",
    });
    expect(expectParsed(outcomes[1])).toMatchObject({
      type: "article-journal",
      "citation-key": "untitled",
      author: [{ family: "Doe", given: "Jane" }],
      issued: { "date-parts": [[2020]] },
    });
    expect(expectParsed(outcomes[1]).title).toBeUndefined();
  });

  it("reports the entries past the record cap as one truncated outcome", () => {
    const content = Array.from({ length: 4 }, (_, i) => `@misc{k${i}, title = {T${i}}}`).join("\n");
    const outcomes = parseBibtex(content, { mode: "lenient", maxRecords: 2 });
    expect(outcomes).toHaveLength(3);
    expect(outcomes[2]).toEqual({ outcome: "skipped", reason: "truncated" });
    expect(parseBibtex(content, { mode: "lenient", maxRecords: 4 })).toHaveLength(4);
  });

  it("raises the field-length and author limits on request", () => {
    const abstract = "word ".repeat(1000).trim();
    const authors = Array.from({ length: 150 }, (_, i) => `Author${i}, A.`).join(" and ");
    const entry = `@article{big, title = {T}, abstract = {${abstract}}, author = {${authors}}}`;
    const clamped = expectParsed(parseBibtex(entry, { mode: "lenient" })[0]);
    expect(clamped.abstract).toHaveLength(2000);
    expect(clamped.author).toHaveLength(100);
    const raised = expectParsed(
      parseBibtex(entry, { mode: "lenient", maxFieldLength: 10_000, maxAuthors: 500 })[0],
    );
    expect(raised.abstract).toBe(abstract);
    expect(raised.author).toHaveLength(150);
  });

  it("reads input over a raised input cap, and reports input over the cap as too-large", () => {
    const entry = "@misc{k, title = {T}}";
    expect(parseBibtex(entry, { maxInputLength: 5 })).toEqual([
      { outcome: "skipped", reason: "too-large" },
    ]);
    expect(
      parseBibtex(entry.padEnd(MAX_INPUT_LENGTH + 10, " "), {
        mode: "lenient",
        maxInputLength: MAX_INPUT_LENGTH + 10,
      }),
    ).toHaveLength(1);
  });
});
