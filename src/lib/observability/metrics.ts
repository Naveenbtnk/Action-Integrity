import 'server-only';

import { metrics } from '@opentelemetry/api';

import { env } from '@/lib/env';
import { ROUTE_PERMISSIONS } from '@/lib/rbac';

const meter = metrics.getMeter(env.OTEL_SERVICE_NAME);

const httpRequests = meter.createCounter('aic_http_requests_total', {
  description: 'HTTP requests by bounded route, method, status, and outcome code.',
});

const httpDuration = meter.createHistogram('aic_http_request_duration_seconds', {
  description: 'HTTP request duration in seconds.',
  unit: 's',
});

const routeMatchers = ROUTE_PERMISSIONS.map(({ method, pattern }) => ({
  method,
  pattern,
  matcher: new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*')}$`),
}));

export function boundedRoute(method: string, pathname: string): string {
  return (
    routeMatchers.find((entry) => entry.method === method && entry.matcher.test(pathname))
      ?.pattern ?? '/unmatched'
  );
}

interface HttpMetricInput {
  readonly code: string;
  readonly durationMs: number;
  readonly method: string;
  readonly route: string;
  readonly status: number;
}

export function recordHttpRequest(input: HttpMetricInput): void {
  const attributes = {
    code: input.code,
    method: input.method,
    route: boundedRoute(input.method, input.route),
    status: String(input.status),
  };

  httpRequests.add(1, attributes);
  httpDuration.record(input.durationMs / 1_000, attributes);
}
