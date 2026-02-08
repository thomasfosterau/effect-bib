<script lang="ts">
	import { setContext } from 'svelte';
	import type { Source, CitationStyle, ReferenceManagerContext } from './types';

	export let style: CitationStyle = 'apa';

	const sources = new Map<string, Source>();
	const citations = new Map<string, number[]>();
	let citationCounter = 0;

	function addSource(source: Source) {
		sources.set(source.id, source);
	}

	function addCitation(sourceId: string, page?: number) {
		if (!citations.has(sourceId)) {
			citationCounter++;
			citations.set(sourceId, [citationCounter]);
		}
		if (page && citations.has(sourceId)) {
			const pages = citations.get(sourceId)!;
			if (!pages.includes(page)) {
				pages.push(page);
			}
		}
	}

	function getSource(sourceId: string): Source | undefined {
		return sources.get(sourceId);
	}

	function getCitationNumber(sourceId: string): number {
		const nums = citations.get(sourceId);
		return nums ? nums[0] : 0;
	}

	function getSortedSources(): Source[] {
		const sourceArray = Array.from(sources.values());
		
		// Sort based on citation style
		switch (style) {
			case 'ieee':
			case 'vancouver':
				// Numerical order (by first citation)
				return sourceArray.sort((a, b) => {
					const numA = getCitationNumber(a.id);
					const numB = getCitationNumber(b.id);
					return numA - numB;
				});
			default:
				// Alphabetical by author
				return sourceArray.sort((a, b) => {
					const authorA = Array.isArray(a.author) ? a.author[0] : a.author || '';
					const authorB = Array.isArray(b.author) ? b.author[0] : b.author || '';
					return authorA.localeCompare(authorB);
				});
		}
	}

	const context: ReferenceManagerContext = {
		sources,
		citations,
		style,
		addSource,
		addCitation,
		getSource,
		getCitationNumber,
		getSortedSources
	};

	setContext('referenceManager', context);
</script>

<slot />
