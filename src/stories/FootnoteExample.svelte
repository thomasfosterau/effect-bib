<script lang="ts">
	import { FootnoteManager, Footnote, FootnoteList } from '$lib';

	export let showMultiple = false;
</script>

<FootnoteManager>
	<div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem;">
		<h2>Document with Footnotes</h2>
		<p>
			This is a paragraph with a footnote<Footnote
				content="This is an example footnote explaining additional context."
			/>.
		</p>
		{#if showMultiple}
			<p>
				Another paragraph with another footnote<Footnote
					content="This footnote provides supplementary information."
				/>.
			</p>
			<p>
				And yet another with more details<Footnote
					content="Additional reference material can be found in the appendix."
				/>.
			</p>
		{/if}

		<FootnoteList title="Footnotes" />
	</div>
</FootnoteManager>
