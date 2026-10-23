/**
 * Unit tests for `readEmbeddedMetadata` (`src/embedded.ts`): Highwire
 * Press, Dublin Core, schema.org JSON-LD and COinS metadata on a page read
 * into records, the precedence between them, and the bounds on untrusted
 * pages.
 *
 * @module tests/unit/biblio-embedded
 */

import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { readEmbeddedMetadata } from "@thomasfosterau/biblio";
import { expectSome } from "./assert.ts";

/** A JSON value as JSON text. */
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json));

/** A page with `head` in its head and `body` in its body. */
const page = (head: string, body = ""): string =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("Highwire Press tags", () => {
  it("read a journal article, authors in either order and every identifier", () => {
    const { page: record } = readEmbeddedMetadata(
      page(`
        <META NAME="citation_title" CONTENT="Ion &amp; Water: A &#x201C;Study&#8221;">
        <meta name="citation_author" content="Kuhn, Thomas">
        <meta name='citation_author' content='Ada Lovelace'>
        <meta name=citation_author content=Plato>
        <meta name="citation_publication_date" content="2004/03/14">
        <meta name="citation_journal_title" content="Journal of Science">
        <meta name="citation_journal_abbrev" content="J. Sci.">
        <meta name="citation_volume" content="59">
        <meta name="citation_issue" content="1">
        <meta name="citation_firstpage" content="29">
        <meta name="citation_lastpage" content="40">
        <meta name="citation_doi" content="10.1037/0003-066X.59.1.29">
        <meta name="citation_issn" content="0028-0836">
        <meta name="citation_pmid" content="15371539">
        <meta name="citation_arxiv_id" content="2101.01234">
        <meta name="citation_language" content="en">
        <meta name="citation_keywords" content="ions">
        <meta name="citation_keywords" content="water">
        <meta name="citation_abstract_html_url" content="https://example.org/abs">
      `),
    );
    const article = expectSome(record);
    expect(article).toMatchObject({
      type: "article-journal",
      title: "Ion & Water: A “Study”",
      author: [
        { family: "Kuhn", given: "Thomas" },
        { family: "Lovelace", given: "Ada" },
        { literal: "Plato" },
      ],
      issued: { "date-parts": [[2004, 3, 14]] },
      "container-title": "Journal of Science",
      "container-title-short": "J. Sci.",
      volume: "59",
      issue: "1",
      page: "29-40",
      language: "en",
      keyword: "ions, water",
      URL: "https://example.org/abs",
      number: "arXiv:2101.01234",
      identifiers: {
        doi: "10.1037/0003-066x.59.1.29",
        issn: "0028-0836",
        pmid: "15371539",
        arxiv: "2101.01234",
      },
      provenance: { source: "html" },
    });
  });

  it.each([
    [`<meta name="citation_conference_title" content="Conf">`, "paper-conference"],
    [`<meta name="citation_dissertation_institution" content="MIT">`, "thesis"],
    [`<meta name="citation_technical_report_number" content="TR-1">`, "report"],
    [`<meta name="citation_inbook_title" content="Book">`, "chapter"],
    [`<meta name="citation_isbn" content="9780062316097">`, "book"],
    [``, "article-journal"],
  ])("type a page with %j as %s", (extra, type) => {
    const { page: record } = readEmbeddedMetadata(
      page(`<meta name="citation_title" content="T">${extra}`),
    );
    expect(expectSome(record).type).toBe(type);
  });
});

