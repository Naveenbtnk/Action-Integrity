import 'server-only';

import { metrics } from '@opentelemetry/api';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType } from '@/generated/prisma/enums';
import { Role } from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

const deniedCounter = metrics.getMeter('aic-web').createCounter('aic_authz_denied_total');

export const ROLES = Role;
export const PERMISSIONS = [
  'case:read',
  'action:read',
  'contract:read',
  'integrity:read',
  'kpi:read',
  'audit:read',
  'policy:read',
  'eval:read',
  'user:read',
  'ops:read',
  'integrity:dismiss',
  'case:investigate',
  'case:request_evidence',
  'case:add_evidence',
  'case:compute_policy',
  'case:approve',
  'case:approve_high',
  'case:execute',
  'case:execute_high',
  'case:verify',
  'case:reopen',
  'case:escalate',
  'kpi:refresh',
  'eval:run',
  'policy:activate',
  'user:manage',
  'ops:reconcile',
  'ops:outbox',
  'ops:anchor',
  'audit:verify',
  'break_glass:request',
  'break_glass:cosign',
  'break_glass:read',
  'service:ingest',
  'service:evaluate',
  'service:source_read',
  'service:target_read',
  'service:target_write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_COMMON: Permission[] = [
  'case:read',
  'action:read',
  'contract:read',
  'integrity:read',
  'kpi:read',
  'audit:read',
  'policy:read',
];
const ANALYST_WRITES: Permission[] = [
  'case:investigate',
  'case:request_evidence',
  'case:add_evidence',
  'case:compute_policy',
  'case:escalate',
];
const REVIEWER_WRITES: Permission[] = [
  'integrity:dismiss',
  'case:approve',
  'case:execute',
  'case:execute_high',
  'case:verify',
  'case:reopen',
];
const ADMIN_READS: Permission[] = ['eval:read', 'user:read', 'ops:read'];
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  VIEWER: READ_COMMON,
  ANALYST: [...READ_COMMON, ...ANALYST_WRITES],
  REVIEWER: [...READ_COMMON, ...ANALYST_WRITES, ...REVIEWER_WRITES],
  SENIOR_REVIEWER: [...READ_COMMON, ...ANALYST_WRITES, ...REVIEWER_WRITES, 'case:approve_high'],
  ADMIN: [
    ...READ_COMMON,
    ...ADMIN_READS,
    'kpi:refresh',
    'eval:run',
    'policy:activate',
    'user:manage',
    'ops:reconcile',
    'ops:outbox',
    'ops:anchor',
    'audit:verify',
    'break_glass:request',
    'break_glass:cosign',
    'break_glass:read',
  ],
  AUDITOR: [...READ_COMMON, ...ADMIN_READS, 'audit:verify', 'break_glass:read'],
};
export const SERVICE_PERMISSIONS = {
  SERVICE_AGENT: ['service:ingest', 'service:evaluate', 'service:source_read'],
  SERVICE_TARGET: ['service:target_read', 'service:target_write'],
  SERVICE_OPS: ['ops:reconcile', 'ops:outbox', 'ops:anchor'],
} as const satisfies Record<string, readonly Permission[]>;

export type Principal = { roles: Role[] } | { service: keyof typeof SERVICE_PERMISSIONS };

export function requirePermission(principal: Principal, permission: Permission): void {
  const granted =
    'service' in principal
      ? (SERVICE_PERMISSIONS[principal.service] as readonly Permission[]).includes(permission)
      : principal.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
  if (!granted) throw new ForbiddenError();
}

export async function requireHumanPermission(
  principal: { id: string; roles: Role[] },
  permission: Permission,
  requestId: string,
  traceId?: string,
): Promise<void> {
  try {
    requirePermission(principal, permission);
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    if (!permission.endsWith(':read')) {
      await db.$transaction(async (tx) => {
        await appendAuditEvent(tx as Prisma.TransactionClient, {
          eventType: 'AUTHZ_DENIED',
          actorType: ActorType.USER,
          actorId: principal.id,
          payload: { permission },
          requestId,
          traceId,
        });
      });
      deniedCounter.add(1, { permission });
    }
    throw error;
  }
}

