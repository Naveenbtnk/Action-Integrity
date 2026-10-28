import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { TargetEntitlementStatus } from '@/generated/prisma/enums';
import { getSource, sourceSchemaFields } from '@/lib/adapters/registry';
import { setFailureMode } from '@/lib/adapters/test-hooks';
import type { SourceKey } from '@/lib/adapters/types';
import { db } from '@/lib/db';
import * as target from '@/lib/target/service';
import { runIntegrityTests } from '@/test/integration/integrity.test';

const requested = new Set(process.argv.slice(2));
const shouldRun = (name: string) => requested.size === 0 || requested.has(name);
const keys: SourceKey[] = ['contract', 'billing', 'usage', 'support', 'account'];

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)],
      ),
    )
  ).flat();
}

async function run(): Promise<void> {
  if (requested.has('evaluate') || requested.has('dismiss') || requested.has('evaluate-all'))
    await runIntegrityTests(requested);
  if (shouldRun('adapters')) {
    for (const key of keys) {
      const source = getSource(key);
      const first =
        key === 'contract'
          ? await db.srcContractEntitlement.findFirstOrThrow()
          : key === 'billing'
            ? await db.srcBillingSubscription.findFirstOrThrow()
            : key === 'usage'
              ? await db.srcUsageEventDaily.findFirstOrThrow()
              : key === 'support'
                ? await db.srcSupportTicket.findFirstOrThrow()
                : await db.srcAccountRegistry.findFirstOrThrow();
      const before = await source.describe();
      const records = await source.fetchRecords({ accountId: first.accountId, limit: 1 });
      const after = await source.describe();
      assert.equal(records.length, 1, `${key} should return one source row`);
      assert.deepEqual(
        Object.keys(records[0]!).sort(),
        Object.keys(sourceSchemaFields[key]).sort(),
      );
      assert.equal(before.rowCount, after.rowCount, `${key} read must not mutate rows`);
      assert.equal(before.schemaHash, after.schemaHash);
    }
    process.stdout.write('adapters: passed\n');
  }

  if (shouldRun('target') || shouldRun('failure')) {
    const row = await db.tgtEntitlement.findFirstOrThrow({ orderBy: { accountId: 'asc' } });
    const ref = {
      targetObjectType: 'entitlement' as const,
      accountId: row.accountId,
      key: row.entitlementKey,
    };
    const captured = await target.captureRestorePoint(ref);
    const alternative =
      row.status === TargetEntitlementStatus.SUSPENDED
        ? TargetEntitlementStatus.ACTIVE
        : TargetEntitlementStatus.SUSPENDED;
    const change = { ...ref, to: alternative };
    const changeKey = `test_${randomUUID()}`;
    const restoreKey = `test_${randomUUID()}`;
    try {
      if (shouldRun('failure')) {
        setFailureMode('before-commit');
        const failed = await target.applyChange(
          change,
          `test_${randomUUID()}`,
          'test-before-commit',
        );
        assert.equal(failed.result.status, 'FAILED');
        assert.equal((await target.captureRestorePoint(ref)).stateHash, captured.stateHash);
        setFailureMode('after-commit');
      }
      const applied = await target.applyChange(change, changeKey, 'test-request-id');
      assert.equal(applied.result.status, shouldRun('failure') ? 'UNKNOWN' : 'SUCCEEDED');
      assert.equal((await target.getEntitlement(ref.accountId, ref.key))?.status, alternative);
      const replay = await target.applyChange(change, changeKey, 'different-request-id');
      assert.deepEqual(replay, applied);
      assert.equal(await db.tgtAudit.count({ where: { idempotencyKey: changeKey } }), 1);
      const audit = await db.tgtAudit.findUniqueOrThrow({ where: { idempotencyKey: changeKey } });
      assert.equal(audit.requestId, 'test-request-id');
      assert.equal((audit.beforeState as { state: unknown }).state !== null, true);
      assert.equal((audit.afterState as { state: unknown }).state !== null, true);
      if (!shouldRun('failure')) {
        const concurrentKey = `test_${randomUUID()}`;
        const concurrent = await Promise.all([
          target.applyChange(change, concurrentKey, 'concurrent-one'),
          target.applyChange(change, concurrentKey, 'concurrent-two'),
        ]);
        assert.equal(concurrent[0]?.auditId, concurrent[1]?.auditId);
        assert.equal(await db.tgtAudit.count({ where: { idempotencyKey: concurrentKey } }), 1);
      }
      process.stdout.write(`${shouldRun('failure') ? 'failure' : 'target'}: passed\n`);
    } finally {
      if ((await target.captureRestorePoint(ref)).stateHash !== captured.stateHash) {
        const restored = await target.restoreFromSnapshot(
          ref,
          captured.state,
          restoreKey,
          'test-restore-id',
        );
        assert.equal(restored.result.status, 'SUCCEEDED');
      }
      assert.equal((await target.captureRestorePoint(ref)).stateHash, captured.stateHash);
    }
  }

  const codeFiles = (await files(path.resolve('src'))).filter(
    (file) =>
      /\.tsx?$/.test(file) &&
      !file.includes(`${path.sep}test${path.sep}`) &&
      !file.includes(`${path.sep}generated${path.sep}`),
  );
  for (const file of codeFiles) {
    const source = await readFile(file, 'utf8');
    if (file.includes(`${path.sep}lib${path.sep}integrity${path.sep}`)) {
      assert.ok(
        !/from ['"]@\/lib\/(db|agent|adapters)(?:\/|['"])/.test(source),
        `pure integrity import violation: ${file}`,
      );
    }
    if (
      /\.tgt(?:Account|Entitlement|ServiceStatus|Audit)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\b/.test(
        source,
      )
    ) {
      assert.ok(
        file.endsWith(path.join('lib', 'target', 'service.ts')),
        `target write outside service: ${file}`,
      );
    }
    if (/import\s*\{[^}]*TargetHttpClient[^}]*\}\s*from/.test(source)) {
      assert.ok(
        file.endsWith(path.join('lib', 'executor', 'target-client.ts')),
        `target client imported outside executor: ${file}`,
      );
    }
  }
  process.stdout.write('target boundary scan: passed\n');
}

try {
  await run();
} finally {
  await db.$disconnect();
}
