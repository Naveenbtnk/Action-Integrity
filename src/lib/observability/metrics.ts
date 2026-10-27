import 'server-only';

import { metrics } from '@opentelemetry/api';

import { env } from '@/lib/env';

const meter = metrics.getMeter(env.OTEL_SERVICE_NAME);

const httpRequests = meter.createCounter('aic_http_requests_total', {
  description: 'HTTP requests by bounded route, method, status, and outcome code.',
});

const httpDuration = meter.createHistogram('aic_http_request_duration_seconds', {
  description: 'HTTP request duration in seconds.',
  unit: 's',
});

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
    route: input.route,
    status: String(input.status),
  };

  httpRequests.add(1, attributes);
  httpDuration.record(input.durationMs / 1_000, attributes);
}
