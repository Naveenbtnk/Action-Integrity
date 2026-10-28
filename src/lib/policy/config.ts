import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { PolicyVersion } from '@/generated/prisma/client';
import { Disposition, OutboundActionType } from '@/generated/prisma/enums';
import { canonicalJson } from '@/lib/canonical-json';
import { env } from '@/lib/env';
import { ConflictError } from '@/lib/errors';

const PolicySchema = z
  .object({
    version: z.string(),
    exposureWindowHours: z.number().positive(),
    evidenceCompletenessMinimum: z.number().min(0).max(1),
    confidenceMinimum: z.number().min(0).max(1),
    riskBands: z.object({ approvalRequired: z.number().int(), highRisk: z.number().int() }),
    quorum: z.object({
      highRiskApprovals: z.number().int().min(2),
      exposureThreshold: z.number().int(),
      approvalWindowHours: z.number().positive(),
    }),
    valueThresholdsMinor: z.object({ mandatoryApproval: z.number().nonnegative() }),
    irreversibleActionTypes: z.array(z.enum(OutboundActionType)),
    allowedDispositions: z.record(z.enum(OutboundActionType), z.array(z.enum(Disposition))),
  })
  .strict();

export type PolicyConfig = z.infer<typeof PolicySchema>;

export function canonicalPolicyHash(document: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(document)).digest('hex')}`;
}

export async function loadPolicyFile(version: string): Promise<PolicyConfig> {
  if (!/^\d{4}\.\d{1,2}\.\d+$/.test(version)) throw new ConflictError('POLICY_UNAVAILABLE');
  const file = path.resolve(process.cwd(), env.POLICY_DIR, `${version}.json`);
  let document: unknown;
  try {
    document = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new ConflictError('POLICY_UNAVAILABLE', 'Policy document is unavailable.');
  }
  const parsed = PolicySchema.safeParse(document);
  if (!parsed.success || parsed.data.version !== version)
    throw new ConflictError('POLICY_UNAVAILABLE', 'Policy document is invalid.');
  return parsed.data;
}

export async function verifiedPolicy(row: PolicyVersion): Promise<PolicyConfig> {
  const file = await loadPolicyFile(row.version);
  const fileHash = canonicalPolicyHash(file);
  if (row.hash !== fileHash || canonicalPolicyHash(row.document) !== fileHash)
    throw new ConflictError(
      'POLICY_HASH_MISMATCH',
      'Policy document hash differs from the registered version.',
    );
  return file;
}
