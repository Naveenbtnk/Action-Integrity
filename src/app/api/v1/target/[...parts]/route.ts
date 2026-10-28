import { z } from 'zod';

import { ServiceState, TargetEntitlementStatus } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { AppError, ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';
import { requireTargetKey } from '@/lib/target/auth';
import * as target from '@/lib/target/service';

const Account = z.string().min(1).max(128);
const Key = z.string().min(1).max(128);
const EntitlementChange = z
  .object({
    accountId: Account,
    entitlementKey: Key,
    from: z.enum(TargetEntitlementStatus).optional(),
    to: z.enum(TargetEntitlementStatus),
  })
  .strict();
const StatusChange = z
  .object({ accountId: Account, from: z.enum(ServiceState).optional(), to: z.enum(ServiceState) })
  .strict();
const EntitlementRestore = z
  .object({ accountId: Account, entitlementKey: Key, snapshot: z.unknown() })
  .strict();
const StatusRestore = z.object({ accountId: Account, snapshot: z.unknown() }).strict();

function parts(request: Request): string {
  return new URL(request.url).pathname.split('/target/')[1] ?? '';
}
function field(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value || value.length > 128) throw new ValidationError(`Invalid ${name}.`);
  return value;
}
function idempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key');
  if (!value) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key is required.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new ValidationError('Invalid Idempotency-Key.');
  return value;
}
async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid target request.');
  return parsed.data;
}

export const GET = withRoute(async (request, context) => {
  requireTargetKey(request);
  requirePermission({ service: 'SERVICE_TARGET' }, 'service:target_read');
  await enforceAdapterLimit('target-read', 'target');
  const path = parts(request);
  const url = new URL(request.url);
  if (path === 'entitlements')
    return successResponse(
      await target.getEntitlement(field(url, 'accountId'), field(url, 'key')),
      context,
    );
  if (path === 'service-status')
    return successResponse(await target.getServiceStatus(field(url, 'accountId')), context);
  if (path === 'restore-point') {
    const targetObjectType = field(url, 'targetObjectType');
    const accountId = field(url, 'accountId');
    if (targetObjectType === 'entitlement')
      return successResponse(
        await target.captureRestorePoint({ targetObjectType, accountId, key: field(url, 'key') }),
        context,
      );
    if (targetObjectType === 'service-status')
      return successResponse(
        await target.captureRestorePoint({ targetObjectType, accountId }),
        context,
      );
  }
  throw new ValidationError('Unknown target read.');
});

export const POST = withRoute(async (request, context) => {
  requireTargetKey(request);
  requirePermission({ service: 'SERVICE_TARGET' }, 'service:target_write');
  await enforceAdapterLimit('target-write', 'target');
  const key = idempotencyKey(request);
  const path = parts(request);
  let output;
  if (path === 'entitlements/change') {
    const input = await body(request, EntitlementChange);
    output = await target.applyChange(
      {
        targetObjectType: 'entitlement',
        accountId: input.accountId,
        key: input.entitlementKey,
        from: input.from,
        to: input.to,
      },
      key,
      context.requestId,
    );
  } else if (path === 'service-status/change') {
    const input = await body(request, StatusChange);
    output = await target.applyChange(
      { targetObjectType: 'service-status', ...input },
      key,
      context.requestId,
    );
  } else if (path === 'entitlements/restore') {
    const input = await body(request, EntitlementRestore);
    output = await target.restoreFromSnapshot(
      { targetObjectType: 'entitlement', accountId: input.accountId, key: input.entitlementKey },
      input.snapshot,
      key,
      context.requestId,
    );
  } else if (path === 'service-status/restore') {
    const input = await body(request, StatusRestore);
    output = await target.restoreFromSnapshot(
      { targetObjectType: 'service-status', accountId: input.accountId },
      input.snapshot,
      key,
      context.requestId,
    );
  } else throw new ValidationError('Unknown target write.');
  return successResponse(output, context);
});
