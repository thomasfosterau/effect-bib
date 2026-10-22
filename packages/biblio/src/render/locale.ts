/**
 * Built-in locales for the render module.
 *
 * A {@link Locale} is a typed **data input** — the render engine never
 * fetches one. `en-US` is the default the built-in styles are authored
 * against; further locales are added additively as plain objects, so a
 * caller can supply its own without touching the engine.
 *
 * @copyright Thomas Foster
 * @module biblio/render/locale
 * @since 0.1.0
 */

// See website#1072.

import type { Locale } from "./types.ts";

/**
 * The default US-English locale terms.
 *
 * @since 0.1.0
 */
export const enLocale: Locale = {
  id: "en-US",
  and: "and",
  etAl: "et al.",
  editor: "Ed.",
  editors: "Eds.",
  edition: "ed.",
  noDate: "n.d.",
  page: "p.",
  pages: "pp.",
  in: "In",
  availableFrom: "Available from:",
  internet: "Internet",
  ibid: "ibid.",
  locators: {
    act: ["act", "acts"],
    appendix: ["app.", "apps."],
    "article-locator": ["art.", "arts."],
    book: ["bk.", "bks."],
    canon: ["c.", "cc."],
    chapter: ["chap.", "chaps."],
    column: ["col.", "cols."],
    elocation: ["loc.", "locs."],
    equation: ["eq.", "eqs."],
    figure: ["fig.", "figs."],
    folio: ["fol.", "fols."],
    issue: ["no.", "nos."],
    line: ["l.", "ll."],
    note: ["n.", "nn."],
    opus: ["op.", "opp."],
    page: ["p.", "pp."],
    paragraph: ["para.", "paras."],
    part: ["pt.", "pts."],
    rule: ["r.", "rr."],
    scene: ["sc.", "scs."],
    section: ["sec.", "secs."],
    "sub-verbo": ["s.v.", "s.vv."],
    supplement: ["supp.", "supps."],
    table: ["tbl.", "tbls."],
    timestamp: ["", ""],
    "title-locator": ["tit.", "tits."],
    verse: ["v.", "vv."],
    version: ["v.", "v."],
    volume: ["vol.", "vols."],
  },
};
