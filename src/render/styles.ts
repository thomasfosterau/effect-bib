/**
 * @copyright Thomas Foster
 *
 * The built-in citation-style registry (biblio B5, issue #1072).
 *
 * Styles are typed data inputs; this is the lookup a caller resolves a style
 * id against. Adding a style is adding an entry here — the engine is
 * unchanged.
 *
 * @module biblio/render/styles
 */

import { apaStyle } from "./styles/apa.ts";
import { vancouverStyle } from "./styles/vancouver.ts";
import type { CitationStyle } from "./types.ts";

/** The styles shipped with the package, keyed by {@link CitationStyle.id}. */
export const builtInStyles: Readonly<Record<string, CitationStyle>> = {
  apa: apaStyle,
  vancouver: vancouverStyle,
};

/** Resolves a built-in style by id, or `undefined` when unknown. */
export function getStyle(id: string): CitationStyle | undefined {
  return builtInStyles[id];
}

export { apaStyle, vancouverStyle };
