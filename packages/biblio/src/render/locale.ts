/**
 * Built-in locales for the render module (#1072).
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
};
