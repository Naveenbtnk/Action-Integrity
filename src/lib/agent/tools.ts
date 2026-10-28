import 'server-only';

import { z } from 'zod';

import { ActorType, EvidenceRequestStatus } from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { withIdempotency } from '@/lib/idempotency';

export const TOOL_NAMES = [
  'get_contract',
  'get_source_records',
  'get_account_history',
  'get_target_state',
  'search_related_cases',
  'find_owner',
  'request_evidence',
] as const;

const AccountId = z.string().regex(/^acc_\d{5}$/);
const SourceKey = z.enum(['billing', 'contract', 'usage', 'support', 'accounts']);

export const agentTools = {
  get_contract: async (accountId: string) =>
    db.srcContractEntitlement.findMany({
      where: { accountId: AccountId.parse(accountId) },
      orderBy: { effectiveFrom: 'desc' },
      take: 10,
      select: {
        recordRef: true,
        entitlementKey: true,
        status: true,
        contractVersion: true,
        effectiveFrom: true,
      },
    }),
  get_source_records: async (source: string, accountId: string) => {
    const key = SourceKey.parse(source);
    const id = AccountId.parse(accountId);
    if (key === 'billing')
      return db.srcBillingSubscription.findMany({
        where: { accountId: id },
        orderBy: { sourceUpdatedAt: 'desc' },
        take: 10,
        select: { recordRef: true, planStatus: true, planCode: true, sourceUpdatedAt: true },
      });
    if (key === 'contract') return agentTools.get_contract(id);
    if (key === 'usage')
      return db.srcUsageEventDaily.findMany({
        where: { accountId: id },
        orderBy: { lastSeenAt: 'desc' },
        take: 10,
        select: { recordRef: true, featureKey: true, eventCount: true, lastSeenAt: true },
      });
    if (key === 'support')
      return db.srcSupportTicket.findMany({
        where: { accountId: id },
        orderBy: { sourceCreatedAt: 'desc' },
        take: 10,
        select: { recordRef: true, subject: true, severity: true, sourceCreatedAt: true },
      });
    return db.srcAccountRegistry.findMany({
      where: { accountId: id },
      take: 1,
      select: { accountId: true, accountStatus: true, ownerTeam: true },
    });
  },
  get_account_history: async (accountId: string) =>
    db.srcBillingSubscription.findMany({
      where: { accountId: AccountId.parse(accountId) },
      orderBy: { sourceUpdatedAt: 'desc' },
      take: 20,
      select: { recordRef: true, planStatus: true, sourceUpdatedAt: true },
    }),
  get_target_state: async (accountId: string) =>
    db.tgtEntitlement.findMany({
      where: { accountId: AccountId.parse(accountId) },
      take: 10,
      select: { accountId: true, entitlementKey: true, status: true },
    }),
  search_related_cases: async (accountId: string) =>
    db.case.findMany({
      where: { exposedAccounts: { some: { accountId: AccountId.parse(accountId) } } },
      orderBy: { openedAt: 'desc' },
      take: 10,
      select: { ref: true, status: true, openedAt: true },
    }),
  find_owner: async (accountId: string) =>
    db.srcAccountRegistry.findUnique({
      where: { accountId: AccountId.parse(accountId) },
      select: { ownerTeam: true },
    }),
  request_evidence: async (input: {
    caseId: string;
    ownerTeam: string;
    question: string;
    dueInHours: number;
    requestId: string;
    idempotencyKey: string;
  }) => {
    const parsed = z
      .object({
        caseId: z.string().min(1),
        ownerTeam: z.string().min(1).max(100),
        question: z.string().min(1).max(1_000),
        dueInHours: z.number().int().min(1).max(168),
        requestId: z.string().min(8).max(64),
        idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
      })
      .parse(input);
    const request = new Request('http://internal/api/v1/agent/request-evidence', {
      method: 'POST',
      headers: { 'idempotency-key': parsed.idempotencyKey },
    });
    const result = await withIdempotency(
      request,
      'investigator',
      {
        caseId: parsed.caseId,
        ownerTeam: parsed.ownerTeam,
        question: parsed.question,
        dueInHours: parsed.dueInHours,
      },
      async (tx) => {
        const request = await tx.evidenceRequest.create({
          data: {
            caseId: parsed.caseId,
            ownerTeam: parsed.ownerTeam,
            question: parsed.question,
            status: EvidenceRequestStatus.REQUESTED,
            requestedAt: new Date(),
            dueAt: new Date(Date.now() + parsed.dueInHours * 3_600_000),
          },
        });
        await appendAuditEvent(tx, {
          eventType: 'EVIDENCE_REQUESTED',
          actorType: ActorType.SERVICE,
          actorId: null,
          caseId: parsed.caseId,
          payload: { evidenceRequestId: request.id, ownerTeam: parsed.ownerTeam },
          requestId: parsed.requestId,
        });
        return { status: 201, data: request };
      },
    );
    return result.data;
  },
} as const;
