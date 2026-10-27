import 'server-only';

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import { ServiceState, TargetEntitlementStatus } from '@/generated/prisma/enums';
import { takeFailureMode } from '@/lib/adapters/test-hooks';
import type {
  EntitlementState,
  RestorePointPayload,
  ServiceStateRecord,
  TargetChange,
  TargetRef,
  TargetWriteResult,
} from '@/lib/adapters/types';
import { db } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

export function stateHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function entitlement(
  row: {
    accountId: string;
    entitlementKey: string;
    status: TargetEntitlementStatus;
    grantedAt: Date;
    revokedAt: Date | null;
    sourceRef: string;
  } | null,
): EntitlementState | null {
  return (
    row && {
      accountId: row.accountId,
      key: row.entitlementKey,
      status: row.status,
      grantedAt: row.grantedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      sourceRef: row.sourceRef,
    }
  );
}
function status(
  row: { accountId: string; state: ServiceStateRecord['state']; reason: string } | null,
): ServiceStateRecord | null {
  return row && { accountId: row.accountId, state: row.state, reason: row.reason };
}

export async function getEntitlement(
  accountId: string,
  key: string,
): Promise<EntitlementState | null> {
  return entitlement(
    await db.tgtEntitlement.findUnique({
      where: { accountId_entitlementKey: { accountId, entitlementKey: key } },
    }),
  );
}
export async function getServiceStatus(accountId: string): Promise<ServiceStateRecord | null> {
  return status(await db.tgtServiceStatus.findUnique({ where: { accountId } }));
}
export async function captureRestorePoint(ref: TargetRef): Promise<RestorePointPayload> {
  const state =
    ref.targetObjectType === 'entitlement'
      ? await getEntitlement(ref.accountId, ref.key)
      : await getServiceStatus(ref.accountId);
  return { state, stateHash: stateHash(state), capturedAt: new Date().toISOString() };
}

type WriteOutput = { result: TargetWriteResult; auditId: string | null; beforeState: unknown };
type SavedWrite = {
  auditId: string;
  beforeState: EntitlementState | ServiceStateRecord;
  afterState: EntitlementState | ServiceStateRecord;
};

function replay(
  existing: {
    requestHash: string;
    resultStatus: string;
    afterState: Prisma.JsonValue;
    beforeState: Prisma.JsonValue;
    id: string;
  },
  requestHash: string,
): WriteOutput {
  if (existing.requestHash !== requestHash)
    throw new ConflictError('IDEMPOTENCY_CONFLICT', 'The key was used with a different payload.');
  const after = existing.afterState as { state: unknown };
  const before = existing.beforeState as { state: unknown };
  return {
    result: { status: existing.resultStatus as TargetWriteResult['status'], response: after.state },
    auditId: existing.id,
    beforeState: before.state,
  };
}

const EntitlementSnapshot = z
  .object({
    accountId: z.string(),
    key: z.string(),
    status: z.enum(TargetEntitlementStatus),
    grantedAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    sourceRef: z.string(),
  })
  .strict();
const ServiceSnapshot = z
  .object({ accountId: z.string(), state: z.enum(ServiceState), reason: z.string() })
  .strict();

