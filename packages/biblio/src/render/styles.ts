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
 * @since 0.1.0
 */

import { apaStyle } from "./styles/apa.ts";
import { vancouverStyle } from "./styles/vancouver.ts";
import type { CitationStyle } from "./types.ts";

/**
 * The styles shipped with the package, keyed by {@link CitationStyle.id}.
 *
 * @since 0.1.0
 */
export const builtInStyles: Readonly<Record<string, CitationStyle>> = {
  apa: apaStyle,
  vancouver: vancouverStyle,
};

/*
 * NOT migrated to `Option`: `getStyle` is imported by
 * `apps/api/src/biblio/reference-render.ts`, which tests the result against
 * `undefined`. Changing the signature is a cross-package edit a later wave
 * owns.
 */
/**
 * Resolves a built-in style by id, or `undefined` when unknown.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line effect/prefer-option-over-null -- cross-slice: apps/api consumes the plain `undefined`
export function getStyle(id: string): CitationStyle | undefined {
  return builtInStyles[id];
}
