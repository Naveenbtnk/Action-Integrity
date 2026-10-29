import { CaseWorkspace } from '@/components/console/CaseWorkspace';

export default async function InvestigationWorkspacePage({
  params,
}: {
  readonly params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  return <CaseWorkspace caseRef={caseId} />;
}
