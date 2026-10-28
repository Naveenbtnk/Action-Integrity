import 'server-only';

import { EvidenceKind } from '@/generated/prisma/enums';
import { agentTools } from '@/lib/agent/tools';
import type { EvidenceBundle, EvidenceRef } from '@/lib/agent/types';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export async function buildEvidenceBundle(caseId: string): Promise<EvidenceBundle> {
  const caseRow = await db.case.findUnique({
    where: { id: caseId },
    include: {
      integrityEvent: true,
      actions: { orderBy: { requestedAt: 'asc' }, take: 1 },
      exposedAccounts: { select: { accountId: true } },
      evidence: { orderBy: { capturedAt: 'asc' } },
    },
  });
  if (!caseRow) throw new NotFoundError('Case not found.');
  const accountIds = [...new Set(caseRow.exposedAccounts.map((item) => item.accountId))];
  const evidence: EvidenceRef[] = [];
  for (const accountId of accountIds.slice(0, 10)) {
    const [contracts, billing, usage, support, target] = await Promise.all([
      agentTools.get_contract(accountId),
      agentTools.get_source_records('billing', accountId),
      agentTools.get_source_records('usage', accountId),
      agentTools.get_source_records('support', accountId),
      agentTools.get_target_state(accountId),
    ]);
    for (const row of contracts.slice(0, 2))
      evidence.push({
        kind: EvidenceKind.CONTRACT_RECORD,
        ref: row.recordRef,
        source: 'contract',
        stance: 'SUPPORTS',
        excerpt: `Account ${accountId}; entitlement ${row.entitlementKey}; contract status ${row.status}; version ${row.contractVersion}`,
      });
    for (const row of billing.slice(0, 2)) {
      if (!('planStatus' in row)) continue;
      evidence.push({
        kind: EvidenceKind.BILLING_RECORD,
        ref: row.recordRef,
        source: 'billing',
        stance: row.planStatus === 'CURRENT' ? 'CONTRADICTS' : 'NEUTRAL',
        excerpt: `Account ${accountId}; billing plan status ${row.planStatus}; plan ${row.planCode}`,
      });
    }
    for (const row of usage.slice(0, 2)) {
      if (!('eventCount' in row)) continue;
      evidence.push({
        kind: EvidenceKind.USAGE_SIGNAL,
        ref: row.recordRef,
        source: 'usage',
        stance: 'NEUTRAL',
        excerpt: `Account ${accountId}; feature ${row.featureKey}; recent events ${row.eventCount}`,
      });
    }
    for (const row of support.slice(0, 2)) {
      if (!('subject' in row)) continue;
      evidence.push({
        kind: EvidenceKind.SUPPORT_TICKET,
        ref: row.recordRef,
        source: 'support',
        stance: 'NEUTRAL',
        excerpt: `Account ${accountId}; ticket subject ${row.subject.slice(0, 300)}`,
      });
    }
    for (const row of target.slice(0, 2))
      evidence.push({
        kind: EvidenceKind.TARGET_STATE,
        ref: `${row.accountId}:${row.entitlementKey}`,
        source: 'target',
        stance: 'NEUTRAL',
        excerpt: `Account ${accountId}; target entitlement ${row.entitlementKey}; status ${row.status}`,
      });
  }
  for (const item of caseRow.evidence)
    evidence.push({
      kind: item.kind,
      ref: item.recordRef,
      source: item.sourceKey,
      stance: item.stance,
      excerpt: item.excerpt.slice(0, 500),
    });
  const action = caseRow.actions[0];
  return {
    caseId: caseRow.id,
    caseRef: caseRow.ref,
    accountIds,
    actionType: action?.actionType ?? 'UNKNOWN',
    actionPayload: action?.payload ?? {},
    eventType: caseRow.integrityEvent.type,
    eventSummary: caseRow.integrityEvent.summary,
    evidence: evidence.slice(0, 20),
  };
}
