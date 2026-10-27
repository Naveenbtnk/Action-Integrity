import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logger: { error } }));
vi.mock('@/lib/observability/metrics', () => ({ recordHttpRequest: vi.fn() }));

import { withRoute } from '@/lib/http';

describe('route envelope', () => {
  beforeEach(() => error.mockClear());

  it('maps an unknown error safely and logs its cause once', async () => {
    const handler = withRoute(async () => {
      throw new Error('sensitive database details');
    });
    const response = await handler(
      new Request('http://localhost/api/v1/example', {
        headers: { 'x-request-id': 'req_test1234' },
      }),
    );
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req_test1234');
    expect(body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: 'req_test1234',
    });
    expect(JSON.stringify(body)).not.toContain('database');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({ requestId: 'req_test1234' });
  });

  it('requires every application route to use withRoute', async () => {
    const route = path.resolve(process.cwd(), 'src/app/api/v1/health/route.ts');
    expect(await readFile(route, 'utf8')).toContain('withRoute');
  });
});
