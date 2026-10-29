import { notFound } from 'next/navigation';

import { PageFrame } from '@/components/console/PageFrame';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { db } from '@/lib/db';

export default async function PolicyDetailPage({
  params,
}: {
  readonly params: Promise<{ policyId: string }>;
}) {
  await pagePrincipalWith('policy:read');
  const { policyId } = await params;
  const policy = await db.policyVersion.findUnique({ where: { id: policyId } });
  if (!policy) notFound();
  return (
    <PageFrame
      eyebrow={`CONTROL / POLICY ${policy.version}`}
      title={`Policy ${policy.version}`}
      description="The signed document and hash behind the current decision rules. Editing and activation are reserved for a later control phase."
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="border border-border bg-card p-6">
          <h2 className="text-xl font-medium">Rule document</h2>
          <pre className="mt-5 overflow-auto border border-border bg-background p-4 font-mono text-xs leading-6">
            {JSON.stringify(policy.document, null, 2)}
          </pre>
        </section>
        <aside className="border border-border bg-card p-6">
          <h2 className="font-medium">Version record</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-operational-muted">Status</dt>
              <dd className="mt-1 font-mono">{policy.status}</dd>
            </div>
            <div>
              <dt className="text-operational-muted">Hash</dt>
              <dd className="mt-1 break-all font-mono text-xs">{policy.hash}</dd>
            </div>
            <div>
              <dt className="text-operational-muted">Review ticket</dt>
              <dd className="mt-1 font-mono text-xs">{policy.reviewTicket}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </PageFrame>
  );
}
