import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { reconcileExecutions } from '@/lib/executor/reconcile';

const args = new Set(process.argv.slice(2));
const result = await reconcileExecutions({
  requestId: `reconcile_${randomUUID()}`,
  dryRun: args.has('--dry-run'),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
