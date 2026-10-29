import 'dotenv/config';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:3000', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
