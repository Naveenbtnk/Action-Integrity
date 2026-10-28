import { describe, expect, it } from 'vitest';

import { Role } from '@/generated/prisma/enums';
import { requirePermission, ROLE_PERMISSIONS } from '@/lib/rbac';

describe('approval role boundaries', () => {
  it('never grants business approval to an administrator or auditor', () => {
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('case:approve');
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('case:execute');
    expect(ROLE_PERMISSIONS.AUDITOR).not.toContain('case:approve');
    expect(() => requirePermission({ roles: [Role.ADMIN] }, 'case:approve')).toThrow();
  });
  it('reserves high-risk approval for senior reviewers', () => {
    expect(ROLE_PERMISSIONS.REVIEWER).not.toContain('case:approve_high');
    expect(() =>
      requirePermission({ roles: [Role.SENIOR_REVIEWER] }, 'case:approve_high'),
    ).not.toThrow();
  });
});
