import { expect, it } from 'vitest';

import { boundedRoute } from '@/lib/observability/metrics';

it('uses bounded metric labels for case and emergency routes', () => {
  expect(boundedRoute('POST', '/api/v1/cases/CASE-123/approve')).toBe('/api/v1/cases/:ref/approve');
  expect(boundedRoute('POST', '/api/v1/admin/break-glass/elevation-123/cosign')).toBe(
    '/api/v1/admin/break-glass/:id/cosign',
  );
  expect(boundedRoute('GET', '/api/v1/unknown/random-id')).toBe('/unmatched');
});