async function write(
  ref: TargetRef,
  input: TargetChange | { snapshot: unknown },
  idempotencyKey: string,
  requestId: string,
): Promise<WriteOutput> {
  const requestHash = stateHash({ ref, input });
  const existing = await db.tgtAudit.findUnique({ where: { idempotencyKey } });
  if (existing) return replay(existing, requestHash);
  const mode = takeFailureMode();
  if (mode === 'before-commit')
    return {
      result: { status: 'FAILED', response: null, failureCode: 'INJECTED_BEFORE_COMMIT' },
      auditId: null,
      beforeState: null,
    };
  if (mode === 'timeout') await new Promise((resolve) => setTimeout(resolve, 11_000));
  if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 500));

  let saved: SavedWrite;
  try {
    saved = await db.$transaction(async (tx) => {
      const before =
        ref.targetObjectType === 'entitlement'
          ? entitlement(
              await tx.tgtEntitlement.findUnique({
                where: {
                  accountId_entitlementKey: { accountId: ref.accountId, entitlementKey: ref.key },
                },
              }),
            )
          : status(await tx.tgtServiceStatus.findUnique({ where: { accountId: ref.accountId } }));
      if (!before) throw new NotFoundError('Target object was not found.');

      let after: EntitlementState | ServiceStateRecord;
      if ('snapshot' in input) {
        const parsed = (
          ref.targetObjectType === 'entitlement' ? EntitlementSnapshot : ServiceSnapshot
        ).safeParse(input.snapshot);
        if (!parsed.success) throw new ValidationError('Invalid restore snapshot.');
        const record = parsed.data;
        if (
          record.accountId !== ref.accountId ||
          (ref.targetObjectType === 'entitlement' && 'key' in record && record.key !== ref.key)
        )
          throw new ValidationError('Snapshot does not match target.');
        if (ref.targetObjectType === 'entitlement') {
          const original = record as EntitlementState;
          const row = await tx.tgtEntitlement.update({
            where: {
              accountId_entitlementKey: { accountId: ref.accountId, entitlementKey: ref.key },
            },
            data: {
              status: original.status,
              grantedAt: new Date(original.grantedAt),
              revokedAt: original.revokedAt ? new Date(original.revokedAt) : null,
              sourceRef: original.sourceRef,
            },
          });
          after = entitlement(row)!;
        } else {
          const original = record as ServiceStateRecord;
          const row = await tx.tgtServiceStatus.update({
            where: { accountId: ref.accountId },
            data: { state: original.state, reason: original.reason },
          });
          after = status(row)!;
        }
      } else if (
        ref.targetObjectType === 'entitlement' &&
        input.targetObjectType === 'entitlement'
      ) {
        if (input.from && (before as EntitlementState).status !== input.from)
          throw new ConflictError('TARGET_STATE_CONFLICT', 'Target state changed.');
        const row = await tx.tgtEntitlement.update({
          where: {
            accountId_entitlementKey: { accountId: ref.accountId, entitlementKey: ref.key },
          },
          data: {
            status: input.to,
            revokedAt: input.to === TargetEntitlementStatus.REMOVED ? new Date() : null,
          },
        });
        after = entitlement(row)!;
      } else if (
        ref.targetObjectType === 'service-status' &&
        input.targetObjectType === 'service-status'
      ) {
        if (input.from && (before as ServiceStateRecord).state !== input.from)
          throw new ConflictError('TARGET_STATE_CONFLICT', 'Target state changed.');
        const row = await tx.tgtServiceStatus.update({
          where: { accountId: ref.accountId },
          data: { state: input.to, reason: 'Synthetic target change' },
        });
        after = status(row)!;
      } else throw new ValidationError('Target type does not match change.');

      const audit = await tx.tgtAudit.create({
        data: {
          at: new Date(),
          actor: 'SERVICE_TARGET',
          operation: 'snapshot' in input ? 'RESTORE' : 'CHANGE',
          resourceType: ref.targetObjectType,
          resourceRef:
            ref.targetObjectType === 'entitlement' ? `${ref.accountId}:${ref.key}` : ref.accountId,
          beforeState: { state: before } as Prisma.InputJsonObject,
          afterState: { state: after } as Prisma.InputJsonObject,
          idempotencyKey,
          requestHash,
          requestId,
          resultStatus: mode === 'after-commit' ? 'UNKNOWN' : 'SUCCEEDED',
        },
      });
      return { auditId: audit.id, beforeState: before, afterState: after };
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      const committed = await db.tgtAudit.findUnique({ where: { idempotencyKey } });
      if (committed) return replay(committed, requestHash);
    }
    throw cause;
  }
  return {
    result: {
      status: mode === 'after-commit' ? 'UNKNOWN' : 'SUCCEEDED',
      response: saved.afterState,
    },
    auditId: saved.auditId,
    beforeState: saved.beforeState,
  };
}

export async function applyChange(
  change: TargetChange,
  idempotencyKey: string,
  requestId: string,
): Promise<WriteOutput> {
  const ref: TargetRef =
    change.targetObjectType === 'entitlement'
      ? { targetObjectType: 'entitlement', accountId: change.accountId, key: change.key }
      : { targetObjectType: 'service-status', accountId: change.accountId };
  return write(ref, change, idempotencyKey, requestId);
}
export async function restoreFromSnapshot(
  ref: TargetRef,
  snapshot: unknown,
  idempotencyKey: string,
  requestId: string,
): Promise<WriteOutput> {
  return write(ref, { snapshot }, idempotencyKey, requestId);
}
