import { Button } from '@/components/ui/button';

import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: 'Foundation/Button',
  component: Button,
  args: { children: 'Review evidence' },
  parameters: { backgrounds: { default: 'carbon' } },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'outline' } };
export const Disabled: Story = { args: { disabled: true } };
