import 'server-only';

import { context, trace } from '@opentelemetry/api';

import type {
  EntitlementState,
  RestorePointPayload,
  ServiceStateRecord,
  TargetAdapter,
  TargetChange,
  TargetRef,
  TargetWriteResult,
} from '@/lib/adapters/types';

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

export class TargetHttpClient implements TargetAdapter {
  constructor(
    private readonly options: { baseUrl: string; serviceKey: string; timeoutMs?: number },
  ) {}

  private headers(extra: Record<string, string> = {}): Headers {
    const headers = new Headers({ 'x-target-key': this.options.serviceKey, ...extra });
    const span = trace.getSpan(context.active())?.spanContext();
    if (span)
      headers.set(
        'traceparent',
        `00-${span.traceId}-${span.spanId}-${span.traceFlags.toString(16).padStart(2, '0')}`,
      );
    return headers;
  }

  private async read<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`/api/v1/target/${path}`, this.options.baseUrl);
    Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
    const response = await fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`TARGET_READ_${response.status}`);
    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.ok) throw new Error('TARGET_READ_INVALID_RESPONSE');
    return envelope.data as T;
  }

  private async write(
    path: string,
    payload: unknown,
    idempotencyKey: string,
  ): Promise<TargetWriteResult> {
    const url = new URL(`/api/v1/target/${path}`, this.options.baseUrl);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers({
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        }),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
      const envelope = (await response.json()) as Envelope<{
        result: TargetWriteResult;
        auditId: string | null;
        beforeState: unknown;
      }>;
      if (response.ok && envelope.ok && envelope.data)
        return { ...envelope.data.result, response: envelope.data };
      if (response.status >= 500 || envelope.data?.auditId)
        return {
          status: 'UNKNOWN',
          response: null,
          failureCode: envelope.error?.code ?? 'TARGET_RESPONSE_AMBIGUOUS',
        };
      return {
        status: 'FAILED',
        response: null,
        failureCode: envelope.error?.code ?? `TARGET_HTTP_${response.status}`,
      };
    } catch {
      return { status: 'UNKNOWN', response: null, failureCode: 'TARGET_RESPONSE_LOST' };
    }
  }

  getEntitlement(accountId: string, key: string): Promise<EntitlementState | null> {
    return this.read('entitlements', { accountId, key });
  }
  getServiceStatus(accountId: string): Promise<ServiceStateRecord | null> {
    return this.read('service-status', { accountId });
  }
  captureRestorePoint(ref: TargetRef): Promise<RestorePointPayload> {
    return this.read(
      'restore-point',
      ref.targetObjectType === 'entitlement'
        ? { targetObjectType: ref.targetObjectType, accountId: ref.accountId, key: ref.key }
        : { targetObjectType: ref.targetObjectType, accountId: ref.accountId },
    );
  }
  applyChange(change: TargetChange, idempotencyKey: string): Promise<TargetWriteResult> {
    return change.targetObjectType === 'entitlement'
      ? this.write(
          'entitlements/change',
          {
            accountId: change.accountId,
            entitlementKey: change.key,
            from: change.from,
            to: change.to,
          },
          idempotencyKey,
        )
      : this.write(
          'service-status/change',
          { accountId: change.accountId, from: change.from, to: change.to },
          idempotencyKey,
        );
  }
  restoreFromSnapshot(
    ref: TargetRef,
    snapshot: unknown,
    idempotencyKey: string,
  ): Promise<TargetWriteResult> {
    return ref.targetObjectType === 'entitlement'
      ? this.write(
          'entitlements/restore',
          { accountId: ref.accountId, entitlementKey: ref.key, snapshot },
          idempotencyKey,
        )
      : this.write(
          'service-status/restore',
          { accountId: ref.accountId, snapshot },
          idempotencyKey,
        );
  }
}
