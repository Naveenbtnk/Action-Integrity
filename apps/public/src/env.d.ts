/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_CONSOLE_URL?: string;
  readonly PUBLIC_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
