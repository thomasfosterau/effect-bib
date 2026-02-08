import type { Meta, StoryObj } from '@storybook/svelte';
import SideNoteExample from './SideNoteExample.svelte';

const meta = {
	title: 'Components/SideNote',
	component: SideNoteExample,
	tags: ['autodocs']
} satisfies Meta<SideNoteExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RightSide: Story = {
	args: {
		position: 'right'
	}
};

export const LeftSide: Story = {
	args: {
		position: 'left'
	}
};
