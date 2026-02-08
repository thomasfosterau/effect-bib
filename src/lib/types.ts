// Types for citation sources
export interface Source {
	id: string;
	type: 'article' | 'book' | 'website' | 'report' | 'conference' | 'thesis' | 'misc';
	title: string;
	author?: string | string[];
	year?: number | string;
	publisher?: string;
	url?: string;
	doi?: string;
	pages?: string;
	volume?: string;
	issue?: string;
	journal?: string;
	editor?: string | string[];
	edition?: string;
	accessed?: string;
	[key: string]: any; // Allow additional fields
}

// Citation styles
export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'harvard' | 'ieee' | 'vancouver';

// Reference manager context
export interface ReferenceManagerContext {
	sources: Map<string, Source>;
	citations: Map<string, number[]>;
	style: CitationStyle;
	addSource: (source: Source) => void;
	addCitation: (sourceId: string, page?: number) => void;
	getSource: (sourceId: string) => Source | undefined;
	getCitationNumber: (sourceId: string) => number;
	getSortedSources: () => Source[];
}

// Footnote types
export interface Footnote {
	id: string;
	content: string;
	number: number;
}

export interface FootnoteContext {
	footnotes: Map<string, Footnote>;
	addFootnote: (id: string, content: string) => number;
	getFootnote: (id: string) => Footnote | undefined;
	getSortedFootnotes: () => Footnote[];
}
