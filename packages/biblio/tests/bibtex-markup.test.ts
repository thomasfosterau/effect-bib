/**
 * Unit tests for #96: BibTeX formatting as CSL markup (the opt-in
 * `bibtexMarkup` parse option), the italic flip-flop in the HTML and
 * Markdown adapters, and Vancouver's rich output.
 *
 * @module tests/unit/biblio-bibtex-markup
 */

import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import {
  type BiblioRecord,
  concat,
  dispatchReference,
  enLocale,
  fromCslJson,
  italic,
  type ParseOutcome,
  parseBibtex,
  parseCslMarkup,
  renderReference,
  renderReferenceRich,
  stripCslMarkup,
  terminatedField,
  text,
  toBibtex,
  toHtml,
  toMarkdown,
  toPlainText,
  vancouverStyle,
} from "@thomasfosterau/biblio";

/** The record of the first outcome, failing the test when it is not parsed. */
function recordOf(outcomes: readonly ParseOutcome[]): BiblioRecord {
  const [outcome] = outcomes;
  if (outcome?.outcome !== "parsed") return expect.fail("expected a parsed outcome");
  return outcome.record;
}

/** The title one BibTeX entry with `title` parses to, with or without markup (`""` for none). */
const title = (source: string, bibtexMarkup: boolean): string =>
  recordOf(parseBibtex(`@misc{k, title = {${source}}}`, { mode: "lenient", bibtexMarkup })).title ??
  "";

describe("the bibtexMarkup parse option", () => {
  it("leaves the default output unchanged", () => {
    expect(title("The \\emph{E. coli} {DNA} of CO\\textsubscript{2}", false)).toBe(
      "The E. coli DNA of CO2",
    );
  });

  it.each([
    ["\\emph{Homo sapiens}", "<i>Homo sapiens</i>"],
    ["\\textit{italic}", "<i>italic</i>"],
    ["\\textbf{bold}", "<b>bold</b>"],
    ["\\textsc{Small Caps}", '<span style="font-variant:small-caps;">Small Caps</span>'],
    ["E = mc\\textsuperscript{2}", "E = mc<sup>2</sup>"],
    ["CO\\textsubscript{2}", "CO<sub>2</sub>"],
    [
      "The {DNA} of {NASA}",
      'The <span class="nocase">DNA</span> of <span class="nocase">NASA</span>',
    ],
    ["Sch{\\\"o}n's {Method}", 'Schön\'s <span class="nocase">Method</span>'],
    ["{The {Nested} Group}", '<span class="nocase">The Nested Group</span>'],
    ["{\\emph{Protected} italics}", "<i>Protected</i> italics"],
    ["\\emph{An {RNA} world}", '<i>An <span class="nocase">RNA</span> world</i>'],
    ["x\\emph{}y", "xy"],
    ["x {} y", "x y"],
    ["\\enquote{quoted \\emph{word}}", "“quoted <i>word</i>”"],
    ["\\url{http://example.org/<a>}", 'http://example.org/<span class="nocase"><</span>a>'],
    ["\\href{http://example.org}{the \\emph{site}}", "the <i>site</i>"],
    ["a\\href b", "ab"],
  ])("reads %j as %j", (source, expected) => {
    expect(title(source, true)).toBe(expected);
  });

  it("writes a literal < so that it reads back as text, never as a tag", () => {
    const value = title("a <i>b</i> \\textless{} c", true);
    expect(value).toBe(
      'a <span class="nocase"><</span>i>b<span class="nocase"><</span>/i> <span class="nocase"><</span> c',
    );
    expect(stripCslMarkup(value)).toBe("a <i>b</i> < c");
    expect(toHtml(parseCslMarkup(value))).toBe("a &lt;i&gt;b&lt;/i&gt; &lt; c");
  });

  it("keeps names, dates and identifiers plain", () => {
    const outcomes = parseBibtex(
      "@article{k, title = {T}, author = {{NASA} and \\emph{Doe}, Jane}, date = {2020}, doi = {10.1000/xyz123}}",
      { bibtexMarkup: true },
    );
    expect(recordOf(outcomes).author).toEqual([
      { literal: "NASA" },
      { family: "Doe", given: "Jane" },
    ]);
  });

  it("round-trips CSL markup through toBibtex", () => {
    const record = fromCslJson({
      type: "article-journal",
      title: 'The <i>E. coli</i> <span class="nocase">DNA</span> and CO<sub>2</sub>',
      "container-title": "<b>Bold</b> Journal",
    });
    const back = recordOf(parseBibtex(toBibtex([record]), { mode: "lenient", bibtexMarkup: true }));
    expect(back.title).toBe(record.title);
    expect(back["container-title"]).toBe(record["container-title"]);
  });
});

