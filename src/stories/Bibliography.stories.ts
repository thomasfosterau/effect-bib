import type { Meta, StoryObj } from '@storybook/svelte';
import BibliographyExample from './BibliographyExample.svelte';

const meta = {
	title: 'Components/Bibliography',
	component: BibliographyExample,
	tags: ['autodocs']
} satisfies Meta<BibliographyExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const APAStyle: Story = {
	args: {
		style: 'apa'
	}
};

export const MLAStyle: Story = {
	args: {
		style: 'mla'
	}
};

export const ChicagoStyle: Story = {
	args: {
		style: 'chicago'
	}
};

export const IEEEStyle: Story = {
	args: {
		style: 'ieee'
	}
};

export const VancouverStyle: Story = {
	args: {
		style: 'vancouver'
	}
};

export const HarvardStyle: Story = {
	args: {
		style: 'harvard'
	}
};
