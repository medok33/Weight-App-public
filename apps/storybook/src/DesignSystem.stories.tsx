import type { Meta, StoryObj } from '@storybook/react';
import { Button, Card, Input } from '@weight-app/ui/src/components/index.js';
const meta = { title: 'Design System/Primitives', parameters: { layout: 'centered' } } satisfies Meta;
export default meta;
export const Form: StoryObj = { render: () => <Card><Input aria-label="Email" placeholder="you@example.com" /><Button>Continue</Button></Card> };
