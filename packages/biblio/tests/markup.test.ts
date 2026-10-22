/**
 * Unit tests for CSL rich-text markup (`src/render/markup.ts`): the six CSL
 * elements read into rich text and written back, and everything else kept
 * as literal text.
 *
 * @module tests/unit/biblio-markup
 */

import * as Array from "effect/Array";
import { describe, expect, it } from "vite-plus/test";
import {
  bold,
  concat,
  italic,
  link,
  noCase,
  parseCslMarkup,
  smallCaps,
  stripCslMarkup,
  subscript,
  superscript,
  text,
  toCslMarkup,
  toHtml,
  toMarkdown,
  toPlainText,
} from "@thomasfosterau/biblio";

describe("parseCslMarkup", () => {
  it("reads each CSL element into its span", () => {
    expect(
      parseCslMarkup(
        'a<i>i</i><b>b</b><sup>p</sup><sub>s</sub><span style="font-variant:small-caps;">c</span><span class="nocase">n</span>z',
      ),
    ).toEqual(
      concat(
        text("a"),
        italic(text("i")),
        bold(text("b")),
        superscript(text("p")),
        subscript(text("s")),
        smallCaps(text("c")),
        noCase(text("n")),
        text("z"),
      ),
    );
  });

  it("nests spans and tolerates spacing in the span attributes", () => {
    expect(
      parseCslMarkup('<i>a <b>b</b></i><span style=" font-variant: small-caps ">c</span>'),
    ).toEqual(concat(italic(concat(text("a "), bold(text("b")))), smallCaps(text("c"))));
  });

  it("keeps unknown, unbalanced and attribute-bearing tags as literal text", () => {
    Array.forEach(
      [
        "a < b",
        "x <u>u</u>",
        "<i>open",
        "close</i>",
        "<i>a</b>",
        '<i class="x">a</i>',
        '<span style="color:red">a</span>',
        "<i>a<b>b</i>",
        "<script>x</script>",
      ],
      (value) => {
        expect(toPlainText(parseCslMarkup(value))).toBe(value);
      },
    );
    expect(parseCslMarkup("<i>a<b>b</i>")).toEqual(text("<i>a<b>b</i>"));
    expect(parseCslMarkup("<i>a <b>b</b>")).toEqual(concat(text("<i>a "), bold(text("b"))));
  });

  it("drops an empty span and reads plain text as one node", () => {
    expect(parseCslMarkup("<i></i>x")).toEqual(text("x"));
    expect(parseCslMarkup("")).toEqual([]);
    expect(parseCslMarkup("plain")).toEqual(text("plain"));
  });

  it("reads nesting past 32 levels as literal text, without recursion", () => {
    const deep = `${"<b>".repeat(40)}x${"</b>".repeat(40)}`;
    expect(toPlainText(parseCslMarkup(deep))).toBe(`${"<b>".repeat(8)}x${"</b>".repeat(8)}`);
    const hostile = "<i>".repeat(100_000);
    expect(toPlainText(parseCslMarkup(hostile))).toBe(hostile);
  });
});

describe("toCslMarkup / stripCslMarkup", () => {
  it("writes rich text back as CSL markup, links and display regions as their text", () => {
    const rich = concat(
      italic(text("i")),
      noCase(text("DNA")),
      smallCaps(text("sc")),
      link("https://example.org", text("site")),
    );
    expect(toCslMarkup(rich)).toBe(
      '<i>i</i><span class="nocase">DNA</span><span style="font-variant:small-caps;">sc</span>site',
    );
    const markup = 'A <i>b</i> <span class="nocase">C</span> <sup>d</sup>';
    expect(toCslMarkup(parseCslMarkup(markup))).toBe(markup);
  });

  it("strips the markup to plain text", () => {
    expect(stripCslMarkup('The <i>Beagle</i> and <span class="nocase">DNA</span>')).toBe(
      "The Beagle and DNA",
    );
  });

  it("renders a nocase span as its children in HTML and Markdown", () => {
    expect(toHtml(noCase(text("DNA")))).toBe("DNA");
    expect(toMarkdown(noCase(text("DNA")))).toBe("DNA");
  });
});
