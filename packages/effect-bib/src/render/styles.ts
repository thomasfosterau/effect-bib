/**
 * The built-in citation-style registry.
 *
 * Styles are typed data inputs; this is the lookup a caller resolves a style
 * id against. Adding a style is adding an entry here — the engine is
 * unchanged.
 *
 * @copyright Thomas Foster
 * @module effect-bib/render/styles
 * @since 0.1.0
 */

// See website#1072.

import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import { apaStyle } from "./styles/apa.ts";
import { chicagoNotesStyle } from "./styles/chicago.ts";
import { vancouverStyle } from "./styles/vancouver.ts";
import type { CitationStyle } from "./types.ts";

/**
 * The styles shipped with the package, keyed by {@link CitationStyle.id}.
 *
 * @since 0.1.0
 */
export const builtInStyles = {
  apa: apaStyle,
  vancouver: vancouverStyle,
  "chicago-notes": chicagoNotesStyle,
} as const satisfies Readonly<Record<string, CitationStyle>>;

/** {@link builtInStyles} as a lookup by any id; a non-style key (`toString`, …) is absent. */
const STYLES_BY_ID = HashMap.fromIterable<string, CitationStyle>(R.toEntries(builtInStyles));

/**
 * Resolves a built-in style by id; `Option.none()` when the id is unknown.
 *
 * @since 0.1.0
 */
export function getStyle(id: string): Option.Option<CitationStyle> {
  return HashMap.get(STYLES_BY_ID, id);
}
