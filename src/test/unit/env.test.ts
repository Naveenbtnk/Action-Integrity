import { describe, expect, it } from 'vitest';

import { parseEnv } from '@/lib/env';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  DIRECT_DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  AUTH_SECRET: 'test-secret-with-more-than-32-characters',
  AUTH_CREDENTIALS_ENABLED: 'false',
  GEMINI_API_KEY: 'test-key',
  GEMINI_MODEL: 'test-model',
  AGENT_SERVICE_KEY: 'test-agent-key-with-more-than-32-characters',
  TARGET_SERVICE_KEY: 'test-target-key-with-more-than-32-characters',
  OPS_SERVICE_KEY: 'test-ops-key-with-more-than-32-characters',
  AIC_BASE_URL: 'http://localhost:3000',
  INVESTIGATION_MODE: 'deterministic',
  OTEL_SDK_DISABLED: '1',
  LOG_PRETTY: 'false',
  ALLOW_DB_RESET: 'false',
  ALLOW_DEMO_RESET: 'false',
} satisfies NodeJS.ProcessEnv;

describe('environment validation', () => {
  it('names a missing key without revealing values', () => {
    const missingDatabase: NodeJS.ProcessEnv = { ...valid };
    delete missingDatabase.DATABASE_URL;
    expect(() => parseEnv(missingDatabase)).toThrow('DATABASE_URL');
  });

  it('rejects local credentials in production', () => {
    expect(() =>
      parseEnv({
        ...valid,
        NODE_ENV: 'production',
        AUTH_CREDENTIALS_ENABLED: 'true',
        AUTH_URL: 'https://example.com',
        PUBLIC_SITE_URL: 'https://www.example.com',
        OIDC_ISSUER: 'https://id.example.com',
        OIDC_CLIENT_ID: 'client',
        OIDC_CLIENT_SECRET: 'secret',
        REDIS_URL: 'redis://localhost:6379',
        ANCHOR_STORE_ENDPOINT: 'https://objects.example.com',
        ANCHOR_STORE_BUCKET: 'anchors',
        ANCHOR_STORE_ACCESS_KEY: 'access',
        ANCHOR_STORE_SECRET_KEY: 'secret',
        OTEL_SDK_DISABLED: '0',
      }),
    ).toThrow('AUTH_CREDENTIALS_ENABLED');
  });

  it('requires an HTTPS public site origin in production', () => {
    expect(() =>
      parseEnv({
        ...valid,
        NODE_ENV: 'production',
        AUTH_URL: 'https://console.example.com',
        PUBLIC_SITE_URL: 'http://www.example.com',
        OIDC_ISSUER: 'https://id.example.com',
        OIDC_CLIENT_ID: 'client',
        OIDC_CLIENT_SECRET: 'secret',
        REDIS_URL: 'redis://localhost:6379',
        ANCHOR_STORE_ENDPOINT: 'https://objects.example.com',
        ANCHOR_STORE_BUCKET: 'anchors',
        ANCHOR_STORE_ACCESS_KEY: 'access',
        ANCHOR_STORE_SECRET_KEY: 'secret',
        OTEL_SDK_DISABLED: '0',
      }),
    ).toThrow('PUBLIC_SITE_URL');
  });
});
