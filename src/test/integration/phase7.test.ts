import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Prisma } from '@/generated/prisma/client';
import {
  CaseMode,
  CaseStatus,
  Disposition,
  GateDecision,
  OutboundActionStatus,
  OutboundActionType,
  Role,
  Severity,
  TargetEntitlementStatus,
} from '@/generated/prisma/enums';
import type {
  TargetAdapter,
  TargetChange,
  TargetRef,
  TargetWriteResult,
} from '@/lib/adapters/types';
import { db } from '@/lib/db';
import { executeAllowedAction } from '@/lib/executor/allow';
import { executeCase } from '@/lib/executor/execute';
import { reconcileExecutions } from '@/lib/executor/reconcile';
import { reconcileAllowedUnknown } from '@/lib/executor/reconcile-allow';
import { reopenCase } from '@/lib/verifier/reopen';
import { verifyCase } from '@/lib/verifier/verify';

const requested = new Set(process.argv.slice(2).filter((value) => !value.startsWith('--')));
const run = (name: string) => requested.size === 0 || requested.has(name);
const scenario = process.argv.find((value) => value.startsWith('--scenario='))?.split('=')[1];
if (requested.has('executor')) requested.add('execute');
if (requested.has('verifier')) requested.add('verify');

async function fixture(
  disposition: Disposition,
  withRestore = false,
  approvalOptions: { expiresAt?: Date; breakGlass?: boolean } = {},
) {
  const suffix = randomUUID();
  const event = await db.integrityEvent.findFirstOrThrow({ select: { id: true } });
  const policy = await db.policyVersion.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const reviewer = await db.user.findUniqueOrThrow({ where: { email: 'reviewer@aic.local' } });
  const executor = await db.user.findUniqueOrThrow({ where: { email: 'senior@aic.local' } });
  const caseRow = await db.case.create({
    data: {
      ref: `P7-${suffix}`,
      integrityEventId: event.id,
      title: 'Phase 7 execution fixture',
      status: CaseStatus.APPROVED,
      severity: Severity.HIGH,
      riskScore: 10,
      riskBand: 'LOW',
      exposureCount: 1,
      estimatedValueMinor: 0n,
      mode: CaseMode.DETERMINISTIC,
      openedAt: new Date(),
      lastTransitionAt: new Date(),
    },
  });
  const action = await db.outboundAction.create({
    data: {
      ref: `ACT-P7-${suffix}`,
      sourceAgent: 'phase7-test',
      accountId: 'acc_00042',
      actionType: OutboundActionType.ENTITLEMENT_REVOKE,
      payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
      payloadHash: suffix,
      requestedAt: new Date(),
      status:
        disposition === Disposition.COMPENSATE
          ? OutboundActionStatus.EXECUTED
          : OutboundActionStatus.HELD,
      gateDecision: GateDecision.HOLD,
      gateEvaluatedAt: new Date(),
      idempotencyKey: `phase7_${suffix}`,
      caseId: caseRow.id,
    },
  });
  if (withRestore) {
    const point = await db.restorePoint.create({
      data: {
        outboundActionId: action.id,
        targetObjectType: 'entitlement',
        targetObjectRef: 'acc_00042:SSO',
        state: {
          accountId: 'acc_00042',
          key: 'SSO',
          status: 'ACTIVE',
          grantedAt: '2026-10-26T09:00:00.000Z',
          revokedAt: null,
          sourceRef: 'phase7',
        },
        stateHash: suffix,
        capturedAt: new Date(),
      },
    });
    await db.outboundAction.update({
      where: { id: action.id },
      data: { restorePointId: point.id },
    });
  }
  const report = await db.investigationReport.create({
    data: {
      caseId: caseRow.id,
      runId: suffix,
      mode: CaseMode.DETERMINISTIC,
      recommendedDisposition: disposition,
      confidence: 1,
      evidenceCompleteness: 1,
      reasoning: 'Controlled Phase 7 fixture.',
      missingEvidence: [],
      citations: [],
      suspiciousContent: [],
      uncitedClaims: false,
      modelId: null,
      promptVersion: 'phase7-test',
      evidenceHash: suffix,
      isFallback: false,
      retried: false,
      tokensUsed: null,
      createdAt: new Date(),
    },
  });
  await db.policyDecision.create({
    data: {
      caseId: caseRow.id,
      reportId: report.id,
      riskScore: 10,
      riskBand: 'LOW',
      disposition,
      allowedDispositions: [disposition],
      approvalRequired: true,
      requiredApprovals: 1,
      requiredRoles: [],
      approvalExpiresAt: new Date(Date.now() + 3_600_000),
      reasons: [],
      policyVersion: policy.version,
      policyHash: policy.hash,
      evidenceHash: suffix,
      inputsHash: suffix,
      isFallback: false,
      createdAt: new Date(),
    },
  });
  await db.approval.create({
    data: {
      caseId: caseRow.id,
      reviewerId: reviewer.id,
      decision: 'APPROVE',
      disposition,
      rationale: '',
      reopenCount: 0,
      status: 'VALID',
      boundEvidenceHash: suffix,
      boundPolicyHash: policy.hash,
      boundReportId: report.id,
      expiresAt: approvalOptions.expiresAt ?? new Date(Date.now() + 3_600_000),
      breakGlass: approvalOptions.breakGlass ?? false,
      createdAt: new Date(),
    },
  });
  return {
    caseRow,
    action,
    reviewer,
    actor: { id: executor.id, roles: executor.roles as Role[], requestId: `phase7_${suffix}` },
  };
}

