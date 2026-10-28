import { GateDecision, OutboundActionStatus, OutboundActionType } from '@/generated/prisma/enums';
import { computeExposure, type ExposureEvent } from '@/lib/exposure/compute';

export type GateAction = {
  id: string;
  accountId: string;
  actionType: OutboundActionType;
  payload: unknown;
  requestedAt: Date;
};

type OpenEvent = ExposureEvent & { id: string; caseId?: string };

function validPayload(action: GateAction): boolean {
  if (!action.payload || typeof action.payload !== 'object' || Array.isArray(action.payload))
    return false;
  const payload = action.payload as Record<string, unknown>;
  if (action.actionType === OutboundActionType.ACCOUNT_STATUS_CHANGE) {
    return (
      typeof payload.from === 'string' &&
      typeof payload.to === 'string' &&
      payload.from !== payload.to
    );
  }
  return (
    typeof payload.entitlementKey === 'string' &&
    payload.entitlementKey.length > 0 &&
    typeof payload.from === 'string' &&
    typeof payload.to === 'string' &&
    payload.from !== payload.to
  );
}

export function decide(
  action: GateAction,
  context: {
    accountRegistered: boolean;
    openEvents: readonly OpenEvent[];
    policyConfig?: { exposureWindowHours: number };
  },
): { decision: GateDecision; reasons: string[]; eventId?: string; caseId?: string } {
  if (!validPayload(action))
    return { decision: GateDecision.BLOCK, reasons: ['MALFORMED_PAYLOAD'] };
  if (!context.accountRegistered)
    return { decision: GateDecision.BLOCK, reasons: ['UNKNOWN_ACCOUNT'] };
  for (const event of context.openEvents) {
    const exposure = computeExposure(
      event,
      [{ ...action, status: OutboundActionStatus.PENDING }],
      context.policyConfig,
    );
    if (exposure.actions.length)
      return {
        decision: GateDecision.HOLD,
        reasons: exposure.reasons,
        eventId: event.id,
        ...(event.caseId ? { caseId: event.caseId } : {}),
      };
  }
  return { decision: GateDecision.ALLOW, reasons: [] };
}