export const ROUTE_PERMISSIONS: ReadonlyArray<{
  method: string;
  pattern: string;
  permission: Permission | 'public';
  rateLimit: string;
}> = [
  { method: 'GET', pattern: '/api/v1/health', permission: 'public', rateLimit: 'read' },
  {
    method: 'POST',
    pattern: '/api/v1/integrity/evaluate',
    permission: 'service:evaluate',
    rateLimit: 'integrity',
  },
  {
    method: 'GET',
    pattern: '/api/v1/integrity/events',
    permission: 'integrity:read',
    rateLimit: 'read',
  },
  {
    method: 'POST',
    pattern: '/api/v1/integrity/events/:id/dismiss',
    permission: 'integrity:dismiss',
    rateLimit: 'write',
  },
  {
    method: 'GET',
    pattern: '/api/v1/sources/:source/records',
    permission: 'service:source_read',
    rateLimit: 'sources',
  },
  {
    method: 'GET',
    pattern: '/api/v1/target/*',
    permission: 'service:target_read',
    rateLimit: 'target-read',
  },
  {
    method: 'POST',
    pattern: '/api/v1/target/*',
    permission: 'service:target_write',
    rateLimit: 'target-write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/actions/ingest',
    permission: 'service:ingest',
    rateLimit: 'ingest',
  },
  { method: 'GET', pattern: '/api/v1/actions', permission: 'action:read', rateLimit: 'read' },
  { method: 'GET', pattern: '/api/v1/actions/:id', permission: 'action:read', rateLimit: 'read' },
  { method: 'GET', pattern: '/api/v1/cases', permission: 'case:read', rateLimit: 'read' },
  { method: 'GET', pattern: '/api/v1/cases/:ref', permission: 'case:read', rateLimit: 'read' },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/investigate',
    permission: 'case:investigate',
    rateLimit: 'investigate',
  },
  {
    method: 'GET',
    pattern: '/api/v1/cases/:ref/report',
    permission: 'case:read',
    rateLimit: 'read',
  },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/evidence',
    permission: 'case:add_evidence',
    rateLimit: 'write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/evidence-requests',
    permission: 'case:request_evidence',
    rateLimit: 'write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/policy',
    permission: 'case:compute_policy',
    rateLimit: 'write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/approve',
    permission: 'case:approve',
    rateLimit: 'write',
  },
  {
    method: 'GET',
    pattern: '/api/v1/cases/:ref/approvals',
    permission: 'case:read',
    rateLimit: 'read',
  },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/escalate',
    permission: 'case:escalate',
    rateLimit: 'write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/execute',
    permission: 'case:execute',
    rateLimit: 'write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/verify',
    permission: 'case:verify',
    rateLimit: 'write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/cases/:ref/reopen',
    permission: 'case:reopen',
    rateLimit: 'write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/internal/reconcile',
    permission: 'ops:reconcile',
    rateLimit: 'write',
  },
  { method: 'GET', pattern: '/api/v1/admin/policy', permission: 'policy:read', rateLimit: 'read' },
  {
    method: 'POST',
    pattern: '/api/v1/admin/policy/activate',
    permission: 'policy:activate',
    rateLimit: 'write',
  },
  {
    method: 'GET',
    pattern: '/api/v1/admin/break-glass',
    permission: 'break_glass:read',
    rateLimit: 'read',
  },
  {
    method: 'POST',
    pattern: '/api/v1/admin/break-glass',
    permission: 'break_glass:request',
    rateLimit: 'write',
  },
  {
    method: 'GET',
    pattern: '/api/v1/admin/break-glass/:id',
    permission: 'break_glass:read',
    rateLimit: 'read',
  },
  {
    method: 'POST',
    pattern: '/api/v1/admin/break-glass/:id/cosign',
    permission: 'break_glass:cosign',
    rateLimit: 'write',
  },
  {
    method: 'POST',
    pattern: '/api/v1/admin/break-glass/:id/revoke',
    permission: 'break_glass:request',
    rateLimit: 'write',
  },
];
