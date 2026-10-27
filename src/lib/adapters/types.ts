import type { ServiceState, TargetEntitlementStatus } from '@/generated/prisma/enums';

export type SourceKey = 'contract' | 'billing' | 'usage' | 'support' | 'account';
export type SourceQuery = { accountId: string; limit: number };
export type SourceRecord = Readonly<Record<string, string | number | null>>;
export type SourceDescriptor = {
  key: SourceKey;
  schemaHash: string;
  rowCount: number;
  capturedAt: string;
};
export interface SourceAdapter {
  key: SourceKey;
  fetchRecords(q: SourceQuery): Promise<SourceRecord[]>;
  describe(): Promise<SourceDescriptor>;
}

export type TargetRef =
  | { targetObjectType: 'entitlement'; accountId: string; key: string }
  | { targetObjectType: 'service-status'; accountId: string };
export type EntitlementState = {
  accountId: string;
  key: string;
  status: TargetEntitlementStatus;
  grantedAt: string;
  revokedAt: string | null;
  sourceRef: string;
};
export type ServiceStateRecord = {
  accountId: string;
  state: ServiceState;
  reason: string;
};
export type RestorePointPayload = {
  state: EntitlementState | ServiceStateRecord | null;
  stateHash: string;
  capturedAt: string;
};
export type TargetChange =
  | {
      targetObjectType: 'entitlement';
      accountId: string;
      key: string;
      from?: TargetEntitlementStatus | undefined;
      to: TargetEntitlementStatus;
    }
  | {
      targetObjectType: 'service-status';
      accountId: string;
      from?: ServiceState | undefined;
      to: ServiceState;
    };
export type TargetWriteResult = {
  status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  response: unknown;
  failureCode?: string;
};
export interface TargetAdapter {
  getEntitlement(accountId: string, key: string): Promise<EntitlementState | null>;
  getServiceStatus(accountId: string): Promise<ServiceStateRecord | null>;
  captureRestorePoint(ref: TargetRef): Promise<RestorePointPayload>;
  applyChange(change: TargetChange, idempotencyKey: string): Promise<TargetWriteResult>;
  restoreFromSnapshot(
    ref: TargetRef,
    snapshot: unknown,
    idempotencyKey: string,
  ): Promise<TargetWriteResult>;
}
