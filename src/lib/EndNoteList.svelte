<script lang="ts">
	import { getContext } from 'svelte';
	import type { FootnoteContext } from './types';

	export let title: string = 'Endnotes';

	const context = getContext<FootnoteContext>('footnotes');

	$: sortedEndnotes = context?.getSortedFootnotes() || [];
</script>

{#if context && sortedEndnotes.length > 0}
	<div class="endnotes">
		<h2 class="endnotes-title">{title}</h2>
		<ol class="endnotes-list">
			{#each sortedEndnotes as endnote}
				<li class="endnote-item" id={endnote.id}>
					{endnote.content}
					<a href="#ref-{endnote.id}" class="endnote-backref">↩</a>
				</li>
			{/each}
		</ol>
	</div>
{/if}

<style>
	.endnotes {
		margin: 2rem 0;
		padding-top: 1rem;
		border-top: 2px solid #333;
	}

	.endnotes-title {
		font-size: 1.3rem;
		font-weight: bold;
		margin-bottom: 0.8rem;
	}

	.endnotes-list {
		padding-left: 2rem;
		font-size: 0.9rem;
		line-height: 1.6;
	}

	.endnote-item {
		margin-bottom: 0.8rem;
	}

	.endnote-backref {
		margin-left: 0.5em;
		text-decoration: none;
		color: #0066cc;
	}

	.endnote-backref:hover {
		text-decoration: underline;
	}
</style>
