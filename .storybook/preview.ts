import type { Preview } from '@storybook/nextjs-vite';

import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    a11y: { test: 'error' },
    backgrounds: { default: 'carbon' },
    layout: 'centered',
  },
};

export default preview;
