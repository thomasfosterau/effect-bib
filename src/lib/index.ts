// Main components
export { default as ReferenceManager } from './ReferenceManager.svelte';
export { default as Citation } from './Citation.svelte';
export { default as Bibliography } from './Bibliography.svelte';

// Footnote components
export { default as FootnoteManager } from './FootnoteManager.svelte';
export { default as Footnote } from './Footnote.svelte';
export { default as FootnoteList } from './FootnoteList.svelte';

// Note components
export { default as EndNote } from './EndNote.svelte';
export { default as EndNoteList } from './EndNoteList.svelte';
export { default as SideNote } from './SideNote.svelte';

// Types
export type { Source, CitationStyle, ReferenceManagerContext, FootnoteContext } from './types';
export type { Footnote as FootnoteType } from './types';

// Formatters (for advanced usage)
export { formatInlineCitation, formatBibliographyEntry } from './formatters';
