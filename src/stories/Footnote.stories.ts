import type { Meta, StoryObj } from '@storybook/svelte';
import FootnoteExample from './FootnoteExample.svelte';

const meta = {
	title: 'Components/Footnotes',
	component: FootnoteExample,
	tags: ['autodocs']
} satisfies Meta<FootnoteExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {};

export const Multiple: Story = {
	args: {
		showMultiple: true
	}
};
