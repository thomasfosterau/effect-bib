<script lang="ts">
	import {
		ReferenceManager,
		Citation,
		Bibliography,
		FootnoteManager,
		Footnote,
		FootnoteList,
		EndNote,
		EndNoteList,
		SideNote,
		type Source
	} from '$lib';

	// Sample sources
	const source1: Source = {
		id: 'smith2020',
		type: 'article',
		title: 'The Future of Web Development',
		author: 'Smith, J.',
		year: 2020,
		journal: 'Web Development Today',
		volume: '15',
		issue: '3',
		pages: '45-67',
		doi: '10.1234/wdt.2020.123'
	};

	const source2: Source = {
		id: 'jones2019',
		type: 'book',
		title: 'Modern JavaScript Frameworks',
		author: ['Jones, A.', 'Brown, B.'],
		year: 2019,
		publisher: 'Tech Books Publishing'
	};

	const source3: Source = {
		id: 'doe2021',
		type: 'website',
		title: 'Understanding Component Libraries',
		author: 'Doe, J.',
		year: 2021,
		url: 'https://example.com/component-libraries',
		accessed: 'January 15, 2023'
	};
</script>

<ReferenceManager style="apa">
	<FootnoteManager>
		<main>
			<h1>Reference Manager Demo</h1>

			<section>
				<h2>Citations Example</h2>
				<p>
					This is a demonstration of the reference manager library. According to recent research
					<Citation source={source1} />, web development is rapidly evolving. Multiple frameworks have been
					developed <Citation source={source2} /> to help developers build better applications.

					For more information, see the comprehensive guide <Citation source={source3} />.
				</p>

				<p>
					You can also cite the same source multiple times <Citation sourceId="smith2020" /> and with
					page numbers <Citation sourceId="smith2020" page={52} />.
				</p>
			</section>

			<section>
				<h2>Footnotes Example</h2>
				<p>
					This is a paragraph with a footnote<Footnote
						content="This is an example footnote explaining additional context."
					/>.
				</p>
				<p>
					Another paragraph with another footnote<Footnote
						content="This footnote provides supplementary information."
					/>.
				</p>
			</section>

			<section>
				<h2>Side Notes Example</h2>
				<p>
					This paragraph has a side note
					<SideNote content="This is a side note that appears in the margin." />
					that provides additional context without interrupting the flow.
				</p>
			</section>

			<section>
				<h2>Endnotes Example</h2>
				<p>
					This section demonstrates endnotes<EndNote
						content="This is an endnote that will appear at the end of the document."
					/>.
				</p>
				<p>
					Another sentence with an endnote<EndNote
						content="Another endnote with additional information."
					/>.
				</p>
			</section>

			<FootnoteList title="Footnotes" />

			<Bibliography title="References" />

			<EndNoteList title="Endnotes" />
		</main>
	</FootnoteManager>
</ReferenceManager>

<style>
	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
			sans-serif;
		line-height: 1.6;
	}

	h1 {
		font-size: 2rem;
		margin-bottom: 2rem;
		color: #333;
	}

	h2 {
		font-size: 1.5rem;
		margin-top: 2rem;
		margin-bottom: 1rem;
		color: #555;
	}

	section {
		margin-bottom: 2rem;
	}

	p {
		margin-bottom: 1rem;
	}
</style>
