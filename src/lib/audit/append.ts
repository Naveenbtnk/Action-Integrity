import 'server-only';

import { createHash } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType, DegradationLevel } from '@/generated/prisma/enums';
import { canonicalJson } from '@/lib/canonical-json';
import { DegradationBlockedError } from '@/lib/errors';

export async function appendIntegrityDismissal(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    actorId: string;
    reasonHash: string;
    requestId: string;
    traceId?: string | undefined;
  },
): Promise<void> {
  const degradation = await tx.degradationState.findFirst({
    orderBy: { changedAt: 'desc' },
    select: { level: true },
  });
  if (degradation?.level === DegradationLevel.L4_AUDIT_BROKEN) throw new DegradationBlockedError();
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(81657232001) IS NULL AS locked`;
  const previous = await tx.auditEvent.findFirst({
    orderBy: { seq: 'desc' },
    select: { hash: true },
  });
  const sequence = await tx.$queryRaw<
    Array<{ seq: bigint }>
  >`SELECT nextval(pg_get_serial_sequence('audit_event', 'seq')) AS seq`;
  const seq = sequence[0]!.seq;
  const createdAt = new Date();
  const payload = { integrityEventId: input.eventId, reasonHash: input.reasonHash };
  const body = {
    eventType: 'INTEGRITY_DISMISSED',
    actorType: ActorType.USER,
    actorId: input.actorId,
    caseId: null,
    payload,
    createdAt: createdAt.toISOString(),
  };
  const hash = `sha256:${createHash('sha256')
    .update(`${previous?.hash ?? ''}|${seq}|${canonicalJson(body)}`)
    .digest('hex')}`;
  await tx.auditEvent.create({
    data: {
      seq,
      actorType: ActorType.USER,
      actorId: input.actorId,
      eventType: 'INTEGRITY_DISMISSED',
      payload,
      requestId: input.requestId,
      traceId: input.traceId ?? null,
      prevHash: previous?.hash ?? null,
      hash,
      createdAt,
    },
  });
}
