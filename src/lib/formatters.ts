import type { Source, CitationStyle } from './types';

// Helper to format author names
function formatAuthors(authors: string | string[] | undefined, style: CitationStyle): string {
	if (!authors) return '';
	
	const authorArray = Array.isArray(authors) ? authors : [authors];
	
	switch (style) {
		case 'apa':
		case 'chicago':
		case 'harvard':
			if (authorArray.length === 1) return authorArray[0];
			if (authorArray.length === 2) return `${authorArray[0]} & ${authorArray[1]}`;
			return `${authorArray[0]} et al.`;
		case 'mla':
			if (authorArray.length === 1) return authorArray[0];
			if (authorArray.length === 2) return `${authorArray[0]} and ${authorArray[1]}`;
			return `${authorArray[0]} et al.`;
		case 'ieee':
		case 'vancouver':
			if (authorArray.length === 1) return authorArray[0];
			return `${authorArray[0]} et al.`;
		default:
			return authorArray[0] || '';
	}
}

// Format inline citation
export function formatInlineCitation(source: Source, style: CitationStyle, citationNumber?: number, page?: number): string {
	const year = source.year?.toString() || 'n.d.';
	const author = formatAuthors(source.author, style);
	
	switch (style) {
		case 'apa':
		case 'harvard':
			return page ? `(${author}, ${year}, p. ${page})` : `(${author}, ${year})`;
		case 'mla':
			return page ? `(${author} ${page})` : `(${author})`;
		case 'chicago':
			return page ? `(${author} ${year}, ${page})` : `(${author} ${year})`;
		case 'ieee':
		case 'vancouver':
			return citationNumber ? `[${citationNumber}]` : `[?]`;
		default:
			return `(${author}, ${year})`;
	}
}

// Format bibliography entry
export function formatBibliographyEntry(source: Source, style: CitationStyle, number?: number): string {
	const author = source.author ? (Array.isArray(source.author) ? source.author.join(', ') : source.author) : '';
	const year = source.year?.toString() || 'n.d.';
	const title = source.title;
	
	switch (style) {
		case 'apa':
			return formatAPA(source, author, year, title);
		case 'mla':
			return formatMLA(source, author, year, title);
		case 'chicago':
			return formatChicago(source, author, year, title);
		case 'harvard':
			return formatHarvard(source, author, year, title);
		case 'ieee':
			return formatIEEE(source, author, year, title, number);
		case 'vancouver':
			return formatVancouver(source, author, year, title, number);
		default:
			return `${author} (${year}). ${title}`;
	}
}

function formatAPA(source: Source, author: string, year: string, title: string): string {
	let entry = `${author} (${year}). `;
	
	switch (source.type) {
		case 'article':
			entry += `${title}. `;
			if (source.journal) entry += `<i>${source.journal}</i>`;
			if (source.volume) entry += `, ${source.volume}`;
			if (source.issue) entry += `(${source.issue})`;
			if (source.pages) entry += `, ${source.pages}`;
			if (source.doi) entry += `. https://doi.org/${source.doi}`;
			break;
		case 'book':
			entry += `<i>${title}</i>`;
			if (source.edition) entry += ` (${source.edition})`;
			if (source.publisher) entry += `. ${source.publisher}`;
			break;
		case 'website':
			entry += `${title}. `;
			if (source.publisher) entry += `${source.publisher}. `;
			if (source.url) entry += source.url;
			if (source.accessed) entry += ` (accessed ${source.accessed})`;
			break;
		default:
			entry += `${title}`;
			if (source.publisher) entry += `. ${source.publisher}`;
	}
	
	return entry + '.';
}

function formatMLA(source: Source, author: string, year: string, title: string): string {
	let entry = `${author}. `;
	
	switch (source.type) {
		case 'article':
			entry += `"${title}." `;
			if (source.journal) entry += `<i>${source.journal}</i>`;
			if (source.volume) entry += `, vol. ${source.volume}`;
			if (source.issue) entry += `, no. ${source.issue}`;
			if (year) entry += `, ${year}`;
			if (source.pages) entry += `, pp. ${source.pages}`;
			break;
		case 'book':
			entry += `<i>${title}</i>. `;
			if (source.publisher) entry += `${source.publisher}, `;
			entry += `${year}`;
			break;
		case 'website':
			entry += `"${title}." `;
			if (source.publisher) entry += `${source.publisher}, `;
			entry += `${year}`;
			if (source.url) entry += `, ${source.url}`;
			break;
		default:
			entry += `${title}. ${year}`;
	}
	
	return entry + '.';
}

function formatChicago(source: Source, author: string, year: string, title: string): string {
	let entry = `${author}. ${year}. `;
	
	switch (source.type) {
		case 'article':
			entry += `"${title}." `;
			if (source.journal) entry += `<i>${source.journal}</i> `;
			if (source.volume) entry += `${source.volume}`;
			if (source.issue) entry += ` (${source.issue})`;
			if (source.pages) entry += `: ${source.pages}`;
			break;
		case 'book':
			entry += `<i>${title}</i>. `;
			if (source.publisher) entry += `${source.publisher}`;
			break;
		case 'website':
			entry += `"${title}." `;
			if (source.url) entry += source.url;
			if (source.accessed) entry += `. Accessed ${source.accessed}`;
			break;
		default:
			entry += `${title}`;
	}
	
	return entry + '.';
}

function formatHarvard(source: Source, author: string, year: string, title: string): string {
	// Harvard is similar to APA
	return formatAPA(source, author, year, title);
}

function formatIEEE(source: Source, author: string, year: string, title: string, number?: number): string {
	let entry = number ? `[${number}] ` : '';
	entry += `${author}, `;
	
	switch (source.type) {
		case 'article':
			entry += `"${title}," `;
			if (source.journal) entry += `<i>${source.journal}</i>`;
			if (source.volume) entry += `, vol. ${source.volume}`;
			if (source.issue) entry += `, no. ${source.issue}`;
			if (source.pages) entry += `, pp. ${source.pages}`;
			entry += `, ${year}`;
			break;
		case 'book':
			entry += `<i>${title}</i>. `;
			if (source.publisher) entry += `${source.publisher}, `;
			entry += `${year}`;
			break;
		default:
			entry += `"${title}," ${year}`;
	}
	
	return entry + '.';
}

function formatVancouver(source: Source, author: string, year: string, title: string, number?: number): string {
	// Vancouver is similar to IEEE but with slight differences
	let entry = number ? `${number}. ` : '';
	entry += `${author}. `;
	entry += `${title}. `;
	
	switch (source.type) {
		case 'article':
			if (source.journal) entry += `${source.journal}. `;
			entry += `${year}`;
			if (source.volume) entry += `;${source.volume}`;
			if (source.issue) entry += `(${source.issue})`;
			if (source.pages) entry += `:${source.pages}`;
			break;
		case 'book':
			if (source.publisher) entry += `${source.publisher}; `;
			entry += `${year}`;
			break;
		default:
			entry += `${year}`;
	}
	
	return entry + '.';
}
