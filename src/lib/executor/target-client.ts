import 'server-only';

import { TargetHttpClient } from '@/lib/adapters/target/http-client';
import { env } from '@/lib/env';

export function createTargetClient(): TargetHttpClient {
  return new TargetHttpClient({
    baseUrl: env.AIC_BASE_URL,
    serviceKey: env.TARGET_SERVICE_KEY,
    timeoutMs: env.TARGET_TIMEOUT_MS,
  });
}
