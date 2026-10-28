import { createHash } from 'node:crypto';

import { canonicalJson } from '@/lib/canonical-json';

export function sha(value: string | unknown): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : canonicalJson(value))
    .digest('hex');
}
