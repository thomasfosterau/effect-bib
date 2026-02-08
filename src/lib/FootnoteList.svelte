<script lang="ts">
	import { getContext } from 'svelte';
	import type { FootnoteContext } from './types';

	export let title: string = 'Footnotes';

	const context = getContext<FootnoteContext>('footnotes');

	$: sortedFootnotes = context?.getSortedFootnotes() || [];
</script>

{#if context && sortedFootnotes.length > 0}
	<div class="footnotes">
		<h2 class="footnotes-title">{title}</h2>
		<ol class="footnotes-list">
			{#each sortedFootnotes as footnote}
				<li class="footnote-item" id={footnote.id}>
					{footnote.content}
					<a href="#ref-{footnote.id}" class="footnote-backref">↩</a>
				</li>
			{/each}
		</ol>
	</div>
{/if}

<style>
	.footnotes {
		margin: 2rem 0;
		padding-top: 1rem;
		border-top: 1px solid #ccc;
	}

	.footnotes-title {
		font-size: 1.2rem;
		font-weight: bold;
		margin-bottom: 0.5rem;
	}

	.footnotes-list {
		padding-left: 2rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.footnote-item {
		margin-bottom: 0.5rem;
	}

	.footnote-backref {
		margin-left: 0.5em;
		text-decoration: none;
		color: #0066cc;
	}

	.footnote-backref:hover {
		text-decoration: underline;
	}
</style>
