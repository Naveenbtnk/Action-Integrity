import 'server-only';

import Redis from 'ioredis';

import { env } from '@/lib/env';
import { AppError, RateLimitedError } from '@/lib/errors';

const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  : null;
const memory = new Map<string, { count: number; expires: number }>();

export async function enforceAdapterLimit(
  group: 'sources' | 'target-read' | 'target-write' | 'integrity' | 'read' | 'write',
  principal: string,
): Promise<void> {
  const limit =
    group === 'integrity' ? 6 : group === 'target-write' || group === 'write' ? 60 : 300;
  const windowMs = 60_000;
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `aic:limit:${group}:${principal}:${bucket}`;
  let count: number;
  try {
    if (redis) {
      count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, windowMs + 1000);
    } else if (env.NODE_ENV !== 'production') {
      const prior = memory.get(key);
      count = prior && prior.expires > Date.now() ? prior.count + 1 : 1;
      memory.set(key, { count, expires: (bucket + 1) * windowMs });
    } else throw new Error('Redis missing');
  } catch {
    throw new AppError('RATE_LIMITER_UNAVAILABLE', 503, 'Rate limiter unavailable.');
  }
  if (count > limit)
    throw new RateLimitedError({
      retryAfter: Math.ceil(((bucket + 1) * windowMs - Date.now()) / 1000),
    });
}
