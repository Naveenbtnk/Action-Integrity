import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { TargetAdapter, TargetRef } from '@/lib/adapters/types';
import { AppError } from '@/lib/errors';

import { objectRef } from './action';

export async function captureRestorePoint(client: TargetAdapter, ref: TargetRef) {
  try {
    const snapshot = await client.captureRestorePoint(ref);
    if (!snapshot.state) throw new Error('Target object is missing.');
    return snapshot;
  } catch {
    throw new AppError('TARGET_UNAVAILABLE', 502, 'Target state could not be captured.');
  }
}

export async function persistRestorePoint(
  tx: Prisma.TransactionClient,
  input: {
    outboundActionId?: string;
    ref: TargetRef;
    snapshot: Awaited<ReturnType<typeof captureRestorePoint>>;
  },
) {
  return tx.restorePoint.create({
    data: {
      outboundActionId: input.outboundActionId ?? null,
      targetObjectType: input.ref.targetObjectType,
      targetObjectRef: objectRef(input.ref),
      state: input.snapshot.state as Prisma.InputJsonValue,
      stateHash: input.snapshot.stateHash,
      capturedAt: new Date(input.snapshot.capturedAt),
    },
  });
}
