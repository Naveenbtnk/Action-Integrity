import { afterEach, describe, expect, it, vi } from 'vitest';

import { TargetHttpClient } from '@/lib/adapters/target/http-client';

const client = new TargetHttpClient({
  baseUrl: 'http://target.example',
  serviceKey: 'test-service-key',
});

afterEach(() => vi.unstubAllGlobals());

describe('target HTTP writes', () => {
  it('calls once and returns UNKNOWN when the response is lost', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetch);
    const result = await client.applyChange(
      { targetObjectType: 'service-status', accountId: 'acc_1', to: 'BLOCKED' },
      'key-12345',
    );
    expect(result.status).toBe('UNKNOWN');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('calls once and reports a pre-commit rejection as FAILED', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: 'TARGET_STATE_CONFLICT' } }), {
        status: 409,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await client.applyChange(
      { targetObjectType: 'service-status', accountId: 'acc_1', to: 'BLOCKED' },
      'key-12345',
    );
    expect(result).toMatchObject({ status: 'FAILED', failureCode: 'TARGET_STATE_CONFLICT' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a committed non-2xx response as UNKNOWN without retry', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          data: { auditId: 'aud_1' },
          error: { code: 'UPSTREAM_ERROR' },
        }),
        { status: 502 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await client.applyChange(
      { targetObjectType: 'service-status', accountId: 'acc_1', to: 'BLOCKED' },
      'key-12345',
    );
    expect(result.status).toBe('UNKNOWN');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
