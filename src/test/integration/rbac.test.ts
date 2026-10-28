import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import {
  requireHumanPermission,
  requirePermission,
  ROLE_PERMISSIONS,
  ROUTE_PERMISSIONS,
} from '@/lib/rbac';
import { assertRouteCoverage } from '@/lib/rbac-coverage';

try {
  assertRouteCoverage();
  const common = [
    'case:read',
    'action:read',
    'contract:read',
    'integrity:read',
    'kpi:read',
    'audit:read',
    'policy:read',
  ] as const;
  for (const role of Object.values(Role)) {
    for (const permission of common)
      assert.doesNotThrow(() => requirePermission({ roles: [role] }, permission));
    for (const route of ROUTE_PERMISSIONS) {
      if (route.permission === 'public' || route.permission.startsWith('service:')) continue;
      const permission = route.permission;
      const granted = ROLE_PERMISSIONS[role].includes(permission);
      if (granted) assert.doesNotThrow(() => requirePermission({ roles: [role] }, permission));
      else assert.throws(() => requirePermission({ roles: [role] }, permission));
    }
  }
  assert.equal(ROLE_PERMISSIONS.ADMIN.includes('case:approve'), false);
  assert.equal(ROLE_PERMISSIONS.AUDITOR.includes('case:compute_policy'), false);
  await assert.rejects(
    db.user.create({
      data: {
        email: `invalid-${randomUUID()}@aic.local`,
        name: 'Invalid',
        roles: [Role.ADMIN, Role.SENIOR_REVIEWER],
      },
    }),
  );
  const viewer = await db.user.findUniqueOrThrow({ where: { email: 'viewer@aic.local' } });
  const requestId = `rbac_${randomUUID()}`;
  await assert.rejects(
    requireHumanPermission({ id: viewer.id, roles: viewer.roles }, 'case:approve', requestId),
  );
  assert.equal(await db.auditEvent.count({ where: { requestId, eventType: 'AUTHZ_DENIED' } }), 1);
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@aic.local' } });
  const adminRequestId = `rbac_${randomUUID()}`;
  await assert.rejects(
    requireHumanPermission({ id: admin.id, roles: admin.roles }, 'case:approve', adminRequestId),
  );
  assert.equal(
    await db.auditEvent.count({ where: { requestId: adminRequestId, eventType: 'AUTHZ_DENIED' } }),
    1,
  );
  process.stdout.write(
    'RBAC matrix, database role constraint, denial audit and route coverage: passed\n',
  );
} finally {
  await db.$disconnect();
}