describe("the string-style helpers", () => {
  it("still assemble a plain-text style, now that no built-in style uses them", () => {
    const render = dispatchReference(() => "Head.", {
      book: (record) =>
        terminatedField(Option.fromUndefinedOr(record.title)).pipe(Option.getOrElse(() => "")),
      chapter: () => "chapter",
      article: () => "article",
      webpage: () => "webpage",
      generic: () => "generic",
    });
    const ctx = { locale: enLocale };
    expect(render(fromCslJson({ type: "book", title: "Sapiens" }), ctx)).toBe("Head. Sapiens.");
    expect(render(fromCslJson({ type: "report" }), ctx)).toBe("Head. generic");
  });
});

describe("the italic flip-flop", () => {
  const nested = italic(concat(text("On the "), italic(text("Beagle")), text(" voyage")));

  it("renders italic inside italic upright in HTML, and italic again a level deeper", () => {
    expect(toHtml(nested)).toBe(
      '<i>On the <span style="font-style:normal;">Beagle</span> voyage</i>',
    );
    expect(toHtml(italic(italic(italic(text("x")))))).toBe(
      '<i><span style="font-style:normal;"><i>x</i></span></i>',
    );
  });

  it("closes the Markdown emphasis around a nested italic, spaces outside the delimiters", () => {
    expect(toMarkdown(nested)).toBe("*On the* Beagle *voyage*");
    expect(toMarkdown(italic(concat(italic(text("Homo")), text(" sapiens"))))).toBe(
      "Homo *sapiens*",
    );
    expect(toMarkdown(italic(text(" padded ")))).toBe(" *padded* ");
    expect(toMarkdown(italic(text("  ")))).toBe("  ");
    expect(toMarkdown(italic(italic(italic(text("x")))))).toBe("*x*");
  });

  it("leaves the plain text alone", () => {
    expect(toPlainText(nested)).toBe("On the Beagle voyage");
  });
});

/** A CSL-JSON item as these tests write it. */
type CslInput = Readonly<Record<string, string | ReadonlyArray<Readonly<Record<string, string>>>>>;

describe("Vancouver rich output", () => {
  const record = fromCslJson({
    type: "article-journal",
    title: "Atmospheric CO<sub>2</sub> and <i>Escherichia coli</i>",
    "container-title": "Nature",
    author: [{ family: "Smith", given: "John" }],
    volume: "431",
    issue: "7006",
    page: "231-5",
    issued: { "date-parts": [[2004]] },
  });

  it("keeps a title's markup in the rich and HTML output", () => {
    expect(toHtml(renderReferenceRich(record, { style: vancouverStyle }))).toBe(
      "Smith J. Atmospheric CO<sub>2</sub> and <i>Escherichia coli</i>. Nature. 2004;431(7006):231-5.",
    );
  });

  it("renders the same plain text as before", () => {
    expect(renderReference(record, { style: vancouverStyle })).toBe(
      "Smith J. Atmospheric CO2 and Escherichia coli. Nature. 2004;431(7006):231-5.",
    );
  });

  it("keeps markup in every reference class", () => {
    const html = (item: CslInput) =>
      toHtml(renderReferenceRich(fromCslJson(item), { style: vancouverStyle }));
    expect(
      html({
        type: "book",
        title: "<i>Book</i>",
        publisher: "Pub",
        "publisher-place": "Here",
        edition: "2",
      }),
    ).toBe("<i>Book</i>. 2 ed. Here: Pub; n.d.");
    expect(
      html({
        type: "chapter",
        title: "<b>Chapter</b>",
        "container-title": "<i>Book</i>",
        editor: [
          { family: "Doe", given: "Jane" },
          { family: "Roe", given: "Rick" },
        ],
        page: "1-5",
      }),
    ).toContain("<b>Chapter</b>. In: Doe J, Roe R, editors. <i>Book</i>.");
    expect(html({ type: "webpage", title: "<i>Page</i>", URL: "https://example.org" })).toContain(
      "<i>Page</i> [Internet].",
    );
    expect(html({ type: "report", title: "<sup>Report</sup>", publisher: "Pub" })).toBe(
      "<sup>Report</sup>. Pub. n.d.",
    );
  });
});
