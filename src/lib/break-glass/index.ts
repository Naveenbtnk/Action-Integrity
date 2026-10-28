import 'server-only';

import { metrics } from '@opentelemetry/api';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType, BreakGlassStatus, CaseStatus, Role } from '@/generated/prisma/enums';
import { recordApproval } from '@/lib/approval';
import { appendAuditEvent } from '@/lib/audit/append';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { enqueue } from '@/lib/outbox/enqueue';

type AdminActor = { id: string; roles: Role[]; requestId: string; traceId?: string };
const transitions = metrics.getMeter('aic-web').createCounter('aic_break_glass_total');

export async function expireElevations(tx: Prisma.TransactionClient, requestId: string) {
  const now = new Date();
  const rows = await tx.breakGlassElevation.findMany({
    where: {
      OR: [
        { status: BreakGlassStatus.PENDING_COSIGN, cosignExpiresAt: { lte: now } },
        { status: BreakGlassStatus.PENDING_COSIGN, expiresAt: { lte: now } },
        { status: BreakGlassStatus.ACTIVE, expiresAt: { lte: now } },
      ],
    },
  });
  for (const row of rows) {
    const status =
      row.status === BreakGlassStatus.PENDING_COSIGN
        ? BreakGlassStatus.DENIED
        : BreakGlassStatus.EXPIRED;
    const changed = await tx.breakGlassElevation.updateMany({
      where: { id: row.id, status: row.status },
      data: { status },
    });
    if (!changed.count) continue;
    await tx.approval.updateMany({
      where: { elevationId: row.id, status: 'VALID' },
      data: { status: 'EXPIRED' },
    });
    await appendAuditEvent(tx, {
      eventType: 'BREAK_GLASS_EXPIRED',
      actorType: ActorType.SYSTEM,
      caseId: row.caseId,
      payload: { elevationId: row.id, status },
      requestId,
    });
    transitions.add(1, { state: status });
  }
  return rows.length;
}

export async function requestElevation(
  tx: Prisma.TransactionClient,
  input: { caseRef: string; reason: string; ttlMinutes: number; actor: AdminActor },
) {
  if (!input.actor.roles.includes(Role.ADMIN))
    throw new AppError('FORBIDDEN', 403, 'Administrator role required.');
  if (input.reason.trim().length < 50)
    throw new ValidationError('Reason must contain at least 50 characters.');
  if (!Number.isInteger(input.ttlMinutes) || input.ttlMinutes < 1 || input.ttlMinutes > 60)
    throw new ValidationError('TTL must be between 1 and 60 minutes.');
  const caseRow = await tx.case.findUnique({ where: { ref: input.caseRef } });
  if (!caseRow) throw new NotFoundError('Case not found.');
  if (caseRow.status !== CaseStatus.AWAITING_APPROVAL)
    throw new ConflictError('INVALID_TRANSITION');
  await expireElevations(tx, input.actor.requestId);
  const investigated = await tx.auditEvent.findFirst({
    where: { caseId: caseRow.id, actorId: input.actor.id, eventType: 'INVESTIGATION_COMPLETED' },
  });
  if (investigated) throw new ConflictError('BREAK_GLASS_INVESTIGATOR_CONFLICT');
  const active = await tx.breakGlassElevation.findFirst({
    where: {
      requestedById: input.actor.id,
      status: { in: [BreakGlassStatus.PENDING_COSIGN, BreakGlassStatus.ACTIVE] },
      expiresAt: { gt: new Date() },
    },
  });
  if (active) throw new ConflictError('BREAK_GLASS_ALREADY_ACTIVE');
  const now = new Date();
  const row = await tx.breakGlassElevation.create({
    data: {
      caseId: caseRow.id,
      caseRef: caseRow.ref,
      requestedById: input.actor.id,
      status: BreakGlassStatus.PENDING_COSIGN,
      reason: input.reason,
      cosignExpiresAt: new Date(now.getTime() + 15 * 60_000),
      expiresAt: new Date(now.getTime() + input.ttlMinutes * 60_000),
      createdAt: now,
    },
  });
  await appendAuditEvent(tx, {
    eventType: 'BREAK_GLASS_REQUESTED',
    actorType: ActorType.USER,
    actorId: input.actor.id,
    caseId: caseRow.id,
    payload: { elevationId: row.id, ttlMinutes: input.ttlMinutes },
    requestId: input.actor.requestId,
    traceId: input.actor.traceId,
  });
  transitions.add(1, { state: BreakGlassStatus.PENDING_COSIGN });
  return row;
}

