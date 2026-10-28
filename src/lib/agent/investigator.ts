import 'server-only';

import { randomUUID } from 'node:crypto';

import { metrics } from '@opentelemetry/api';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType, CaseMode, CaseStatus } from '@/generated/prisma/enums';
import { buildEvidenceBundle } from '@/lib/agent/evidence';
import { deterministicInvestigation, suspiciousEvidence } from '@/lib/agent/fallback';
import { generateJson } from '@/lib/agent/llm-client';
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from '@/lib/agent/prompt';
import { InvestigationReportSchema } from '@/lib/agent/types';
import { validateReport } from '@/lib/agent/validate';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { sha } from '@/lib/integrity/hash';
import { withSpan } from '@/lib/observability/tracing';
import { transitionCase } from '@/lib/state-machine/case';

const meter = metrics.getMeter('aic-web');
const calls = meter.createCounter('aic_agent_calls_total');
const latency = meter.createHistogram('aic_agent_latency_seconds', { unit: 's' });

export async function investigate(
  caseId: string,
  actor: { id: string; requestId: string; traceId?: string | undefined },
  options: { force?: boolean } = {},
) {
  const started = performance.now();
  let outcome = 'fallback';
  return withSpan('agent.investigate', { 'aic.case_id': caseId }, async () => {
    try {
      const caseRow = await db.case.findUnique({ where: { id: caseId }, select: { status: true } });
      if (!caseRow) throw new AppError('NOT_FOUND', 404, 'Case not found.');
      if (
        !(
          [
            CaseStatus.HOLDING,
            CaseStatus.INVESTIGATING,
            CaseStatus.AWAITING_EVIDENCE,
          ] as CaseStatus[]
        ).includes(caseRow.status)
      ) {
        throw new AppError(
          'INVALID_TRANSITION',
          409,
          'Case cannot be investigated in its current state.',
        );
      }
      const bundle = await buildEvidenceBundle(caseId);
      const mode = env.INVESTIGATION_MODE === 'agent' ? CaseMode.AGENT : CaseMode.DETERMINISTIC;
      const evidenceHash = sha(bundle);
      const cacheKey = {
        caseId_evidenceHash_promptVersion_mode: {
          caseId,
          evidenceHash,
          promptVersion: PROMPT_VERSION,
          mode,
        },
      };
      const cached = await db.investigationReport.findUnique({
        where: cacheKey,
        include: { hypotheses: true },
      });
      if (cached) {
        if (options.force)
          throw new AppError('EVIDENCE_UNCHANGED', 409, 'Evidence has not changed.');
        outcome = 'cache';
        return { report: cached, cached: true };
      }
      let raw = deterministicInvestigation(bundle);
      let isFallback = true;
      let usage: { tokensUsed: number | null; modelId: string | null; retried: boolean } = {
        tokensUsed: null,
        modelId: null,
        retried: false,
      };
      if (mode === CaseMode.AGENT && env.GEMINI_API_KEY) {
        try {
          const generated = await generateJson({
            system: SYSTEM_PROMPT,
            user: buildUserPrompt(bundle),
            schema: InvestigationReportSchema,
          });
          raw = generated.data;
          usage = generated.usage;
          isFallback = false;
          outcome = 'success';
        } catch {
          outcome = 'fallback';
        }
      }
      const validated = validateReport(raw, bundle.evidence);
      const suspicious = suspiciousEvidence(bundle.evidence);
      validated.suspiciousContent = [...new Set([...validated.suspiciousContent, ...suspicious])];
      if (suspicious.length && validated.recommendedDisposition === 'RELEASE_AFTER_CORRECTION') {
        validated.recommendedDisposition = 'HOLD_FOR_EVIDENCE';
        validated.missingEvidence.push('Review instruction-like source content.');
      }
      const result = await db.$transaction(async (transaction) => {
        const tx = transaction as Prisma.TransactionClient;
        const current = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
        const transitionActor = {
          type: ActorType.USER,
          id: actor.id,
          requestId: actor.requestId,
          ...(actor.traceId ? { traceId: actor.traceId } : {}),
        };
        if (
          current.status === CaseStatus.HOLDING ||
          current.status === CaseStatus.AWAITING_EVIDENCE
        ) {
          await transitionCase(tx, caseId, CaseStatus.INVESTIGATING, transitionActor);
        }
        const report = await tx.investigationReport.create({
          data: {
            caseId,
            runId: randomUUID(),
            mode,
            recommendedDisposition: validated.recommendedDisposition,
            confidence: validated.confidence,
            evidenceCompleteness: validated.evidenceCompleteness,
            reasoning: validated.reasoning,
            missingEvidence: validated.missingEvidence,
            citations: validated.citations as Prisma.InputJsonValue,
            suspiciousContent: validated.suspiciousContent,
            uncitedClaims: validated.uncitedClaims,
            modelId: usage.modelId,
            promptVersion: PROMPT_VERSION,
            evidenceHash,
            isFallback,
            retried: usage.retried,
            tokensUsed: usage.tokensUsed,
            createdAt: new Date(),
            hypotheses: {
              create: validated.hypotheses.map((hypothesis, position) => ({
                caseId,
                position,
                statement: hypothesis.statement,
                confidence: hypothesis.confidence,
                verdict: hypothesis.verdict,
                supportingRefs: hypothesis.supportingRefs,
                contradictingRefs: hypothesis.contradictingRefs,
              })),
            },
          },
          include: { hypotheses: true },
        });
        await appendAuditEvent(tx, {
          eventType: 'INVESTIGATION_COMPLETED',
          actorType: ActorType.USER,
          actorId: actor.id,
          caseId,
          payload: { reportId: report.id, evidenceHash, isFallback },
          requestId: actor.requestId,
          traceId: actor.traceId,
        });
        if (isFallback)
          await appendAuditEvent(tx, {
            eventType: 'AGENT_FALLBACK_USED',
            actorType: ActorType.SERVICE,
            actorId: null,
            caseId,
            payload: {
              reportId: report.id,
              reason:
                mode === CaseMode.DETERMINISTIC
                  ? 'DETERMINISTIC_MODE'
                  : env.GEMINI_API_KEY
                    ? 'PROVIDER_FAILED'
                    : 'KEY_MISSING',
            },
            requestId: actor.requestId,
            traceId: actor.traceId,
          });
        await transitionCase(
          tx,
          caseId,
          validated.missingEvidence.length
            ? CaseStatus.AWAITING_EVIDENCE
            : CaseStatus.AWAITING_APPROVAL,
          transitionActor,
        );
        return report;
      });
      return { report: result, cached: false };
    } catch (cause) {
      outcome = 'failure';
      if (cause instanceof AppError) throw cause;
      throw new AppError('AGENT_UNAVAILABLE', 503, 'Investigation is unavailable.');
    } finally {
      calls.add(1, { outcome });
      latency.record((performance.now() - started) / 1_000, { outcome });
    }
  });
}
