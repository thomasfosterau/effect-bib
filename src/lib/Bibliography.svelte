<script lang="ts">
	import { getContext } from 'svelte';
	import type { ReferenceManagerContext } from './types';
	import { formatBibliographyEntry } from './formatters';

	export let title: string = 'References';
	export let numbered: boolean = false;

	const context = getContext<ReferenceManagerContext>('referenceManager');

	$: sortedSources = context?.getSortedSources() || [];
	$: isNumbered = numbered || context?.style === 'ieee' || context?.style === 'vancouver';
</script>

{#if context}
	<div class="bibliography">
		<h2 class="bibliography-title">{title}</h2>
		<ol class="bibliography-list" class:numbered={isNumbered} class:unnumbered={!isNumbered}>
			{#each sortedSources as source, index}
				<li class="bibliography-entry">
					{@html formatBibliographyEntry(
						source,
						context.style,
						isNumbered ? context.getCitationNumber(source.id) : undefined
					)}
				</li>
			{/each}
		</ol>
	</div>
{:else}
	<p>Bibliography must be used within a ReferenceManager</p>
{/if}

<style>
	.bibliography {
		margin: 2rem 0;
	}

	.bibliography-title {
		font-size: 1.5rem;
		font-weight: bold;
		margin-bottom: 1rem;
		border-bottom: 2px solid #333;
		padding-bottom: 0.5rem;
	}

	.bibliography-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.bibliography-list.numbered {
		list-style: decimal;
		padding-left: 2rem;
	}

	.bibliography-list.unnumbered {
		list-style: none;
		padding-left: 0;
	}

	.bibliography-entry {
		margin-bottom: 1rem;
		line-height: 1.6;
		text-indent: -2rem;
		padding-left: 2rem;
	}

	.bibliography-list.numbered .bibliography-entry {
		text-indent: 0;
		padding-left: 0;
	}
</style>
