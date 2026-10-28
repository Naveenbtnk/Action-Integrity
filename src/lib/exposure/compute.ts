import { OutboundActionStatus, OutboundActionType } from '@/generated/prisma/enums';

export type ExposureAction = {
  id: string;
  accountId: string;
  actionType: OutboundActionType;
  status: OutboundActionStatus;
  requestedAt: Date;
  restorePointId?: string | null;
  payload: unknown;
};

export type ExposureEvent = {
  detectedAt: Date;
  scopeSelector: unknown;
  contract: { sourceKey: string; fieldPath: string };
};

const ACTION_FIELDS: Record<OutboundActionType, readonly string[]> = {
  ENTITLEMENT_REVOKE: ['billing.planStatus', 'contract.status', 'contract.entitlementKey'],
  ENTITLEMENT_GRANT: ['billing.planStatus', 'contract.status', 'contract.entitlementKey'],
  ACCOUNT_STATUS_CHANGE: ['account.accountStatus'],
};

function selector(value: unknown): { accountIds: string[]; values: string[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (
    !Array.isArray(object.accountIds) ||
    !object.accountIds.every((item) => typeof item === 'string')
  )
    return null;
  const values =
    Array.isArray(object.values) && object.values.every((item) => typeof item === 'string')
      ? (object.values as string[])
      : [];
  return { accountIds: object.accountIds as string[], values };
}

export function computeExposure(
  event: ExposureEvent,
  actions: readonly ExposureAction[],
  config: { exposureWindowHours: number } = { exposureWindowHours: 24 },
): { actions: ExposureAction[]; accountIds: string[]; reasons: string[] } {
  const scope = selector(event.scopeSelector);
  if (!scope) return { actions: [], accountIds: [], reasons: ['INVALID_SCOPE_SELECTOR'] };
  const field = `${event.contract.sourceKey}.${event.contract.fieldPath}`;
  const matched: ExposureAction[] = [];
  const reasons = new Set<string>();
  for (const action of actions) {
    if (!ACTION_FIELDS[action.actionType].includes(field)) continue;
    if (scope.accountIds.length && !scope.accountIds.includes(action.accountId)) continue;
    if (
      Math.abs(action.requestedAt.getTime() - event.detectedAt.getTime()) >
      config.exposureWindowHours * 3_600_000
    )
      continue;
    if (
      action.status !== OutboundActionStatus.PENDING &&
      !(action.status === OutboundActionStatus.EXECUTED && action.restorePointId)
    )
      continue;
    matched.push(action);
    reasons.add('FIELD_OVERLAP');
    reasons.add('ACCOUNT_OVERLAP');
    reasons.add('EXPOSURE_WINDOW');
    reasons.add(
      action.status === OutboundActionStatus.EXECUTED
        ? 'RESTORE_POINT_AVAILABLE'
        : 'PENDING_ACTION',
    );
  }
  return {
    actions: matched,
    accountIds: [...new Set(matched.map((action) => action.accountId))].sort(),
    reasons: [...reasons].sort(),
  };
}
