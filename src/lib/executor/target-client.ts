import 'server-only';

import { TargetHttpClient } from '@/lib/adapters/target/http-client';
import type { TargetAdapter } from '@/lib/adapters/types';
import { env } from '@/lib/env';

export function createTargetClient(): TargetHttpClient {
  return new TargetHttpClient({
    baseUrl: env.AIC_BASE_URL,
    serviceKey: env.TARGET_SERVICE_KEY,
    timeoutMs: env.TARGET_TIMEOUT_MS,
  });
}

export type TargetReader = Pick<TargetAdapter, 'getEntitlement' | 'getServiceStatus'>;

export function createTargetReader(): TargetReader {
  const client = createTargetClient();
  return {
    getEntitlement: (accountId, key) => client.getEntitlement(accountId, key),
    getServiceStatus: (accountId) => client.getServiceStatus(accountId),
  };
}
