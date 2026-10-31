import Link from 'next/link';

import { PageFrame } from '@/components/console/PageFrame';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { db } from '@/lib/db';

export default async function PoliciesPage() {
  await pagePrincipalWith('policy:read');
  const policies = await db.policyVersion.findMany({ orderBy: { createdAt: 'desc' } });
  return (
    <PageFrame
      eyebrow="CONTROL / 01"
      title="Policies"
      description="Review policy history and the active rules. Administrators can activate a reviewed draft from its version page."
    >
      {policies.length === 0 ? (
        <div className="border border-border bg-card p-8 text-sm text-operational-muted">
          No policy versions are registered.
        </div>
      ) : (
        <div className="space-y-3">
          {policies.map((policy) => (
            <Link
              key={policy.id}
              href={`/app/policies/${policy.id}`}
              className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-5 hover:border-primary"
            >
              <div>
                <p className="font-medium">Version {policy.version}</p>
                <p className="mt-1 break-all font-mono text-xs text-operational-muted">
                  {policy.hash}
                </p>
              </div>
              <span
                className={`border px-3 py-1 text-xs font-medium ${policy.status === 'ACTIVE' ? 'border-operational-success text-operational-success' : 'border-border text-operational-muted'}`}
              >
                {policy.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </PageFrame>
  );
}
