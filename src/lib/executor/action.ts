import 'server-only';

import { z } from 'zod';

import type { OutboundAction } from '@/generated/prisma/client';
import {
  OutboundActionType,
  ServiceState,
  TargetEntitlementStatus,
} from '@/generated/prisma/enums';
import type { TargetChange, TargetRef } from '@/lib/adapters/types';
import { ValidationError } from '@/lib/errors';

const EntitlementPayload = z.object({
  entitlementKey: z.string().min(1),
  from: z.enum(TargetEntitlementStatus),
  to: z.enum(TargetEntitlementStatus),
});
const ServicePayload = z.object({
  from: z.enum(ServiceState),
  to: z.enum(ServiceState),
});

export function targetChange(action: OutboundAction): TargetChange {
  if (action.actionType === OutboundActionType.ACCOUNT_STATUS_CHANGE) {
    const payload = ServicePayload.safeParse(action.payload);
    if (!payload.success) throw new ValidationError('Invalid service action payload.');
    return {
      targetObjectType: 'service-status',
      accountId: action.accountId,
      ...payload.data,
    };
  }
  const payload = EntitlementPayload.safeParse(action.payload);
  if (!payload.success) throw new ValidationError('Invalid entitlement action payload.');
  return {
    targetObjectType: 'entitlement',
    accountId: action.accountId,
    key: payload.data.entitlementKey,
    from: payload.data.from,
    to: payload.data.to,
  };
}

export function targetRef(change: TargetChange): TargetRef {
  return change.targetObjectType === 'entitlement'
    ? { targetObjectType: 'entitlement', accountId: change.accountId, key: change.key }
    : { targetObjectType: 'service-status', accountId: change.accountId };
}

export function objectRef(ref: TargetRef): string {
  return ref.targetObjectType === 'entitlement' ? `${ref.accountId}:${ref.key}` : ref.accountId;
}
