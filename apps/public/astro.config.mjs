import { defineConfig } from 'astro/config';

if (process.env.VERCEL) {
  const consoleUrl = process.env.PUBLIC_CONSOLE_URL;
  if (!consoleUrl || new URL(consoleUrl).protocol !== 'https:') {
    throw new Error('PUBLIC_CONSOLE_URL must be an HTTPS console sign-in URL on Vercel.');
  }
}

export default defineConfig({
  output: 'static',
  build: { format: 'directory' },
});