describe("schema.org JSON-LD", () => {
  it("reads a ScholarlyArticle in a @graph, with ORCIDs and the periodical it is part of", () => {
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Publisher site" },
        {
          "@type": ["ScholarlyArticle"],
          headline: "Deep Learning",
          author: [
            {
              "@type": "Person",
              givenName: "Yann",
              familyName: "LeCun",
              "@id": "https://orcid.org/0000-0002-1825-0097",
            },
            { "@type": "Person", name: "Geoffrey Hinton" },
            { "@type": "Organization", name: "Google" },
            "Yoshua Bengio",
          ],
          datePublished: "2015-05-27",
          pageStart: 436,
          pageEnd: 444,
          identifier: {
            "@type": "PropertyValue",
            propertyID: "DOI",
            value: "https://doi.org/10.1038/nature14539",
          },
          isPartOf: {
            "@type": "PublicationIssue",
            issueNumber: 7553,
            isPartOf: {
              "@type": "PublicationVolume",
              volumeNumber: "521",
              isPartOf: { "@type": "Periodical", name: "Nature", issn: "0028-0836" },
            },
          },
          publisher: { "@type": "Organization", name: "Springer Nature" },
          keywords: ["AI", "ML"],
        },
      ],
    };
    const { page: record } = readEmbeddedMetadata(
      page(`<script type="application/ld+json">${encodeJson(ld)}</script>`),
    );
    expect(expectSome(record)).toMatchObject({
      type: "article-journal",
      title: "Deep Learning",
      author: [
        { family: "LeCun", given: "Yann", orcid: "0000-0002-1825-0097" },
        { family: "Hinton", given: "Geoffrey" },
        { literal: "Google" },
        { family: "Bengio", given: "Yoshua" },
      ],
      issued: { "date-parts": [[2015, 5, 27]] },
      page: "436-444",
      "container-title": "Nature",
      volume: "521",
      issue: "7553",
      publisher: "Springer Nature",
      keyword: "AI, ML",
      identifiers: { doi: "10.1038/nature14539", issn: "0028-0836" },
    });
  });

  it.each([
    ["NewsArticle", "article-newspaper"],
    ["BlogPosting", "post-weblog"],
    ["Book", "book"],
    ["Dataset", "dataset"],
    ["WebPage", "webpage"],
  ])("types a %s as %s", (schemaType, type) => {
    const { page: record } = readEmbeddedMetadata(
      page(`<script type="application/ld+json">[{"@type": "${schemaType}", "name": "N"}]</script>`),
    );
    expect(expectSome(record).type).toBe(type);
  });

  it("skips scripts that are not JSON-LD, invalid JSON and nodes of other kinds", () => {
    const { page: record } = readEmbeddedMetadata(
      page(
        `<script>var x = {"@type": "Book", "name": "Not data"}</script>` +
          `<script type="application/ld+json">{not json</script>` +
          `<script type="application/ld+json">{"@type": "Person", "name": "Someone"}</script>`,
      ),
    );
    expect(record).toEqual(Option.none());
  });
});

describe("Dublin Core tags", () => {
  it("read a page with nothing richer, an identifier as its DOI or ISBN", () => {
    const { page: record } = readEmbeddedMetadata(
      page(`
        <meta name="DC.title" content="A Report">
        <meta name="DC.creator" content="Doe, Jane">
        <meta name="DCTERMS.issued" content="2019-07">
        <meta name="DC.publisher" content="Agency">
        <meta name="DC.identifier" content="doi:10.1000/xyz123">
        <meta name="DC.identifier" content="ISBN 9780062316097">
        <meta name="DC.description" content="About it.">
      `),
    );
    expect(expectSome(record)).toMatchObject({
      type: "document",
      title: "A Report",
      author: [{ family: "Doe", given: "Jane" }],
      issued: { "date-parts": [[2019, 7]] },
      publisher: "Agency",
      abstract: "About it.",
      identifiers: { doi: "10.1000/xyz123", isbn: "9780062316097" },
    });
  });
});

describe("precedence", () => {
  it("prefers Highwire, fills its gaps from JSON-LD and Dublin Core, and falls back to the page URL", () => {
    const { page: record } = readEmbeddedMetadata(
      page(
        `<meta name="citation_title" content="Highwire Title">` +
          `<meta name="DC.title" content="DC Title"><meta name="DC.publisher" content="DC Publisher">` +
          `<script type="application/ld+json">{"@type": "ScholarlyArticle", "name": "LD Title", "datePublished": "2001"}</script>`,
      ),
      { url: "https://example.org/page" },
    );
    expect(expectSome(record)).toMatchObject({
      title: "Highwire Title",
      issued: { "date-parts": [[2001]] },
      publisher: "DC Publisher",
      URL: "https://example.org/page",
      provenance: {
        source: "html",
        retrievedBy: { identifierType: "url", identifier: "https://example.org/page" },
      },
    });
  });
});

