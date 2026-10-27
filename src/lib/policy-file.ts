import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '@/lib/env';

export async function readPolicyHash(): Promise<string> {
  const policyPath = path.resolve(process.cwd(), env.POLICY_DIR, `${env.POLICY_VERSION}.json`);
  const policy = await readFile(policyPath);
  return `sha256:${createHash('sha256').update(policy).digest('hex')}`;
}
