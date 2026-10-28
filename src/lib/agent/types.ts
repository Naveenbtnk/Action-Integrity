import { z } from 'zod';

import { Disposition, EvidenceKind, HypothesisVerdict } from '@/generated/prisma/enums';

export const CitationSchema = z
  .object({
    kind: z.enum(EvidenceKind),
    ref: z.string().min(1).max(200),
    excerpt: z.string().min(1).max(500),
  })
  .strict();

export const HypothesisSchema = z
  .object({
    statement: z.string().min(1).max(2_000),
    confidence: z.number().min(0).max(1),
    verdict: z.enum(HypothesisVerdict),
    supportingRefs: z.array(z.string().min(1)).max(20),
    contradictingRefs: z.array(z.string().min(1)).max(20),
  })
  .strict();

export const InvestigationReportSchema = z
  .object({
    recommendedDisposition: z.enum(Disposition),
    confidence: z.number().min(0).max(1),
    evidenceCompleteness: z.number().min(0).max(1),
    reasoning: z.string().min(1).max(8_000),
    hypotheses: z.array(HypothesisSchema).min(1).max(10),
    missingEvidence: z.array(z.string().min(1).max(500)).max(20),
    citations: z.array(CitationSchema).max(30),
    suspiciousContent: z.array(z.string().min(1).max(500)).max(20).default([]),
  })
  .strict();

export type InvestigationReportInput = z.infer<typeof InvestigationReportSchema>;
export type EvidenceRef = {
  kind: EvidenceKind;
  ref: string;
  excerpt: string;
  stance: 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';
  source: string;
};

export type EvidenceBundle = {
  caseId: string;
  caseRef: string;
  accountIds: string[];
  actionType: string;
  actionPayload: unknown;
  eventType: string;
  eventSummary: string;
  evidence: EvidenceRef[];
};
