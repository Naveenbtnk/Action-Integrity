import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { handlers } from '@/lib/auth/config';
import { AppError } from '@/lib/errors';

function limiterIdentity(request: NextRequest): string {
  const source = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return createHash('sha256').update(source).digest('hex');
}

export const GET = async (request: NextRequest) => {
  try {
    await enforceAdapterLimit('read', `auth:${limiterIdentity(request)}`);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return NextResponse.json({ error: error.code }, { status: error.httpStatus });
  }
  return handlers.GET(request);
};

export const POST = async (request: NextRequest) => {
  try {
    await enforceAdapterLimit('auth', limiterIdentity(request));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const retryAfter =
      typeof error.details?.retryAfter === 'number' ? error.details.retryAfter : undefined;
    const failure = new URL('/login', request.url);
    failure.searchParams.set(
      'reason',
      error.code === 'RATE_LIMITED' ? 'rate_limited' : 'rate_limiter_unavailable',
    );
    if (retryAfter) failure.searchParams.set('retry', String(retryAfter));
    return NextResponse.json(
      { url: failure.toString() },
      {
        status: error.httpStatus,
        headers: retryAfter ? { 'Retry-After': String(retryAfter) } : {},
      },
    );
  }
  return handlers.POST(request);
};
