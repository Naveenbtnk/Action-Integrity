import 'server-only';

import { z } from 'zod';

const BooleanString = z
  .enum(['0', '1', 'false', 'true'])
  .default('false')
  .transform((value) => value === '1' || value === 'true');

const PositiveInteger = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const OptionalUrl = z.string().url().optional().or(z.literal(''));

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_DATABASE_URL: z.string().min(1, 'DIRECT_DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must contain at least 32 characters'),
  AUTH_URL: OptionalUrl,
  AUTH_CREDENTIALS_ENABLED: BooleanString,
  OIDC_ISSUER: OptionalUrl,
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_ROLE_CLAIM: z.string().default('roles'),
  SESSION_COOKIE_NAME: z.string().default('aic_session'),
  GEMINI_API_KEY: z.string().min(1).optional().or(z.literal('')),
  GEMINI_MODEL: z.string().min(1, 'GEMINI_MODEL is required'),
  AGENT_SERVICE_KEY: z.string().min(32, 'AGENT_SERVICE_KEY must contain at least 32 characters'),
  AGENT_SERVICE_KEY_PREVIOUS: z.string().min(32).optional(),
  TARGET_SERVICE_KEY: z.string().min(32, 'TARGET_SERVICE_KEY must contain at least 32 characters'),
  TARGET_SERVICE_KEY_PREVIOUS: z.string().min(32).optional(),
  OPS_SERVICE_KEY: z.string().min(32, 'OPS_SERVICE_KEY must contain at least 32 characters'),
  OPS_SERVICE_KEY_PREVIOUS: z.string().min(32).optional(),
  REDIS_URL: OptionalUrl,
  AIC_BASE_URL: z.string().url('AIC_BASE_URL must be an absolute URL'),
  INVESTIGATION_MODE: z.enum(['agent', 'deterministic']),
  POLICY_DIR: z.string().default('config/policy'),
  POLICY_VERSION: z.string().default('2026.10.1'),
  APPROVAL_WINDOW_HOURS: PositiveInteger(12),
  HOLD_SLA_HOURS: PositiveInteger(4),
  RATE_LIMIT_INGEST_PER_MIN: PositiveInteger(120),
  EXECUTION_TIMEOUT_MS: PositiveInteger(120_000),
  TARGET_TIMEOUT_MS: PositiveInteger(10_000),
  OUTBOX_MAX_ATTEMPTS: PositiveInteger(8),
  OUTBOX_BATCH_SIZE: PositiveInteger(50),
  ALLOWED_ORIGINS: z.string().default(''),
  OTEL_EXPORTER_OTLP_ENDPOINT: OptionalUrl,
  OTEL_SERVICE_NAME: z.string().default('aic-web'),
  OTEL_SDK_DISABLED: z.enum(['0', '1']).default('0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  LOG_PRETTY: BooleanString,
  METRICS_ENDPOINT_ENABLED: z.enum(['0', '1']).default('0'),
  ANCHOR_STORE_ENDPOINT: OptionalUrl,
  ANCHOR_STORE_BUCKET: z.string().optional(),
  ANCHOR_STORE_ACCESS_KEY: z.string().optional(),
  ANCHOR_STORE_SECRET_KEY: z.string().optional(),
  ANCHOR_INTERVAL_MINUTES: PositiveInteger(60),
  SEED_PROFILE: z.enum(['demo', 'test']).default('demo'),
  SEED: z.string().default('20261026'),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(16).optional(),
  ALLOW_DB_RESET: BooleanString,
  ALLOW_DEMO_RESET: BooleanString,
  DEMO_DB_HOSTS: z.string().optional(),
  EVAL_MAX_CONCURRENCY: PositiveInteger(2),
  GIT_SHA: z.string().default('development'),
});

export type AppEnv = Readonly<z.infer<typeof EnvironmentSchema>>;

const PRODUCTION_REQUIRED = [
  'AUTH_URL',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'REDIS_URL',
  'ANCHOR_STORE_ENDPOINT',
  'ANCHOR_STORE_BUCKET',
  'ANCHOR_STORE_ACCESS_KEY',
  'ANCHOR_STORE_SECRET_KEY',
] as const;

export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  const result = EnvironmentSchema.safeParse(source);

  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
      .filter(Boolean)
      .sort();
    throw new Error(`Invalid environment configuration: ${names.join(', ')}`);
  }

  const parsed = result.data;
  if (parsed.NODE_ENV === 'production') {
    const missing = PRODUCTION_REQUIRED.filter((key) => !parsed[key]);
    const unsafe: string[] = [];

    if (parsed.AUTH_CREDENTIALS_ENABLED) unsafe.push('AUTH_CREDENTIALS_ENABLED');
    if (parsed.ALLOW_DB_RESET) unsafe.push('ALLOW_DB_RESET');
    if (parsed.ALLOW_DEMO_RESET) unsafe.push('ALLOW_DEMO_RESET');
    if (parsed.LOG_PRETTY) unsafe.push('LOG_PRETTY');
    if (parsed.OTEL_SDK_DISABLED === '1') unsafe.push('OTEL_SDK_DISABLED');

    if (missing.length > 0 || unsafe.length > 0) {
      const fields = [...missing, ...unsafe].sort();
      throw new Error(`Production environment rejected: ${fields.join(', ')}`);
    }
  }

  return Object.freeze(parsed);
}

export const env = parseEnv(process.env);
