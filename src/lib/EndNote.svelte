<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { FootnoteContext } from './types';

	export let id: string = '';
	export let content: string = '';

	const context = getContext<FootnoteContext>('footnotes');
	let endnoteNumber: number = 0;

	onMount(() => {
		if (context) {
			if (!id) {
				id = `endnote-${Date.now()}-${Math.random()}`;
			}
			endnoteNumber = context.addFootnote(id, content);
		}
	});
</script>

{#if endnoteNumber > 0}
	<sup class="endnote-ref">
		<a href="#{id}" id="ref-{id}">{endnoteNumber}</a>
	</sup>
{/if}

<style>
	.endnote-ref {
		font-size: 0.8em;
		margin-left: 0.1em;
	}

	.endnote-ref a {
		text-decoration: none;
		color: #0066cc;
	}

	.endnote-ref a:hover {
		text-decoration: underline;
	}
</style>
