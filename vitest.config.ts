import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      'server-only': new URL('./src/test/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/test/unit/**/*.test.ts', 'src/test/envelope/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
