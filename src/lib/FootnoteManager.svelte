<script lang="ts">
	import { setContext } from 'svelte';
	import type { Footnote, FootnoteContext } from './types';

	const footnotes = new Map<string, Footnote>();
	let footnoteCounter = 0;

	function addFootnote(id: string, content: string): number {
		if (!footnotes.has(id)) {
			footnoteCounter++;
			footnotes.set(id, { id, content, number: footnoteCounter });
		}
		return footnotes.get(id)!.number;
	}

	function getFootnote(id: string): Footnote | undefined {
		return footnotes.get(id);
	}

	function getSortedFootnotes(): Footnote[] {
		return Array.from(footnotes.values()).sort((a, b) => a.number - b.number);
	}

	const context: FootnoteContext = {
		footnotes,
		addFootnote,
		getFootnote,
		getSortedFootnotes
	};

	setContext('footnotes', context);
</script>

<slot />
