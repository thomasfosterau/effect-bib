/**
 * @copyright Thomas Foster
 *
 * The render module — CSL records + a citation style → formatted references
 * and bibliographies (biblio B5, issue #1072).
 *
 * The engine is a **scoped Effect-native subset renderer**, chosen over
 * wrapping citeproc-js against the B1 decision doc's criteria (style/locale
 * coverage the site genuinely needs, the lean-dependency posture and Worker
 * bundle cost, determinism / no-network-at-render-time, and extraction-
 * trajectory friendliness). See
 *  → "Rendering
 * engine".
 *
 * Styles and locales are typed data inputs; rendering is pure and network-
 * free. Two built-in styles ship: {@link module:biblio/render/styles/apa}
 * (author-date) and {@link module:biblio/render/styles/vancouver} (numeric).
 *
 * @module biblio/render
 * @since 0.1.0
 */

export * from "./types.ts";
export * from "./locale.ts";
export * from "./format.ts";
export * from "./styles.ts";
export * from "./styles/apa.ts";
export * from "./styles/vancouver.ts";
export * from "./render.ts";
