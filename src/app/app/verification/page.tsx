import { CaseQueue } from '@/components/console/CaseQueue';
import { PageFrame } from '@/components/console/PageFrame';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { listCases } from '@/lib/gate/queries';

export default async function VerificationPage() {
  await pagePrincipalWith('case:read');
  const [pending, reopened] = await Promise.all([
    listCases({ status: 'VERIFYING', limit: 100 }),
    listCases({ status: 'REOPENED', limit: 100 }),
  ]);
  return (
    <PageFrame
      eyebrow="RESOLVE / 02"
      title="Verification"
      description="A target response alone cannot close a case. Observe expected and actual business state here."
    >
      <div className="space-y-8">
        <section>
          <h2 className="mb-4 text-xl font-medium">Awaiting observation</h2>
          <CaseQueue cases={pending.cases} />
        </section>
        <section>
          <h2 className="mb-4 text-xl font-medium">Target mismatch · reopened</h2>
          <CaseQueue cases={reopened.cases} />
        </section>
      </div>
    </PageFrame>
  );
}
