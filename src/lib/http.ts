import 'server-only';

import { randomUUID } from 'node:crypto';

import { trace } from '@opentelemetry/api';
import { NextResponse } from 'next/server';

import { AppError } from '@/lib/errors';
import { logger } from '@/lib/observability/logger';
import { recordHttpRequest } from '@/lib/observability/metrics';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export interface RouteContext {
  readonly requestId: string;
  readonly traceId?: string;
}

export type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>;

function requestIdFor(request: Request): string {
  const supplied = request.headers.get('x-request-id');
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : `req_${randomUUID()}`;
}

function traceId(): string | undefined {
  const value = trace.getActiveSpan()?.spanContext().traceId;
  return value && value !== '00000000000000000000000000000000' ? value : undefined;
}

function errorResponse(error: AppError, requestId: string): NextResponse {
  const details = error.details ? { details: error.details } : {};
  return NextResponse.json(
    {
      ok: false,
      error: { code: error.code, message: error.message, ...details, requestId },
    },
    { status: error.httpStatus },
  );
}

export function withRoute(handler: RouteHandler): (request: Request) => Promise<Response> {
  return async (request) => {
    const startedAt = performance.now();
    const requestId = requestIdFor(request);
    const currentTraceId = traceId();
    let status = 500;
    let code = 'INTERNAL_ERROR';

    try {
      const context: RouteContext = currentTraceId
        ? { requestId, traceId: currentTraceId }
        : { requestId };
      const response = await handler(request, context);
      status = response.status;
      code = status < 400 ? 'OK' : `HTTP_${status}`;
      response.headers.set('x-request-id', requestId);
      return response;
    } catch (cause) {
      if (cause instanceof AppError) {
        status = cause.httpStatus;
        code = cause.code;
        const response = errorResponse(cause, requestId);
        response.headers.set('x-request-id', requestId);
        return response;
      }

      logger.error(
        {
          err: cause,
          method: request.method,
          requestId,
          route: new URL(request.url).pathname,
          traceId: currentTraceId,
        },
        'request.unhandled_error',
      );
      const response = errorResponse(
        new AppError('INTERNAL_ERROR', 500, 'An unexpected error occurred.'),
        requestId,
      );
      response.headers.set('x-request-id', requestId);
      return response;
    } finally {
      recordHttpRequest({
        code,
        durationMs: performance.now() - startedAt,
        method: request.method,
        route: new URL(request.url).pathname,
        status,
      });
    }
  };
}

export function successResponse<T>(
  data: T,
  context: RouteContext,
  options: { readonly replayed?: boolean; readonly status?: number } = {},
): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      data,
      meta: {
        requestId: context.requestId,
        ...(context.traceId ? { traceId: context.traceId } : {}),
        ...(options.replayed === undefined ? {} : { replayed: options.replayed }),
      },
    },
    { status: options.status ?? 200 },
  );
}
