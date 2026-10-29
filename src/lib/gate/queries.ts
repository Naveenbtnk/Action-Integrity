import 'server-only';

import type {
  CaseMode,
  CaseStatus,
  Disposition,
  OutboundActionStatus,
  Severity,
} from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export async function listActions(query: {
  status?: OutboundActionStatus | undefined;
  accountId?: string | undefined;
  sort?: 'newest' | 'oldest' | undefined;
  cursor?: string | undefined;
  limit: number;
}) {
  const order = query.sort === 'oldest' ? 'asc' : 'desc';
  const actions = await db.outboundAction.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
    },
    include: { case: { select: { ref: true } }, holds: { where: { releasedAt: null } } },
    orderBy: [{ requestedAt: order }, { id: order }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  return {
    actions: actions
      .slice(0, query.limit)
      .map((action) => ({ ...action, caseRef: action.case?.ref ?? null })),
    nextCursor: actions.length > query.limit ? actions[query.limit - 1]?.id : null,
  };
}

export async function getAction(id: string) {
  const action = await db.outboundAction.findUnique({
    where: { id },
    include: {
      case: { select: { ref: true, exposedAccounts: true } },
      holds: { orderBy: { placedAt: 'desc' } },
      restorePoint: true,
      integrityEvent: {
        select: { id: true, summary: true, severity: true, type: true, scopeSelector: true },
      },
    },
  });
  if (!action) throw new NotFoundError('Action not found.');
  const decisionAudit = await db.auditEvent.findFirst({
    where: { eventType: 'ACTION_INGESTED', payload: { path: ['actionRef'], equals: action.ref } },
    orderBy: { seq: 'desc' },
    select: { payload: true },
  });
  const recorded = decisionAudit?.payload;
  const reasons =
    recorded &&
    typeof recorded === 'object' &&
    !Array.isArray(recorded) &&
    Array.isArray(recorded.reasons)
      ? recorded.reasons.filter((value): value is string => typeof value === 'string')
      : [];
  return {
    action,
    gate: { decision: action.gateDecision, reasons },
    hold: action.holds.find((hold) => hold.releasedAt === null) ?? null,
    exposure: {
      accountIds: action.case?.exposedAccounts.map((account) => account.accountId) ?? [],
      event: action.integrityEvent,
    },
    restorePoint: action.restorePoint,
    caseRef: action.case?.ref ?? null,
  };
}

export async function listCases(query: {
  status?: CaseStatus | undefined;
  statusNotIn?: CaseStatus[] | undefined;
  assignedToId?: string | undefined;
  severity?: Severity | undefined;
  mode?: CaseMode | undefined;
  riskBand?: string | undefined;
  disposition?: Disposition | undefined;
  cursor?: string | undefined;
  limit: number;
}) {
  const decisionRows = query.disposition
    ? await db.policyDecision.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { caseId: true, disposition: true },
      })
    : [];
  const latest = new Map<string, Disposition>();
  for (const row of decisionRows)
    if (!latest.has(row.caseId)) latest.set(row.caseId, row.disposition);
  const matchingCaseIds = query.disposition
    ? [...latest.entries()]
        .filter(([, disposition]) => disposition === query.disposition)
        .map(([id]) => id)
    : null;
  const cases = await db.case.findMany({
    where: {
      ...(matchingCaseIds ? { id: { in: matchingCaseIds } } : {}),
      ...(query.status
        ? { status: query.status }
        : query.statusNotIn
          ? { status: { notIn: query.statusNotIn } }
          : {}),
      ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.riskBand ? { riskBand: query.riskBand } : {}),
    },
    include: {
      integrityEvent: { select: { summary: true, type: true } },
      actions: { select: { id: true, ref: true, status: true } },
      assignedTo: { select: { name: true } },
      reports: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { _count: { select: { hypotheses: true } } },
      },
      evidenceRequests: {
        where: { status: 'REQUESTED' },
        select: { id: true },
      },
    },
    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  return {
    cases: cases.slice(0, query.limit).map((caseRow) => {
      const { assignedTo, reports, evidenceRequests, ...record } = caseRow;
      return {
        ...record,
        estimatedValueMinor: record.estimatedValueMinor.toString(),
        ownerName: assignedTo?.name ?? null,
        hypothesisCount: reports[0]?._count.hypotheses ?? 0,
        openEvidenceRequests: evidenceRequests.length,
      };
    }),
    nextCursor: cases.length > query.limit ? cases[query.limit - 1]?.id : null,
  };
}

export async function getCase(ref: string) {
  const caseRow = await db.case.findUnique({
    where: { ref },
    include: {
      integrityEvent: true,
      actions: true,
      holds: true,
      exposedAccounts: true,
      reports: { orderBy: { createdAt: 'desc' }, take: 1, include: { hypotheses: true } },
      evidence: { orderBy: { capturedAt: 'asc' } },
      evidenceRequests: { orderBy: { requestedAt: 'asc' } },
      decisions: { orderBy: { createdAt: 'desc' }, take: 1 },
      approvals: {
        orderBy: { createdAt: 'asc' },
        include: { reviewer: { select: { name: true, roles: true } } },
      },
      executions: { orderBy: { startedAt: 'desc' } },
      verifications: { orderBy: { checkedAt: 'desc' } },
      elevations: { orderBy: { createdAt: 'desc' }, take: 1 },
      auditEvents: { orderBy: { seq: 'asc' } },
    },
  });
  if (!caseRow) throw new NotFoundError('Case not found.');
  return {
    case: {
      ...caseRow,
      estimatedValueMinor: caseRow.estimatedValueMinor.toString(),
      auditEvents: undefined,
      reports: undefined,
      evidence: undefined,
      evidenceRequests: undefined,
      decisions: undefined,
      approvals: undefined,
      executions: undefined,
      verifications: undefined,
      elevations: undefined,
    },
    event: caseRow.integrityEvent,
    actions: caseRow.actions,
    holds: caseRow.holds,
    exposedAccounts: caseRow.exposedAccounts,
    investigation: caseRow.reports[0] ?? null,
    evidence: caseRow.evidence,
    evidenceRequests: caseRow.evidenceRequests,
    policy: caseRow.decisions[0] ?? null,
    approvals: caseRow.approvals,
    execution: caseRow.executions,
    verifications: caseRow.verifications,
    breakGlass: caseRow.elevations[0] ?? null,
    timeline: caseRow.auditEvents.map((event) => ({ ...event, seq: event.seq.toString() })),
    degradationLevel: caseRow.degradationLevel ?? 'L0_NORMAL',
  };
}
