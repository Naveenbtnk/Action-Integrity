import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CaseStatus,
  GateDecision,
  OutboundActionStatus,
  OutboundActionType,
  Role,
} from '@/generated/prisma/enums';
import { computeExposure } from '@/lib/exposure/compute';
import { decide } from '@/lib/gate/decide';
import { requirePermission, ROLE_PERMISSIONS } from '@/lib/rbac';
import { assertRouteCoverage } from '@/lib/rbac-coverage';
import { TRANSITIONS } from '@/lib/state-machine/case';

const detectedAt = new Date('2026-10-28T05:00:00.000Z');
const event = {
  id: 'event-1',
  detectedAt,
  scopeSelector: { accountIds: ['acc_00042'], values: ['CURRENT'] },
  contract: { sourceKey: 'billing', fieldPath: 'planStatus' },
};
const action = {
  id: 'action-1',
  accountId: 'acc_00042',
  actionType: OutboundActionType.ENTITLEMENT_REVOKE,
  status: OutboundActionStatus.PENDING,
  requestedAt: detectedAt,
  payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
};

describe('Phase 4 deterministic controls', () => {
  it('matches field, account, window edge and action state', () => {
    expect(computeExposure(event, [action]).actions).toHaveLength(1);
    expect(computeExposure(event, [{ ...action, accountId: 'acc_00043' }]).actions).toHaveLength(0);
    expect(
      computeExposure(event, [{ ...action, actionType: OutboundActionType.ACCOUNT_STATUS_CHANGE }])
        .actions,
    ).toHaveLength(0);
    expect(
      computeExposure(event, [
        { ...action, requestedAt: new Date(detectedAt.getTime() + 24 * 3_600_000) },
      ]).actions,
    ).toHaveLength(1);
    expect(
      computeExposure(event, [
        { ...action, requestedAt: new Date(detectedAt.getTime() + 24 * 3_600_000 + 1) },
      ]).actions,
    ).toHaveLength(0);
    expect(
      computeExposure(event, [{ ...action, status: OutboundActionStatus.EXECUTED }]).actions,
    ).toHaveLength(0);
    expect(
      computeExposure(event, [
        { ...action, status: OutboundActionStatus.EXECUTED, restorePointId: 'restore-1' },
      ]).actions,
    ).toHaveLength(1);
  });

  it('blocks bad submissions, holds overlap and allows unrelated actions', () => {
    expect(decide(action, { accountRegistered: false, openEvents: [event] }).decision).toBe(
      GateDecision.BLOCK,
    );
    expect(
      decide({ ...action, payload: {} }, { accountRegistered: true, openEvents: [event] }).decision,
    ).toBe(GateDecision.BLOCK);
    expect(decide(action, { accountRegistered: true, openEvents: [event] }).decision).toBe(
      GateDecision.HOLD,
    );
    expect(
      decide(
        { ...action, accountId: 'acc_00043' },
        { accountRegistered: true, openEvents: [event] },
      ).decision,
    ).toBe(GateDecision.ALLOW);
  });

  it('declares all case transitions and keeps closed states terminal', () => {
    const expected: Record<CaseStatus, CaseStatus[]> = {
      NEW: ['TRIAGED', 'CLOSED_NO_ACTION'],
      TRIAGED: ['HOLDING', 'CLOSED_NO_ACTION'],
      HOLDING: ['INVESTIGATING', 'AWAITING_APPROVAL', 'ESCALATED'],
      INVESTIGATING: ['AWAITING_EVIDENCE', 'AWAITING_APPROVAL', 'ESCALATED'],
      AWAITING_EVIDENCE: ['INVESTIGATING', 'AWAITING_APPROVAL', 'ESCALATED'],
      AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'SAFE_REFUSAL', 'ESCALATED'],
      APPROVED: ['EXECUTING', 'VERIFYING', 'AWAITING_APPROVAL', 'SAFE_REFUSAL', 'ESCALATED'],
      EXECUTING: ['VERIFYING', 'SAFE_REFUSAL'],
      VERIFYING: ['CLOSED_RESOLVED', 'REOPENED', 'ESCALATED'],
      REJECTED: ['CLOSED_NO_ACTION', 'ESCALATED'],
      SAFE_REFUSAL: ['CLOSED_ESCALATED'],
      ESCALATED: ['INVESTIGATING', 'AWAITING_APPROVAL', 'CLOSED_ESCALATED'],
      REOPENED: ['INVESTIGATING', 'AWAITING_APPROVAL', 'ESCALATED'],
      CLOSED_RESOLVED: ['REOPENED'],
      CLOSED_NO_ACTION: [],
      CLOSED_ESCALATED: [],
    };
    for (const from of Object.values(CaseStatus)) {
      expect(TRANSITIONS[from]).toEqual(expected[from]);
      for (const to of Object.values(CaseStatus)) {
        expect(TRANSITIONS[from].includes(to)).toBe(expected[from].includes(to));
      }
    }
  });

  it('covers routes and denies business mutation to ADMIN', () => {
    expect(() => assertRouteCoverage()).not.toThrow();
    expect(ROLE_PERMISSIONS[Role.ADMIN]).not.toContain('case:approve');
    expect(() => requirePermission({ roles: [Role.ADMIN] }, 'service:ingest')).toThrow();
    expect(() => requirePermission({ roles: [Role.ADMIN] }, 'integrity:dismiss')).toThrow();
    expect(() => requirePermission({ service: 'SERVICE_AGENT' }, 'case:read')).toThrow();
  });

  it('fails route coverage when an unlisted route is added', () => {
    const root = resolve('var', 'test-route-coverage');
    const route = join(root, 'v1', 'unlisted', 'route.ts');
    mkdirSync(join(root, 'v1', 'unlisted'), { recursive: true });
    try {
      writeFileSync(route, 'export const GET = () => new Response();\n');
      expect(() => assertRouteCoverage(root)).toThrow(/GET \/api\/v1\/unlisted/);
    } finally {
      if (root.startsWith(`${resolve('var')}\\`) || root.startsWith(`${resolve('var')}/`)) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
