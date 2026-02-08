<script lang="ts">
	export let content: string = '';
	export let position: 'left' | 'right' = 'right';
</script>

<span class="sidenote-wrapper">
	<slot name="marker">
		<sup class="sidenote-marker">*</sup>
	</slot>
	<span class="sidenote" class:left={position === 'left'} class:right={position === 'right'}>
		{content}
		<slot />
	</span>
</span>

<style>
	.sidenote-wrapper {
		position: relative;
	}

	.sidenote-marker {
		font-size: 0.8em;
		margin-left: 0.1em;
		color: #0066cc;
		cursor: help;
	}

	.sidenote {
		display: none;
		position: absolute;
		width: 200px;
		padding: 0.5rem;
		background: #f9f9f9;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 0.85rem;
		line-height: 1.4;
		z-index: 100;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.sidenote.right {
		left: calc(100% + 1rem);
		top: 0;
	}

	.sidenote.left {
		right: calc(100% + 1rem);
		top: 0;
	}

	.sidenote-wrapper:hover .sidenote {
		display: block;
	}

	/* For large screens, show as margin notes */
	@media (min-width: 1200px) {
		.sidenote {
			display: block;
			position: absolute;
		}
	}

	/* For smaller screens, show on hover/focus */
	@media (max-width: 1199px) {
		.sidenote {
			display: none;
			position: fixed;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%);
			width: 80%;
			max-width: 400px;
		}

		.sidenote-wrapper:hover .sidenote,
		.sidenote-wrapper:focus-within .sidenote {
			display: block;
		}
	}
</style>