function target(
  initial: TargetEntitlementStatus,
  outcome: TargetWriteResult['status'] = 'SUCCEEDED',
  mutate = true,
) {
  let status = initial;
  let writes = 0;
  const state = () => ({
    accountId: 'acc_00042',
    key: 'SSO',
    status,
    grantedAt: '2026-10-26T09:00:00.000Z',
    revokedAt: null,
    sourceRef: 'phase7',
  });
  const client: TargetAdapter = {
    getEntitlement: async () => state(),
    getServiceStatus: async () => null,
    captureRestorePoint: async () => ({
      state: state(),
      stateHash: 'phase7',
      capturedAt: new Date().toISOString(),
    }),
    applyChange: async (change: TargetChange) => {
      writes++;
      if (mutate && change.targetObjectType === 'entitlement') status = change.to;
      return { status: outcome, response: null };
    },
    restoreFromSnapshot: async (_ref: TargetRef, snapshot: unknown) => {
      writes++;
      if (mutate && snapshot && typeof snapshot === 'object' && 'status' in snapshot)
        status = snapshot.status as TargetEntitlementStatus;
      return { status: outcome, response: null };
    },
  };
  return {
    client,
    get writes() {
      return writes;
    },
    get status() {
      return status;
    },
  };
}

if (run('execute') || run('verify') || !!scenario) {
  if (!scenario || scenario === 'A') {
    const block = await fixture(Disposition.BLOCK);
    const blockedTarget = target(TargetEntitlementStatus.ACTIVE);
    const result = await executeCase({
      caseRef: block.caseRow.ref,
      kind: 'BLOCK',
      actor: block.actor,
      requestKey: `block_${randomUUID()}`,
      client: blockedTarget.client,
    });
    assert.equal(result.noTargetWrite, true);
    assert.equal(blockedTarget.writes, 0);
    const verified = await verifyCase({
      caseRef: block.caseRow.ref,
      actor: block.actor,
      client: blockedTarget.client,
    });
    assert.equal(verified.verification.passed, true);
    assert.equal(verified.case.status, CaseStatus.CLOSED_RESOLVED);
    assert.equal(await db.actionExecution.count({ where: { caseId: block.caseRow.id } }), 0);
    if (!scenario) {
      const reopened = await db.$transaction((tx) =>
        reopenCase(tx as Prisma.TransactionClient, {
          caseRef: block.caseRow.ref,
          reason: 'A new integrity event requires a fresh lifecycle.',
          actorId: block.actor.id,
          requestId: block.actor.requestId,
        }),
      );
      assert.equal(reopened.status, CaseStatus.REOPENED);
      assert.equal(reopened.reopenCount, 1);
    }
  }

  if (!scenario) {
    const release = await fixture(Disposition.RELEASE_AFTER_CORRECTION);
    const releaseTarget = target(TargetEntitlementStatus.ACTIVE, 'UNKNOWN');
    const key = `release_${randomUUID()}`;
    const unknown = await executeCase({
      caseRef: release.caseRow.ref,
      kind: 'RELEASE',
      actor: release.actor,
      requestKey: key,
      client: releaseTarget.client,
    });
    assert.equal(unknown.execution?.status, 'UNKNOWN');
    const replay = await executeCase({
      caseRef: release.caseRow.ref,
      kind: 'RELEASE',
      actor: release.actor,
      requestKey: key,
      client: releaseTarget.client,
    });
    assert.equal(replay.execution?.id, unknown.execution?.id);
    assert.equal(releaseTarget.writes, 1);
    const resolved = await verifyCase({
      caseRef: release.caseRow.ref,
      actor: release.actor,
      client: releaseTarget.client,
    });
    assert.equal(resolved.verification.passed, true);
    assert.equal(resolved.execution?.status, 'SUCCEEDED');
    assert.equal(resolved.execution?.resolvedByVerification, true);

    const allowedId = randomUUID();
    const allowed = await db.outboundAction.create({
      data: {
        ref: `ACT-ALLOW-${allowedId}`,
        sourceAgent: 'phase7-test',
        accountId: 'acc_00042',
        actionType: OutboundActionType.ENTITLEMENT_REVOKE,
        payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
        payloadHash: allowedId,
        requestedAt: new Date(),
        status: OutboundActionStatus.PENDING,
        gateDecision: GateDecision.ALLOW,
        gateEvaluatedAt: new Date(),
        idempotencyKey: `allow_${allowedId}`,
      },
    });
    const allowedTarget = target(TargetEntitlementStatus.ACTIVE, 'UNKNOWN');
    const allowedResult = await executeAllowedAction({
      actionId: allowed.id,
      requestId: `phase7_${allowedId}`,
      client: allowedTarget.client,
    });
    assert.equal(allowedResult.verification?.passed, true);
    assert.equal(allowedResult.execution.status, 'SUCCEEDED');
    assert.equal(allowedResult.execution.caseId, null);
    const allowedReplay = await executeAllowedAction({
      actionId: allowed.id,
      requestId: `phase7_${allowedId}`,
      client: allowedTarget.client,
    });
    assert.equal(allowedReplay.execution.id, allowedResult.execution.id);
    assert.equal(allowedTarget.writes, 1);

    const concurrent = await fixture(Disposition.RELEASE_AFTER_CORRECTION);
    const concurrentTarget = target(TargetEntitlementStatus.ACTIVE);
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const slowClient: TargetAdapter = {
      ...concurrentTarget.client,
      applyChange: async (change, key) => {
        await writeGate;
        return concurrentTarget.client.applyChange(change, key);
      },
    };
    const firstWrite = executeCase({
      caseRef: concurrent.caseRow.ref,
      kind: 'RELEASE',
      actor: concurrent.actor,
      requestKey: `concurrent_a_${randomUUID()}`,
      client: slowClient,
    });
    let intent = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      intent = await db.actionExecution.findFirst({ where: { caseId: concurrent.caseRow.id } });
      if (intent) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(intent, 'the first execution must commit intent before the target call');
    await assert.rejects(
      executeCase({
        caseRef: concurrent.caseRow.ref,
        kind: 'RELEASE',
        actor: concurrent.actor,
        requestKey: `concurrent_b_${randomUUID()}`,
        client: concurrentTarget.client,
      }),
      (error: unknown) => (error as { code?: string }).code === 'ALREADY_EXECUTING',
    );
    releaseWrite?.();
    await firstWrite;
    assert.equal(concurrentTarget.writes, 1);

    const delayedId = randomUUID();
    const delayedAction = await db.outboundAction.create({
      data: {
        ref: `ACT-ALLOW-${delayedId}`,
        sourceAgent: 'phase7-test',
        accountId: 'acc_00042',
        actionType: OutboundActionType.ENTITLEMENT_REVOKE,
        payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
        payloadHash: delayedId,
        requestedAt: new Date(),
        status: OutboundActionStatus.PENDING,
        gateDecision: GateDecision.ALLOW,
        gateEvaluatedAt: new Date(),
        idempotencyKey: `allow_${delayedId}`,
      },
    });
    const delayedTarget = target(TargetEntitlementStatus.ACTIVE, 'UNKNOWN');
    let readFails = true;
    const delayedClient: TargetAdapter = {
      ...delayedTarget.client,
      getEntitlement: async (accountId, key) => {
        if (readFails) throw new Error('Injected read outage');
        return delayedTarget.client.getEntitlement(accountId, key);
      },
    };
    const delayed = await executeAllowedAction({
      actionId: delayedAction.id,
      requestId: `phase7_${delayedId}`,
      client: delayedClient,
    });
    assert.equal(delayed.execution.status, 'UNKNOWN');
    assert.equal(delayed.verification, null);
    readFails = false;
    assert.ok(await reconcileAllowedUnknown(`phase7_${delayedId}`, delayedClient));
    assert.equal(
      (await db.actionExecution.findUniqueOrThrow({ where: { id: delayed.execution.id } })).status,
      'SUCCEEDED',
    );
    assert.equal(delayedTarget.writes, 1);
  }

  if (!scenario || scenario === 'B') {
    const compensation = await fixture(Disposition.COMPENSATE, true);
    const changedTarget = target(TargetEntitlementStatus.REMOVED, 'UNKNOWN');
    const result = await executeCase({
      caseRef: compensation.caseRow.ref,
      kind: 'RESTORE_LAST_KNOWN_GOOD',
      actor: compensation.actor,
      requestKey: `comp_${randomUUID()}`,
      client: changedTarget.client,
    });
    assert.equal(result.execution?.status, 'UNKNOWN');
    assert.ok(result.execution?.preWriteRestorePointId);
    assert.notEqual(result.execution?.preWriteRestorePointId, result.execution?.restorePointId);
    assert.equal(changedTarget.writes, 1);
    const verification = await verifyCase({
      caseRef: compensation.caseRow.ref,
      actor: compensation.actor,
      client: changedTarget.client,
    });
    assert.equal(verification.verification.passed, true);
    assert.equal(verification.execution?.status, 'SUCCEEDED');
    assert.equal(changedTarget.status, TargetEntitlementStatus.ACTIVE);
  }

  if (!scenario || scenario === 'E') {
    const missing = await fixture(Disposition.COMPENSATE);
    const missingTarget = target(TargetEntitlementStatus.REMOVED);
    await assert.rejects(
      executeCase({
        caseRef: missing.caseRow.ref,
        kind: 'RESTORE_LAST_KNOWN_GOOD',
        actor: missing.actor,
        requestKey: `comp_${randomUUID()}`,
        client: missingTarget.client,
      }),
      (error: unknown) => (error as { code?: string }).code === 'NO_RESTORE_POINT',
    );
    assert.equal(missingTarget.writes, 0);
    assert.equal(
      (await db.case.findUniqueOrThrow({ where: { id: missing.caseRow.id } })).status,
      CaseStatus.SAFE_REFUSAL,
    );
  }

  if (!scenario || scenario === 'D') {
    const mismatch = await fixture(Disposition.RELEASE_AFTER_CORRECTION);
    const noopTarget = target(TargetEntitlementStatus.ACTIVE, 'SUCCEEDED', false);
    await executeCase({
      caseRef: mismatch.caseRow.ref,
      kind: 'RELEASE',
      actor: mismatch.actor,
      requestKey: `noop_${randomUUID()}`,
      client: noopTarget.client,
    });
    const failed = await verifyCase({
      caseRef: mismatch.caseRow.ref,
      actor: mismatch.actor,
      client: noopTarget.client,
    });
    assert.equal(failed.verification.passed, false);
    assert.equal(failed.case.status, CaseStatus.REOPENED);
    assert.equal(failed.execution?.status, 'FAILED');

    for (const failure of [
      'APPROVER_CANNOT_EXECUTE',
      'APPROVAL_QUORUM_NOT_MET',
      'APPROVAL_EXPIRED',
      'EVIDENCE_CHANGED',
      'POLICY_STALE',
      'BREAK_GLASS_INCOMPLETE',
    ] as const) {
      const candidate = await fixture(Disposition.BLOCK, false, {
        ...(failure === 'APPROVAL_EXPIRED' ? { expiresAt: new Date(Date.now() - 1_000) } : {}),
        ...(failure === 'BREAK_GLASS_INCOMPLETE' ? { breakGlass: true } : {}),
      });
      const untouched = target(TargetEntitlementStatus.ACTIVE);
      let candidateActor = candidate.actor;
      if (failure === 'APPROVER_CANNOT_EXECUTE')
        candidateActor = {
          id: candidate.reviewer.id,
          roles: candidate.reviewer.roles as Role[],
          requestId: `phase7_${randomUUID()}`,
        };
      if (failure === 'APPROVAL_QUORUM_NOT_MET')
        await db.approval.updateMany({
          where: { caseId: candidate.caseRow.id },
          data: { status: 'SUPERSEDED' },
        });
      if (failure === 'EVIDENCE_CHANGED')
        await db.evidenceItem.create({
          data: {
            caseId: candidate.caseRow.id,
            kind: 'OWNER_CONFIRMATION',
            sourceKey: 'phase7',
            recordRef: `owner:${randomUUID()}`,
            excerpt: 'New evidence after approval.',
            stance: 'SUPPORTS',
            capturedAt: new Date(Date.now() + 1_000),
          },
        });
      if (failure === 'POLICY_STALE') {
        const prior = await db.policyDecision.findFirstOrThrow({
          where: { caseId: candidate.caseRow.id },
        });
        await db.policyDecision.create({
          data: {
            caseId: prior.caseId,
            reportId: prior.reportId,
            riskScore: prior.riskScore,
            riskBand: prior.riskBand,
            disposition: prior.disposition,
            allowedDispositions: prior.allowedDispositions,
            approvalRequired: prior.approvalRequired,
            requiredApprovals: prior.requiredApprovals,
            requiredRoles: prior.requiredRoles,
            approvalExpiresAt: prior.approvalExpiresAt,
            reasons: prior.reasons as Prisma.InputJsonValue,
            policyVersion: prior.policyVersion,
            policyHash: 'sha256:stale',
            evidenceHash: prior.evidenceHash,
            inputsHash: prior.inputsHash,
            isFallback: prior.isFallback,
            createdAt: new Date(Date.now() + 1_000),
          },
        });
      }
      await assert.rejects(
        executeCase({
          caseRef: candidate.caseRow.ref,
          kind: 'BLOCK',
          actor: candidateActor,
          requestKey: `failure_${randomUUID()}`,
          client: untouched.client,
        }),
        (error: unknown) => (error as { code?: string }).code === failure,
      );
      assert.equal(untouched.writes, 0);
    }

    const degraded = await fixture(Disposition.RELEASE_AFTER_CORRECTION);
    const degradedTarget = target(TargetEntitlementStatus.ACTIVE);
    const degradation = await db.degradationState.create({
      data: {
        level: 'L2_TARGET_DEGRADED',
        reason: 'Phase 7 test',
        setBy: 'test',
        changedAt: new Date(),
      },
    });
    try {
      await assert.rejects(
        executeCase({
          caseRef: degraded.caseRow.ref,
          kind: 'RELEASE',
          actor: degraded.actor,
          requestKey: `degraded_${randomUUID()}`,
          client: degradedTarget.client,
        }),
        (error: unknown) => (error as { code?: string }).code === 'DEGRADATION_BLOCKED',
      );
      assert.equal(degradedTarget.writes, 0);
    } finally {
      await db.degradationState.delete({ where: { id: degradation.id } });
    }
  }
  process.stdout.write('phase7 execute verify: passed\n');
}