describe("COinS", () => {
  /** A COinS span for the KEV pairs. */
  const span = (pairs: Readonly<Record<string, string>>): string =>
    `<span class="Z3988" title="${Record.toEntries(pairs)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&amp;")}"></span>`;

  it("reads one record per span: journal articles, books and chapters", () => {
    const { coins } = readEmbeddedMetadata(
      page(
        "",
        span({
          ctx_ver: "Z39.88-2004",
          rft_val_fmt: "info:ofi/fmt:kev:mtx:journal",
          "rft.genre": "article",
          "rft.atitle": "An Article",
          "rft.jtitle": "A Journal",
          "rft.aulast": "Doe",
          "rft.aufirst": "Jane",
          "rft.au": "Roe, Richard",
          "rft.date": "2010-02",
          "rft.volume": "3",
          "rft.spage": "5",
          "rft.epage": "9",
          rft_id: "info:doi/10.1000/xyz123",
        }) +
          span({
            rft_val_fmt: "info:ofi/fmt:kev:mtx:book",
            "rft.btitle": "A Book",
            "rft.isbn": "9780062316097",
            "rft.pub": "Pub",
            "rft.place": "City",
          }) +
          span({
            "rft.genre": "bookitem",
            "rft.atitle": "A Chapter",
            "rft.btitle": "The Book",
            "rft.pages": "1-20",
          }) +
          span({ "rft.genre": "unknown", "rft.title": "Something", rft_id: "info:pmid/15371539" }) +
          span({ "rft.jtitle": "No title of its own" }) +
          `<span class="other" title="rft.title=Ignored"></span>` +
          `<span class="Z3988" title="rft.title=%E0%A4%A">Bad escape</span>`,
      ),
    );
    expect(coins.map((record) => [record.type, record.title])).toEqual([
      ["article-journal", "An Article"],
      ["book", "A Book"],
      ["chapter", "A Chapter"],
      ["document", "Something"],
      ["document", "%E0%A4%A"],
    ]);
    expect(coins[0]).toMatchObject({
      "container-title": "A Journal",
      author: [
        { family: "Doe", given: "Jane" },
        { family: "Roe", given: "Richard" },
      ],
      issued: { "date-parts": [[2010, 2]] },
      volume: "3",
      page: "5-9",
      identifiers: { doi: "10.1000/xyz123" },
    });
    expect(coins[1]).toMatchObject({
      publisher: "Pub",
      "publisher-place": "City",
      identifiers: { isbn: "9780062316097" },
    });
    expect(coins[2]).toMatchObject({ "container-title": "The Book", page: "1-20" });
    expect(coins[3].identifiers.pmid).toBe("15371539");
  });

  it("keeps at most maxRecords spans", () => {
    const spans = Array.from(
      { length: 5 },
      (_, index) => `<span class="Z3988" title="rft.title=T${index}"></span>`,
    ).join("");
    expect(readEmbeddedMetadata(page("", spans), { maxRecords: 2 }).coins).toHaveLength(2);
  });
});

describe("partial values", () => {
  it("read `property` metas, a lone first page, list values and unnamed people", () => {
    const { page: record } = readEmbeddedMetadata(
      page(
        `<meta property="citation_title" content="By Property"><meta name="citation_firstpage" content="7">` +
          `<script type="application/ld+json">{"@type": "Book", "name": ["Listed", "Other"], "author": [{"@type": "Person"}]}</script>`,
      ),
    );
    expect(expectSome(record)).toMatchObject({ title: "By Property", page: "7" });
    const { page: book } = readEmbeddedMetadata(
      page(
        `<script type="application/ld+json">{"@type": "Book", "name": ["Listed", "Other"]}</script>`,
      ),
    );
    expect(expectSome(book).title).toBe("Listed");
  });

  it("reads a COinS author with a last name only", () => {
    const { coins } = readEmbeddedMetadata(
      page(
        "",
        `<span class="Z3988" title="rft.title=T&amp;rft.aulast=Doe&amp;rft.au=Doe%2C+"></span>`,
      ),
    );
    expect(coins[0].author).toEqual([{ family: "Doe" }]);
  });
});

