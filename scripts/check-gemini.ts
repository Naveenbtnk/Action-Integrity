import 'dotenv/config';

import { EvidenceKind } from '@/generated/prisma/enums';
import { generateJson } from '@/lib/agent/llm-client';
import { buildUserPrompt, SYSTEM_PROMPT } from '@/lib/agent/prompt';
import type { EvidenceBundle } from '@/lib/agent/types';
import { InvestigationReportSchema } from '@/lib/agent/types';
import { validateReport } from '@/lib/agent/validate';
import { env } from '@/lib/env';

const bundle: EvidenceBundle = {
  caseId: 'synthetic-check',
  caseRef: 'AIC-CHECK',
  accountIds: ['synthetic-account'],
  actionType: 'ENTITLEMENT_REVOKE',
  actionPayload: {},
  eventType: 'SEMANTIC',
  eventSummary: 'The proposed action conflicts with source records.',
  evidence: [
    {
      kind: EvidenceKind.CONTRACT_RECORD,
      ref: 'synthetic-contract',
      source: 'contract',
      stance: 'SUPPORTS',
      excerpt: 'A synthetic contract keeps the entitlement active.',
    },
    {
      kind: EvidenceKind.BILLING_RECORD,
      ref: 'synthetic-billing',
      source: 'billing',
      stance: 'CONTRADICTS',
      excerpt: 'A synthetic billing record shows the plan is current.',
    },
  ],
};

async function main() {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing.');
  const generated = await generateJson({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(bundle),
    schema: InvestigationReportSchema,
  });
  const report = validateReport(generated.data, bundle.evidence);
  if (report.uncitedClaims || report.citations.length === 0)
    throw new Error('Gemini output did not cite the supplied synthetic evidence.');
  process.stdout.write(
    JSON.stringify({
      result: 'pass',
      model: generated.usage.modelId,
      hypotheses: report.hypotheses.length,
      citations: report.citations.length,
      tokensReported: generated.usage.tokensUsed !== null,
    }) + '\n',
  );
}

main().catch(() => {
  process.stderr.write('Gemini check failed. Verify model access, key, and response schema.\n');
  process.exitCode = 1;
});
