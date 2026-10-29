import 'server-only';

import type { OutboundAction, RestorePoint } from '@/generated/prisma/client';

export function compensationEligibility(input: {
  action: OutboundAction;
  restorePoint: RestorePoint | null;
  targetExists: boolean;
  irreversibleActionTypes: readonly string[];
}): { eligible: boolean; reason: string | null } {
  if (input.irreversibleActionTypes.includes(input.action.actionType))
    return { eligible: false, reason: 'IRREVERSIBLE_ACTION' };
  if (!input.restorePoint) return { eligible: false, reason: 'NO_RESTORE_POINT' };
  if (!input.targetExists) return { eligible: false, reason: 'TARGET_OBJECT_MISSING' };
  return { eligible: true, reason: null };
}
