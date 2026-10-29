import { CaseQueue } from '@/components/console/CaseQueue';
import { PageFrame } from '@/components/console/PageFrame';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { listCases } from '@/lib/gate/queries';

export default async function RecoveriesPage() {
  await pagePrincipalWith('case:read');
  const result = await listCases({ disposition: 'COMPENSATE', limit: 100 });
  return (
    <PageFrame
      eyebrow="RESOLVE / 01"
      title="Recoveries"
      description="Compensation cases require an approved restore point, a separate executor, and a target observation before closure."
    >
      <CaseQueue cases={result.cases} basePath="/app/recoveries" />
    </PageFrame>
  );
}
