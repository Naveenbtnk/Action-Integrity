import 'dotenv/config';

import assert from 'node:assert/strict';

import { ApprovalStatus, PolicyStatus, Role } from '../../generated/prisma/enums';
import { db } from '../../lib/db';
import { ImmutableRecordError } from '../../lib/errors';

const requested = new Set(process.argv.slice(2));
const shouldRun = (name: string) => requested.size === 0 || requested.has(name);
const rollback = Symbol('rollback');

async function expectRejected(work: () => Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(work, reason);
}

async function withinRollback(work: (tx: typeof db) => Promise<void>): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await work(tx as typeof db);
      throw rollback;
    });
  } catch (cause) {
    if (cause !== rollback) throw cause;
  }
}

try {
  if (shouldRun('immutability')) {
    const event = await db.auditEvent.findFirstOrThrow();
    await assert.rejects(
      db.auditEvent.update({ where: { id: event.id }, data: { eventType: 'CASE_OPENED' } }),
      ImmutableRecordError,
    );
    await expectRejected(
      () =>
        db.$executeRaw`UPDATE "audit_event" SET "event_type" = 'CASE_OPENED' WHERE "id" = ${event.id}`,
      'direct SQL audit update must raise',
    );
    const action = await db.outboundAction.findUniqueOrThrow({ where: { ref: 'ACT-0001' } });
    const sample = await db.case.findUniqueOrThrow({ where: { ref: 'AIC-0001' } });
    await withinRollback(async (tx) => {
      await tx.actionHold.create({
        data: {
          caseId: sample.id,
          outboundActionId: action.id,
          reason: 'test',
          placedAt: new Date(),
        },
      });
      await expectRejected(
        () =>
          tx.actionHold.create({
            data: {
              caseId: sample.id,
              outboundActionId: action.id,
              reason: 'duplicate',
              placedAt: new Date(),
            },
          }),
        'two open holds must be rejected',
      );
    });
    process.stdout.write('immutability: passed\n');
  }

  if (shouldRun('policy')) {
    const active = await db.policyVersion.findFirstOrThrow({
      where: { status: PolicyStatus.ACTIVE },
    });
    await assert.rejects(
      db.policyVersion.update({ where: { id: active.id }, data: { document: { altered: true } } }),
      ImmutableRecordError,
    );
    await expectRejected(
      () =>
        db.policyVersion.create({
          data: {
            version: 'test-second-active',
            hash: 'sha256:test-second-active',
            document: {},
            status: PolicyStatus.ACTIVE,
            reviewTicket: 'TEST',
            createdAt: new Date(),
          },
        }),
      'two active policies must be rejected',
    );
    process.stdout.write('policy: passed\n');
  }

  if (shouldRun('user-roles')) {
    await expectRejected(
      () =>
        db.user.create({
          data: {
            email: 'invalid-combination@aic.local',
            name: 'Invalid',
            roles: [Role.ADMIN, Role.SENIOR_REVIEWER],
          },
        }),
      'admin and senior reviewer must be rejected',
    );
    process.stdout.write('user-roles: passed\n');
  }

  if (shouldRun('approval')) {
    const approval = await db.approval.findFirstOrThrow();
    await expectRejected(
      () =>
        db.approval.update({
          where: { id: approval.id },
          data: { rationale: 'Changed rationale after review' },
        }),
      'approval rationale must be immutable',
    );
    await withinRollback(async (tx) => {
      await tx.approval.update({
        where: { id: approval.id },
        data: { status: ApprovalStatus.SUPERSEDED },
      });
    });
    await expectRejected(
      () =>
        db.approval.create({
          data: {
            caseId: approval.caseId,
            reviewerId: approval.reviewerId,
            decision: approval.decision,
            disposition: approval.disposition,
            rationale: approval.rationale,
            reopenCount: approval.reopenCount,
            boundEvidenceHash: approval.boundEvidenceHash,
            boundPolicyHash: approval.boundPolicyHash,
            boundReportId: approval.boundReportId,
            expiresAt: approval.expiresAt,
            createdAt: new Date(),
          },
        }),
      'same reviewer cannot approve twice in a lifecycle',
    );
    process.stdout.write('approval: passed\n');
  }
} finally {
  await db.$disconnect();
}
