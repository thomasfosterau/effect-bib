<script lang="ts">
	import { ReferenceManager, Citation, Bibliography, type CitationStyle } from '$lib';

	export let style: CitationStyle = 'apa';

	const sources = [
		{
			id: 'smith2020',
			type: 'article' as const,
			title: 'The Future of Web Development',
			author: 'Smith, J.',
			year: 2020,
			journal: 'Web Development Today',
			volume: '15',
			issue: '3',
			pages: '45-67',
			doi: '10.1234/wdt.2020.123'
		},
		{
			id: 'jones2019',
			type: 'book' as const,
			title: 'Modern JavaScript Frameworks',
			author: ['Jones, A.', 'Brown, B.'],
			year: 2019,
			publisher: 'Tech Books Publishing'
		},
		{
			id: 'doe2021',
			type: 'website' as const,
			title: 'Understanding Component Libraries',
			author: 'Doe, J.',
			year: 2021,
			url: 'https://example.com/component-libraries',
			accessed: 'January 15, 2023'
		}
	];
</script>

<ReferenceManager {style}>
	<div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem;">
		<h2>Research Paper Example</h2>
		<p>
			This paragraph contains inline citations. According to recent research
			<Citation source={sources[0]} />, web development is rapidly evolving. Multiple frameworks have been
			developed <Citation source={sources[1]} /> to help developers build better applications.
		</p>
		<p>
			For more information, see the comprehensive guide <Citation source={sources[2]} />.
			We can also cite sources with page numbers <Citation sourceId="smith2020" page={52} />.
		</p>
		
		<Bibliography title="References" />
	</div>
</ReferenceManager>