export async function cosignElevation(
  tx: Prisma.TransactionClient,
  elevationId: string,
  actor: AdminActor,
) {
  if (!actor.roles.includes(Role.ADMIN))
    throw new AppError('FORBIDDEN', 403, 'Administrator role required.');
  await tx.$queryRaw`SELECT id FROM "break_glass_elevation" WHERE id = ${elevationId} FOR UPDATE`;
  const row = await tx.breakGlassElevation.findUnique({ where: { id: elevationId } });
  if (!row) throw new NotFoundError('Elevation not found.');
  if (row.requestedById === actor.id) throw new ConflictError('BREAK_GLASS_SELF_COSIGN');
  if (row.status !== BreakGlassStatus.PENDING_COSIGN)
    throw new ConflictError('BREAK_GLASS_NOT_PENDING');
  if (row.cosignExpiresAt <= new Date() || row.expiresAt <= new Date()) {
    await tx.breakGlassElevation.update({
      where: { id: row.id },
      data: { status: BreakGlassStatus.DENIED },
    });
    await appendAuditEvent(tx, {
      eventType: 'BREAK_GLASS_EXPIRED',
      actorType: ActorType.SYSTEM,
      caseId: row.caseId,
      payload: { elevationId: row.id },
      requestId: actor.requestId,
      traceId: actor.traceId,
    });
    transitions.add(1, { state: BreakGlassStatus.DENIED });
    return { elevation: { ...row, status: BreakGlassStatus.DENIED }, approval: null };
  }
  const decision = await tx.policyDecision.findFirst({
    where: { caseId: row.caseId },
    orderBy: { createdAt: 'desc' },
  });
  if (!decision) throw new ConflictError('POLICY_UNAVAILABLE');
  const approval = await recordApproval(tx, {
    caseRef: row.caseRef,
    actor,
    decision: 'APPROVE',
    disposition: decision.disposition,
    rationale: 'Emergency access co-sign approved.',
    elevationId: row.id,
  });
  const elevation = await tx.breakGlassElevation.update({
    where: { id: row.id },
    data: { status: BreakGlassStatus.ACTIVE, cosignedById: actor.id },
  });
  await appendAuditEvent(tx, {
    eventType: 'BREAK_GLASS_COSIGNED',
    actorType: ActorType.USER,
    actorId: actor.id,
    caseId: row.caseId,
    payload: { elevationId: row.id, approvalId: approval.approval.id },
    requestId: actor.requestId,
    traceId: actor.traceId,
  });
  transitions.add(1, { state: BreakGlassStatus.ACTIVE });
  return { elevation, approval };
}

export async function revokeElevation(
  tx: Prisma.TransactionClient,
  elevationId: string,
  actor: AdminActor,
) {
  if (!actor.roles.includes(Role.ADMIN))
    throw new AppError('FORBIDDEN', 403, 'Administrator role required.');
  const row = await tx.breakGlassElevation.findUnique({ where: { id: elevationId } });
  if (!row) throw new NotFoundError('Elevation not found.');
  if (
    !([BreakGlassStatus.PENDING_COSIGN, BreakGlassStatus.ACTIVE] as BreakGlassStatus[]).includes(
      row.status,
    )
  )
    throw new ConflictError('BREAK_GLASS_NOT_ACTIVE');
  const elevation = await tx.breakGlassElevation.update({
    where: { id: row.id },
    data: { status: BreakGlassStatus.REVOKED },
  });
  await tx.approval.updateMany({
    where: { elevationId: row.id, status: 'VALID' },
    data: { status: 'REVOKED' },
  });
  await appendAuditEvent(tx, {
    eventType: 'BREAK_GLASS_REVOKED',
    actorType: ActorType.USER,
    actorId: actor.id,
    caseId: row.caseId,
    payload: { elevationId: row.id },
    requestId: actor.requestId,
    traceId: actor.traceId,
  });
  transitions.add(1, { state: BreakGlassStatus.REVOKED });
  return elevation;
}

export async function assertExecutionWindow(
  tx: Prisma.TransactionClient,
  caseId: string,
  actorId: string,
) {
  const active = await tx.breakGlassElevation.findFirst({
    where: { caseId, status: BreakGlassStatus.ACTIVE, expiresAt: { gt: new Date() } },
  });
  if (!active) throw new ConflictError('BREAK_GLASS_UNAVAILABLE');
  if (active.requestedById !== actorId)
    throw new AppError('FORBIDDEN', 403, 'Only the elevation requester can use this window.');
  return active;
}

export async function markElevationUsed(
  tx: Prisma.TransactionClient,
  elevationId: string,
  actor: AdminActor,
) {
  const row = await tx.breakGlassElevation.findUnique({ where: { id: elevationId } });
  if (!row || row.status !== BreakGlassStatus.ACTIVE || row.expiresAt <= new Date())
    throw new ConflictError('BREAK_GLASS_UNAVAILABLE');
  if (row.requestedById !== actor.id)
    throw new AppError('FORBIDDEN', 403, 'Only the elevation requester can use this window.');
  const used = await tx.breakGlassElevation.update({
    where: { id: row.id },
    data: { status: BreakGlassStatus.USED, usedAt: new Date() },
  });
  await appendAuditEvent(tx, {
    eventType: 'BREAK_GLASS_USED',
    actorType: ActorType.USER,
    actorId: actor.id,
    caseId: row.caseId,
    payload: {
      elevationId: row.id,
      reviewDueAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    },
    requestId: actor.requestId,
    traceId: actor.traceId,
  });
  await enqueue(tx, {
    eventType: 'SECURITY_PAGE',
    aggregateType: 'BreakGlassElevation',
    aggregateId: row.id,
    payload: { elevationId: row.id, caseRef: row.caseRef },
    dedupeKey: `break-glass-page:${row.id}`,
  });
  await enqueue(tx, {
    eventType: 'AUDITOR_REVIEW_REQUIRED',
    aggregateType: 'BreakGlassElevation',
    aggregateId: row.id,
    payload: { elevationId: row.id, dueAt: new Date(Date.now() + 24 * 3_600_000).toISOString() },
    dedupeKey: `break-glass-auditor:${row.id}`,
  });
  transitions.add(1, { state: BreakGlassStatus.USED });
  return used;
}
