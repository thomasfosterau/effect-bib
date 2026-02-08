import type { Meta, StoryObj } from '@storybook/svelte';
import Citation from '../lib/Citation.svelte';
import ReferenceManager from '../lib/ReferenceManager.svelte';

const meta = {
	title: 'Components/Citation',
	component: Citation,
	tags: ['autodocs'],
	decorators: [(story) => {
		return {
			Component: ReferenceManager,
			props: {
				style: 'apa'
			},
			slot: story
		};
	}]
} satisfies Meta<Citation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSource: Story = {
	args: {
		source: {
			id: 'smith2020',
			type: 'article',
			title: 'The Future of Web Development',
			author: 'Smith, J.',
			year: 2020,
			journal: 'Web Development Today',
			volume: '15',
			issue: '3',
			pages: '45-67'
		}
	}
};

export const WithSourceId: Story = {
	args: {
		sourceId: 'jones2019'
	}
};

export const WithPageNumber: Story = {
	args: {
		source: {
			id: 'doe2021',
			type: 'website',
			title: 'Understanding Component Libraries',
			author: 'Doe, J.',
			year: 2021,
			url: 'https://example.com/component-libraries'
		},
		page: 42
	}
};

export const APAStyle: Story = {
	args: {
		source: {
			id: 'smith2020apa',
			type: 'article',
			title: 'APA Citation Style',
			author: 'Smith, J.',
			year: 2020
		}
	}
};

export const MLAStyle: Story = {
	args: {
		source: {
			id: 'smith2020mla',
			type: 'article',
			title: 'MLA Citation Style',
			author: 'Smith, J.',
			year: 2020
		}
	},
	decorators: [(story) => {
		return {
			Component: ReferenceManager,
			props: {
				style: 'mla'
			},
			slot: story
		};
	}]
};

export const IEEEStyle: Story = {
	args: {
		source: {
			id: 'smith2020ieee',
			type: 'article',
			title: 'IEEE Citation Style',
			author: 'Smith, J.',
			year: 2020
		}
	},
	decorators: [(story) => {
		return {
			Component: ReferenceManager,
			props: {
				style: 'ieee'
			},
			slot: story
		};
	}]
};
