/**
 * @copyright Thomas Foster
 *
 * Built-in locales for the render module (biblio B5, issue #1072).
 *
 * A {@link Locale} is a typed **data input** — the render engine never
 * fetches one. `en-US` is the default the built-in styles are authored
 * against; further locales are added additively as plain objects, so a
 * caller can supply its own without touching the engine.
 *
 * @module biblio/render/locale
 */

import type { Locale } from "./types";

/** The default US-English locale terms. */
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
};
