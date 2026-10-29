import { z } from 'zod';

import type { Prisma } from '@/generated/prisma/client';
import { GateDecision, OutboundActionType } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { db } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { executeAllowedAction } from '@/lib/executor/allow';
import { ingestAction } from '@/lib/gate/ingest';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotencyExternal } from '@/lib/idempotency';
import { requirePermission } from '@/lib/rbac';
import { requireAgentKey } from '@/lib/target/auth';

const Body = z
  .object({
    sourceAgent: z.string().trim().min(1).max(128),
    accountId: z.string().regex(/^acc_\d{5}$/),
    actionType: z.enum(OutboundActionType),
    payload: z.unknown().refine((value) => value !== undefined),
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const POST = withRoute(async (request, context) => {
  requireAgentKey(request);
  requirePermission({ service: 'SERVICE_AGENT' }, 'service:ingest');
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid ingest request.');
  await enforceAdapterLimit('ingest', `agent:${parsed.data.accountId}`);
  const key = request.headers.get('idempotency-key') ?? '';
  const output = await withIdempotencyExternal<Record<string, unknown>>(
    request,
    'service-agent',
    parsed.data,
    async () => {
      const existing = await db.outboundAction.findUnique({ where: { idempotencyKey: key } });
      if (existing && existing.gateDecision !== GateDecision.ALLOW)
        throw new ConflictError('IDEMPOTENCY_IN_PROGRESS');
      const ingested = existing
        ? {
            action: existing,
            gate: { decision: existing.gateDecision, reasons: [] },
            execution: null,
            case: null,
            pendingExecutor: true,
          }
        : await db.$transaction((tx) =>
            ingestAction(tx as Prisma.TransactionClient, {
              ...parsed.data,
              payload: parsed.data.payload as Prisma.InputJsonValue,
              requestedAt: new Date(parsed.data.requestedAt),
              idempotencyKey: key,
              requestId: context.requestId,
              ...(context.traceId ? { traceId: context.traceId } : {}),
            }),
          );
      if (!ingested.pendingExecutor) return { status: 201, data: ingested };
      const executed = await executeAllowedAction({
        actionId: ingested.action.id,
        requestId: context.requestId,
        ...(context.traceId ? { traceId: context.traceId } : {}),
      });
      return {
        status: 201,
        data: {
          ...ingested,
          execution: executed.execution,
          verification: executed.verification,
          pendingExecutor: false,
        },
      };
    },
  );
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
