/**
 * The render module — CSL records + a citation style → formatted references
 * and bibliographies.
 *
 * The engine is a **scoped Effect-native subset renderer**, chosen over
 * wrapping citeproc-js for a lean dependency footprint and bundle size,
 * determinism and no network at render time.
 *
 * Styles and locales are typed data inputs; rendering is pure and network-
 * free. Two built-in styles ship: `apaStyle` (author-date) and
 * `vancouverStyle` (numeric).
 *
 * @copyright Thomas Foster
 * @module biblio/render
 * @since 0.1.0
 */

// See website#1072.

export * from "./types.ts";
export * from "./locale.ts";
export * from "./format.ts";
export * from "./styles.ts";
export * from "./styles/apa.ts";
export * from "./styles/vancouver.ts";
export * from "./render.ts";