describe("links", () => {
  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox"],
    ["http://[bad"],
  ])("drops a %j URL from every source, falling back to the page URL", (bad) => {
    const ld = encodeJson({ "@type": "Book", name: "LD", url: bad });
    const { page: record, coins } = readEmbeddedMetadata(
      page(
        `<meta name="citation_title" content="T"><meta name="citation_abstract_html_url" content="${bad.replace(/"/g, "&quot;")}">` +
          `<script type="application/ld+json">${ld}</script>`,
        `<span class="Z3988" title="rft.title=C&amp;rft_id=${encodeURIComponent(bad)}"></span>`,
      ),
      { url: "https://example.org/page" },
    );
    expect(expectSome(record).URL).toBe("https://example.org/page");
    expect(coins[0].URL).toBeUndefined();
  });

  it("takes a later source's safe URL over an unsafe one, and resolves relative links against the page", () => {
    const { page: record } = readEmbeddedMetadata(
      page(
        `<meta name="citation_title" content="T"><meta name="citation_public_url" content="javascript:x">` +
          `<script type="application/ld+json">{"@type": "Book", "name": "LD", "url": "/books/1"}</script>`,
      ),
      { url: "https://example.org/page" },
    );
    expect(expectSome(record).URL).toBe("https://example.org/books/1");
  });

  it("ignores a page URL that is not http(s), and keeps a relative link without one out", () => {
    const { page: record } = readEmbeddedMetadata(
      page(
        `<meta name="citation_title" content="T"><meta name="citation_public_url" content="/rel">`,
      ),
      { url: "javascript:alert(1)" },
    );
    expect(expectSome(record).URL).toBeUndefined();
  });
});

describe("linear scanning", () => {
  /** Milliseconds `run` takes. */
  const time = (run: () => void): number => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };

  it.each([
    ["unclosed script tags", "<script>".repeat(400_000)],
    ["script openers with no '>'", "<script ".repeat(400_000)],
    ["meta openers with no '>'", "<meta ".repeat(500_000)],
    ["span openers with one far '>'", `${"<span ".repeat(500_000)}>`],
    [
      "an unterminated attribute value",
      `<meta ${"a".repeat(60_000)}="${"b".repeat(5_000)}>`.repeat(50),
    ],
  ])("reads a page of %s in linear time", (_, html) => {
    expect(time(() => readEmbeddedMetadata(html))).toBeLessThan(5_000);
  });

  it("skips a <script inside an earlier script's text, and an over-long tag", () => {
    const { page: record } = readEmbeddedMetadata(
      page(
        `<script>var s = "<script type='application/ld+json'>{}";</script>` +
          `<meta name="citation_title" content="${"x".repeat(70_000)}">` +
          `<script type="application/ld+json">{"@type": "Book", "name": "Real"}</script>`,
      ),
    );
    expect(expectSome(record).title).toBe("Real");
  });
});

describe("bounds", () => {
  it("reads nothing from a page with no metadata, or one over the input cap", () => {
    expect(readEmbeddedMetadata(page("<title>Plain</title>"))).toEqual({
      page: Option.none(),
      coins: [],
    });
    expect(
      readEmbeddedMetadata(page(`<meta name="citation_title" content="T">`), {
        maxInputLength: 10,
      }),
    ).toEqual({ page: Option.none(), coins: [] });
  });

  it("keeps unknown or out-of-range character references as written", () => {
    const { page: record } = readEmbeddedMetadata(
      page(`<meta name="citation_title" content="a &bogus; &#0; &#xD800; b">`),
    );
    expect(expectSome(record).title).toBe("a &bogus; &#0; &#xD800; b");
  });

  it("keeps an unparseable date as raw text", () => {
    const { page: record } = readEmbeddedMetadata(
      page(`<meta name="citation_title" content="T"><meta name="citation_date" content="Spring">`),
    );
    expect(expectSome(record).issued).toEqual({ raw: "Spring" });
  });
});
