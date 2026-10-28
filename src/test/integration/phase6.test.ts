import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import {
  ApprovalDecision,
  CaseMode,
  CaseStatus,
  Disposition,
  GateDecision,
  OutboundActionStatus,
  OutboundActionType,
  PolicyStatus,
  Role,
  Severity,
} from '@/generated/prisma/enums';
import { addEvidence } from '@/lib/agent/evidence-write';
import { assertQuorum, expireApprovals, recordApproval } from '@/lib/approval';
import {
  assertExecutionWindow,
  cosignElevation,
  markElevationUsed,
  requestElevation,
} from '@/lib/break-glass';
import { db } from '@/lib/db';
import { activatePolicy } from '@/lib/policy/activate';
import { canonicalPolicyHash, loadPolicyFile } from '@/lib/policy/config';
import { evaluateAndPersist } from '@/lib/policy/persist';

const requested = new Set(process.argv.slice(2));
const shouldRun = (name: string) => requested.size === 0 || requested.has(name);
const txWork = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
  db.$transaction((tx) => work(tx as Prisma.TransactionClient));
const actor = (user: { id: string; roles: Role[] }) => ({
  ...user,
  requestId: `phase6_${randomUUID()}`,
});

async function fixture(
  disposition: Disposition,
  exposureCount: number,
  evidenceAuthorId?: string,
  completeness = 1,
) {
  const suffix = randomUUID();
  const event = await db.integrityEvent.findFirstOrThrow({ select: { id: true } });
  const caseRow = await db.case.create({
    data: {
      ref: `P6-${suffix}`,
      integrityEventId: event.id,
      title: 'Phase 6 approval fixture',
      status: CaseStatus.AWAITING_APPROVAL,
      severity: Severity.HIGH,
      riskScore: 0,
      riskBand: 'LOW',
      exposureCount,
      estimatedValueMinor: 2_500_000n,
      mode: CaseMode.DETERMINISTIC,
      openedAt: new Date(),
      lastTransitionAt: new Date(),
    },
  });
  await db.outboundAction.create({
    data: {
      ref: `ACT-P6-${suffix}`,
      sourceAgent: 'phase6-test',
      accountId: 'acc_00042',
      actionType: OutboundActionType.ENTITLEMENT_REVOKE,
      payload: { entitlementKey: 'SSO' },
      payloadHash: suffix,
      requestedAt: new Date(),
      status: OutboundActionStatus.HELD,
      gateDecision: GateDecision.HOLD,
      gateEvaluatedAt: new Date(),
      idempotencyKey: `phase6_${suffix}`,
      caseId: caseRow.id,
    },
  });
  const citedRef = `owner:${suffix}`;
  if (evidenceAuthorId)
    await db.evidenceItem.create({
      data: {
        caseId: caseRow.id,
        kind: 'OWNER_CONFIRMATION',
        sourceKey: 'phase6-test',
        recordRef: citedRef,
        excerpt: 'Owner confirms policy disposition.',
        stance: 'SUPPORTS',
        capturedAt: new Date(Date.now() - 1000),
        addedById: evidenceAuthorId,
      },
    });
  await db.investigationReport.create({
    data: {
      caseId: caseRow.id,
      runId: suffix,
      mode: CaseMode.DETERMINISTIC,
      recommendedDisposition: disposition,
      confidence: 1,
      evidenceCompleteness: completeness,
      reasoning: 'Controlled Phase 6 fixture.',
      missingEvidence: [],
      citations: evidenceAuthorId
        ? [
            {
              kind: 'OWNER_CONFIRMATION',
              ref: citedRef,
              excerpt: 'Owner confirms policy disposition.',
            },
          ]
        : [],
      suspiciousContent: [],
      uncitedClaims: false,
      modelId: null,
      promptVersion: 'phase6-test',
      evidenceHash: suffix,
      isFallback: false,
      retried: false,
      tokensUsed: null,
      createdAt: new Date(),
    },
  });
  return caseRow;
}

