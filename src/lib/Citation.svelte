<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { ReferenceManagerContext, Source } from './types';
	import { formatInlineCitation } from './formatters';

	export let sourceId: string = '';
	export let source: Source | undefined = undefined;
	export let page: number | undefined = undefined;

	const context = getContext<ReferenceManagerContext>('referenceManager');

	let citationText = '';

	onMount(() => {
		if (!context) {
			console.error('Citation component must be used within a ReferenceManager');
			return;
		}

		// If source object is provided directly, add it
		if (source) {
			if (!source.id) {
				source.id = `source-${Date.now()}-${Math.random()}`;
			}
			context.addSource(source);
			sourceId = source.id;
		}

		if (!sourceId) {
			console.error('Citation must have either sourceId or source prop');
			return;
		}

		// Register citation
		context.addCitation(sourceId, page);

		// Format citation
		const src = context.getSource(sourceId);
		if (src) {
			const citationNumber = context.getCitationNumber(sourceId);
			citationText = formatInlineCitation(src, context.style, citationNumber, page);
		}
	});
</script>

{#if citationText}
	<span class="citation">{@html citationText}</span>
{/if}

<style>
	.citation {
		white-space: nowrap;
	}
</style>
