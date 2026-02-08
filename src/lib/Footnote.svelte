<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { FootnoteContext } from './types';

	export let id: string = '';
	export let content: string = '';

	const context = getContext<FootnoteContext>('footnotes');
	let footnoteNumber: number = 0;

	onMount(() => {
		if (!context) {
			console.error('Footnote component must be used within a FootnoteManager');
			return;
		}

		if (!id) {
			id = `footnote-${Date.now()}-${Math.random()}`;
		}

		footnoteNumber = context.addFootnote(id, content);
	});
</script>

{#if footnoteNumber > 0}
	<sup class="footnote-ref">
		<a href="#{id}" id="ref-{id}">{footnoteNumber}</a>
	</sup>
{/if}

<style>
	.footnote-ref {
		font-size: 0.8em;
		margin-left: 0.1em;
	}

	.footnote-ref a {
		text-decoration: none;
		color: #0066cc;
	}

	.footnote-ref a:hover {
		text-decoration: underline;
	}
</style>
