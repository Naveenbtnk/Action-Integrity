import 'server-only';

import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

let sdk: NodeSDK | undefined;

export async function registerTelemetry(): Promise<void> {
  if (env.OTEL_SDK_DISABLED === '1' || !env.OTEL_EXPORTER_OTLP_ENDPOINT || sdk) return;

  try {
    sdk = new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME,
      traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
    });
    await sdk.start();
  } catch (error) {
    sdk = undefined;
    logger.warn({ err: error }, 'telemetry.start_failed');
  }
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(env.OTEL_SERVICE_NAME);

  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error('Unknown span error'));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
