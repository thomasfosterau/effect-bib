<script lang="ts">
	import { SideNote } from '$lib';

	export let position: 'left' | 'right' = 'right';
</script>

<div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem; padding: 0 300px;">
	<h2>Document with Side Notes</h2>
	<p>
		This paragraph has a side note
		<SideNote {position} content="This is a side note that appears in the margin." />
		that provides additional context without interrupting the flow of text. Hover over the marker to see
		the note (or view it in the margin on large screens).
	</p>
	<p>
		Side notes are useful for providing supplementary information
		<SideNote {position} content="For example, you might want to cite a source or provide a definition here." />
		without cluttering the main text.
	</p>
</div>
