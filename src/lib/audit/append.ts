import 'server-only';

import { createHash } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType, DegradationLevel } from '@/generated/prisma/enums';
import { canonicalJson } from '@/lib/canonical-json';
import { DegradationBlockedError } from '@/lib/errors';

export async function appendAuditEvent(
  tx: Prisma.TransactionClient,
  input: {
    eventType: string;
    actorType: ActorType;
    actorId?: string | null;
    caseId?: string | null;
    payload: Prisma.InputJsonValue;
    requestId: string;
    traceId?: string | undefined;
    policyVersion?: string | undefined;
    policyHash?: string | undefined;
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
  const first = sequence[0];
  if (!first) throw new Error('Audit sequence unavailable.');
  const seq = first.seq;
  const createdAt = new Date();
  const body = {
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    caseId: input.caseId ?? null,
    payload: input.payload,
    createdAt: createdAt.toISOString(),
  };
  const hash = `sha256:${createHash('sha256')
    .update(`${previous?.hash ?? ''}|${seq}|${canonicalJson(body)}`)
    .digest('hex')}`;
  await tx.auditEvent.create({
    data: {
      seq,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      caseId: input.caseId ?? null,
      eventType: input.eventType,
      payload: input.payload,
      requestId: input.requestId,
      traceId: input.traceId ?? null,
      policyVersion: input.policyVersion ?? null,
      policyHash: input.policyHash ?? null,
      prevHash: previous?.hash ?? null,
      hash,
      createdAt,
    },
  });
}

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
  return appendAuditEvent(tx, {
    eventType: 'INTEGRITY_DISMISSED',
    actorType: ActorType.USER,
    actorId: input.actorId,
    payload: { integrityEventId: input.eventId, reasonHash: input.reasonHash },
    requestId: input.requestId,
    traceId: input.traceId,
  });
}
