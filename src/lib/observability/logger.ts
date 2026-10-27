import 'server-only';

import pino from 'pino';

import { env } from '@/lib/env';

const redact = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  'x-agent-key',
  'x-target-key',
  'x-ops-key',
  'password',
  'token',
  'secret',
  'apiKey',
  'excerpt',
  'body',
  'rationale',
  'prompt',
  'response.text',
];

const transport =
  env.LOG_PRETTY && env.NODE_ENV === 'development'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, singleLine: true } })
    : undefined;

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: {
      env: env.NODE_ENV,
      service: env.OTEL_SERVICE_NAME,
      version: env.GIT_SHA,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: redact, censor: '[REDACTED]' },
  },
  transport,
);
