import type { Meta, StoryObj } from '@storybook/svelte';
import EndNoteExample from './EndNoteExample.svelte';

const meta = {
	title: 'Components/EndNote',
	component: EndNoteExample,
	tags: ['autodocs']
} satisfies Meta<EndNoteExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {};

export const Multiple: Story = {
	args: {
		showMultiple: true
	}
};