if (!scenario && run('reconcile')) {
  const crash = await fixture(Disposition.RELEASE_AFTER_CORRECTION);
  const orphan = await db.outboxEvent.create({
    data: {
      eventType: 'PHASE7_TEST',
      aggregateType: 'Case',
      aggregateId: crash.caseRow.id,
      payload: { caseRef: crash.caseRow.ref },
      dedupeKey: `phase7-orphan:${randomUUID()}`,
      status: 'PUBLISHING',
      nextAttemptAt: new Date(Date.now() - 600_000),
      createdAt: new Date(Date.now() - 600_000),
    },
  });
  await db.case.update({ where: { id: crash.caseRow.id }, data: { status: CaseStatus.EXECUTING } });
  const row = await db.actionExecution.create({
    data: {
      caseId: crash.caseRow.id,
      outboundActionId: crash.action.id,
      reopenCount: 0,
      kind: 'RELEASE',
      targetObjectType: 'entitlement',
      targetObjectRef: 'acc_00042:SSO',
      idempotencyKey: `crash_${randomUUID()}`,
      status: 'PENDING',
      requestPayload: { from: 'ACTIVE', to: 'REMOVED' } as Prisma.InputJsonObject,
      startedAt: new Date(Date.now() - 300_000),
    },
  });
  const summary = await reconcileExecutions({ requestId: `phase7_${randomUUID()}` });
  assert.ok(summary.executionsMarkedUnknown >= 1);
  assert.ok(summary.outboxRequeued >= 1);
  assert.equal(
    (await db.outboxEvent.findUniqueOrThrow({ where: { id: orphan.id } })).status,
    'PENDING',
  );
  assert.equal(
    (await db.actionExecution.findUniqueOrThrow({ where: { id: row.id } })).status,
    'UNKNOWN',
  );
  assert.equal(
    (await db.case.findUniqueOrThrow({ where: { id: crash.caseRow.id } })).status,
    CaseStatus.VERIFYING,
  );
  process.stdout.write('phase7 reconcile: passed\n');
}

await db.$disconnect();