try {
  const [reviewer, senior, admin] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: 'reviewer@aic.local' } }),
    db.user.findUniqueOrThrow({ where: { email: 'senior@aic.local' } }),
    db.user.findUniqueOrThrow({ where: { email: 'admin@aic.local' } }),
  ]);
  const secondAdmin = await db.user.upsert({
    where: { email: 'phase6-admin@aic.local' },
    update: {},
    create: { email: 'phase6-admin@aic.local', name: 'Phase 6 Admin', roles: [Role.ADMIN] },
  });
  if (shouldRun('policy-activation')) {
    const document = await loadPolicyFile('2026.10.2');
    const hash = canonicalPolicyHash(document);
    const candidate =
      (await db.policyVersion.findUnique({ where: { version: document.version } })) ??
      (await db.policyVersion.create({
        data: {
          version: document.version,
          hash,
          document,
          status: PolicyStatus.DRAFT,
          reviewTicket: 'SEED-BASELINE',
          createdAt: new Date(),
        },
      }));
    assert.equal(candidate.hash, hash);
    if (candidate.status === PolicyStatus.DRAFT) {
      const previous = await db.policyVersion.findFirstOrThrow({
        where: { status: PolicyStatus.ACTIVE },
      });
      const approvedCase = await fixture(Disposition.BLOCK, 1);
      const report = await db.investigationReport.findFirstOrThrow({
        where: { caseId: approvedCase.id },
      });
      const oldDecision = await db.policyDecision.create({
        data: {
          caseId: approvedCase.id,
          reportId: report.id,
          riskScore: 5,
          riskBand: 'LOW',
          disposition: Disposition.BLOCK,
          allowedDispositions: [Disposition.BLOCK],
          approvalRequired: true,
          requiredApprovals: 1,
          requiredRoles: [],
          approvalExpiresAt: new Date(Date.now() + 12 * 3_600_000),
          reasons: [],
          policyVersion: previous.version,
          policyHash: previous.hash,
          evidenceHash: report.evidenceHash,
          inputsHash: 'phase6-test',
          isFallback: false,
          createdAt: new Date(),
        },
      });
      await db.approval.create({
        data: {
          caseId: approvedCase.id,
          reviewerId: reviewer.id,
          decision: ApprovalDecision.APPROVE,
          disposition: oldDecision.disposition,
          rationale: '',
          reopenCount: approvedCase.reopenCount,
          status: 'VALID',
          boundEvidenceHash: oldDecision.evidenceHash,
          boundPolicyHash: oldDecision.policyHash,
          boundReportId: report.id,
          expiresAt: new Date(Date.now() + 12 * 3_600_000),
          createdAt: new Date(),
        },
      });
      await db.case.update({
        where: { id: approvedCase.id },
        data: { status: CaseStatus.APPROVED },
      });
      await assert.rejects(
        txWork((tx) =>
          activatePolicy(tx, {
            version: document.version,
            hash: 'sha256:bad',
            reviewTicket: candidate.reviewTicket,
            actorId: admin.id,
            requestId: `phase6_${randomUUID()}`,
          }),
        ),
        (error: unknown) => (error as { code?: string }).code === 'POLICY_HASH_MISMATCH',
      );
      assert.equal(
        (await db.policyVersion.findUniqueOrThrow({ where: { id: candidate.id } })).status,
        PolicyStatus.DRAFT,
      );
      await txWork((tx) =>
        activatePolicy(tx, {
          version: document.version,
          hash,
          reviewTicket: candidate.reviewTicket,
          actorId: admin.id,
          requestId: `phase6_${randomUUID()}`,
        }),
      );
      const activationAudit = await db.auditEvent.findFirstOrThrow({
        where: { eventType: 'POLICY_ACTIVATED', actorId: admin.id },
        orderBy: { seq: 'desc' },
      });
      assert.equal(activationAudit.policyVersion, document.version);
      assert.equal(activationAudit.policyHash, hash);
      assert.equal(
        await db.approval.count({ where: { caseId: approvedCase.id, status: 'VALID' } }),
        0,
      );
      assert.equal(
        (await db.case.findUniqueOrThrow({ where: { id: approvedCase.id } })).status,
        CaseStatus.AWAITING_APPROVAL,
      );
    }
    assert.equal(
      (await db.policyVersion.findFirstOrThrow({ where: { status: PolicyStatus.ACTIVE } })).hash,
      hash,
    );
    process.stdout.write('policy-activation: passed\n');
  }
  if (shouldRun('approval')) {
    const caseRow = await fixture(Disposition.RELEASE_AFTER_CORRECTION, 300);
    const policy = await txWork((tx) => evaluateAndPersist(tx, caseRow.ref, actor(reviewer)));
    assert.equal(policy.requiredApprovals, 2);
    const evaluationAudit = await db.auditEvent.findFirstOrThrow({
      where: { caseId: caseRow.id, eventType: 'POLICY_EVALUATED' },
    });
    assert.equal(evaluationAudit.policyVersion, policy.policyVersion);
    assert.equal(evaluationAudit.policyHash, policy.policyHash);
    const first = await txWork((tx) =>
      recordApproval(tx, {
        caseRef: caseRow.ref,
        actor: actor(reviewer),
        decision: ApprovalDecision.APPROVE,
        disposition: policy.disposition,
        rationale: '',
      }),
    );
    assert.equal(first.quorum.met, false);
    assert.deepEqual(first.quorum.missingRoles, ['SENIOR_REVIEWER']);
    await assert.rejects(
      txWork((tx) =>
        recordApproval(tx, {
          caseRef: caseRow.ref,
          actor: actor(reviewer),
          decision: ApprovalDecision.APPROVE,
          disposition: policy.disposition,
          rationale: '',
        }),
      ),
      (error: unknown) => (error as { code?: string }).code === 'DUPLICATE_APPROVER',
    );
    const second = await txWork((tx) =>
      recordApproval(tx, {
        caseRef: caseRow.ref,
        actor: actor(senior),
        decision: ApprovalDecision.APPROVE,
        disposition: policy.disposition,
        rationale: '',
      }),
    );
    assert.equal(second.quorum.met, true);
    assert.equal(
      (await db.case.findUniqueOrThrow({ where: { id: caseRow.id } })).status,
      CaseStatus.APPROVED,
    );
    await txWork((tx) =>
      addEvidence(
        tx,
        caseRow.ref,
        {
          kind: 'OWNER_CONFIRMATION',
          sourceKey: 'phase6-test',
          recordRef: `owner:${randomUUID()}`,
          excerpt: 'Additional approval evidence.',
          stance: 'SUPPORTS',
        },
        actor(reviewer),
      ),
    );
    assert.equal(await db.approval.count({ where: { caseId: caseRow.id, status: 'VALID' } }), 0);
    assert.equal(
      (await db.case.findUniqueOrThrow({ where: { id: caseRow.id } })).status,
      CaseStatus.AWAITING_APPROVAL,
    );
    await assert.rejects(
      txWork((tx) => assertQuorum(tx, caseRow.id, policy)),
      (error: unknown) => (error as { code?: string }).code === 'EVIDENCE_CHANGED',
    );
    const concurrentCase = await fixture(Disposition.RELEASE_AFTER_CORRECTION, 300);
    await txWork((tx) => evaluateAndPersist(tx, concurrentCase.ref, actor(reviewer)));
    await Promise.all(
      [reviewer, senior].map((user) =>
        txWork((tx) =>
          recordApproval(tx, {
            caseRef: concurrentCase.ref,
            actor: actor(user),
            decision: ApprovalDecision.APPROVE,
            disposition: Disposition.RELEASE_AFTER_CORRECTION,
            rationale: '',
          }),
        ),
      ),
    );
    assert.equal(
      (await db.case.findUniqueOrThrow({ where: { id: concurrentCase.id } })).status,
      CaseStatus.APPROVED,
    );
    assert.equal(
      await db.approval.count({ where: { caseId: concurrentCase.id, status: 'VALID' } }),
      2,
    );
    const rejection = await fixture(Disposition.BLOCK, 1);
    await txWork((tx) => evaluateAndPersist(tx, rejection.ref, actor(reviewer)));
    await assert.rejects(
      txWork((tx) =>
        recordApproval(tx, {
          caseRef: rejection.ref,
          actor: actor(reviewer),
          decision: ApprovalDecision.REJECT,
          disposition: Disposition.BLOCK,
          rationale: '',
        }),
      ),
      (error: unknown) => (error as { httpStatus?: number }).httpStatus === 400,
    );
    await txWork((tx) =>
      recordApproval(tx, {
        caseRef: rejection.ref,
        actor: actor(reviewer),
        decision: ApprovalDecision.REJECT,
        disposition: Disposition.BLOCK,
        rationale: 'The cited evidence does not support this action.',
      }),
    );
    assert.equal(
      (await db.case.findUniqueOrThrow({ where: { id: rejection.id } })).status,
      CaseStatus.REJECTED,
    );
    const authored = await fixture(Disposition.BLOCK, 1, reviewer.id);
    await txWork((tx) => evaluateAndPersist(tx, authored.ref, actor(senior)));
    await assert.rejects(
      txWork((tx) =>
        recordApproval(tx, {
          caseRef: authored.ref,
          actor: actor(reviewer),
          decision: ApprovalDecision.APPROVE,
          disposition: Disposition.BLOCK,
          rationale: '',
        }),
      ),
      (error: unknown) => (error as { code?: string }).code === 'REVIEWER_CONFLICT',
    );
    await txWork((tx) =>
      recordApproval(tx, {
        caseRef: authored.ref,
        actor: actor(senior),
        decision: ApprovalDecision.APPROVE,
        disposition: Disposition.BLOCK,
        rationale: '',
      }),
    );
    const incomplete = await fixture(Disposition.RELEASE_AFTER_CORRECTION, 1, undefined, 0.6);
    const held = await txWork((tx) => evaluateAndPersist(tx, incomplete.ref, actor(reviewer)));
    assert.equal(held.disposition, Disposition.HOLD_FOR_EVIDENCE);
    assert.equal(held.allowedDispositions.includes(Disposition.RELEASE_AFTER_CORRECTION), false);
    await assert.rejects(
      txWork((tx) =>
        recordApproval(tx, {
          caseRef: incomplete.ref,
          actor: actor(reviewer),
          decision: ApprovalDecision.APPROVE,
          disposition: Disposition.RELEASE_AFTER_CORRECTION,
          rationale: '',
        }),
      ),
      (error: unknown) => (error as { code?: string }).code === 'EVIDENCE_INCOMPLETE',
    );
    const overridden = await fixture(Disposition.BLOCK, 1);
    await txWork((tx) => evaluateAndPersist(tx, overridden.ref, actor(reviewer)));
    await txWork((tx) =>
      recordApproval(tx, {
        caseRef: overridden.ref,
        actor: actor(reviewer),
        decision: ApprovalDecision.OVERRIDE,
        disposition: Disposition.BLOCK,
        rationale: 'The disposition requires an explicit review override.',
      }),
    );
    await assert.rejects(
      txWork((tx) =>
        recordApproval(tx, {
          caseRef: overridden.ref,
          actor: actor(reviewer),
          decision: ApprovalDecision.APPROVE,
          disposition: Disposition.BLOCK,
          rationale: '',
        }),
      ),
      (error: unknown) => (error as { code?: string }).code === 'REVIEWER_CONFLICT',
    );
    const expiring = await fixture(Disposition.RELEASE_AFTER_CORRECTION, 300);
    const expiringDecision = await txWork((tx) =>
      evaluateAndPersist(tx, expiring.ref, actor(reviewer)),
    );
    const expiringApproval = await db.approval.create({
      data: {
        caseId: expiring.id,
        reviewerId: reviewer.id,
        decision: ApprovalDecision.APPROVE,
        disposition: expiringDecision.disposition,
        rationale: '',
        reopenCount: expiring.reopenCount,
        status: 'VALID',
        boundEvidenceHash: expiringDecision.evidenceHash,
        boundPolicyHash: expiringDecision.policyHash,
        boundReportId: expiringDecision.reportId!,
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(Date.now() - 13 * 3_600_000),
      },
    });
    assert.equal(
      await txWork((tx) => expireApprovals(tx, expiring.id, `phase6_${randomUUID()}`)),
      1,
    );
    assert.equal(
      (await db.approval.findUniqueOrThrow({ where: { id: expiringApproval.id } })).status,
      'EXPIRED',
    );
    await assert.rejects(
      txWork((tx) => assertQuorum(tx, expiring.id, expiringDecision)),
      (error: unknown) => (error as { code?: string }).code === 'APPROVAL_EXPIRED',
    );
    process.stdout.write('approval: passed\n');
  }
  if (shouldRun('break-glass')) {
    const caseRow = await fixture(Disposition.RELEASE_AFTER_CORRECTION, 300);
    const policy = await txWork((tx) => evaluateAndPersist(tx, caseRow.ref, actor(reviewer)));
    const elevation = await txWork((tx) =>
      requestElevation(tx, {
        caseRef: caseRow.ref,
        reason:
          'A time-critical entitlement restoration is blocked while the senior reviewer is unavailable.',
        ttlMinutes: 30,
        actor: actor(admin),
      }),
    );
    await assert.rejects(
      txWork((tx) => cosignElevation(tx, elevation.id, actor(admin))),
      (error: unknown) => (error as { code?: string }).code === 'BREAK_GLASS_SELF_COSIGN',
    );
    const cosigned = await txWork((tx) => cosignElevation(tx, elevation.id, actor(secondAdmin)));
    assert.equal(cosigned.approval?.quorum.current, 1);
    assert.equal(cosigned.approval?.quorum.met, false);
    assert.deepEqual(cosigned.approval?.quorum.missingRoles, []);
    await txWork((tx) =>
      recordApproval(tx, {
        caseRef: caseRow.ref,
        actor: actor(reviewer),
        decision: ApprovalDecision.APPROVE,
        disposition: policy.disposition,
        rationale: '',
      }),
    );
    assert.equal(
      (await db.case.findUniqueOrThrow({ where: { id: caseRow.id } })).status,
      CaseStatus.APPROVED,
    );
    await assert.rejects(
      txWork((tx) => assertExecutionWindow(tx, caseRow.id, secondAdmin.id)),
      (error: unknown) => (error as { httpStatus?: number }).httpStatus === 403,
    );
    await txWork((tx) => assertExecutionWindow(tx, caseRow.id, admin.id));
    await txWork((tx) => markElevationUsed(tx, elevation.id, actor(admin)));
    assert.equal(
      await db.outboxEvent.count({
        where: { aggregateId: elevation.id, eventType: 'AUDITOR_REVIEW_REQUIRED' },
      }),
      1,
    );
    process.stdout.write('break-glass: passed\n');
  }
} finally {
  await db.$disconnect();
}
