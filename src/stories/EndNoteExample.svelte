<script lang="ts">
	import { FootnoteManager, EndNote, EndNoteList } from '$lib';

	export let showMultiple = false;
</script>

<FootnoteManager>
	<div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem;">
		<h2>Document with Endnotes</h2>
		<p>
			This is a paragraph with an endnote<EndNote
				content="This is an example endnote that will appear at the end of the document."
			/>.
		</p>
		{#if showMultiple}
			<p>
				Another paragraph with another endnote<EndNote
					content="This endnote provides supplementary information."
				/>.
			</p>
			<p>
				And yet another with more details<EndNote
					content="Additional reference material can be found in the appendix."
				/>.
			</p>
		{/if}

		<EndNoteList title="Endnotes" />
	</div>
</FootnoteManager>
