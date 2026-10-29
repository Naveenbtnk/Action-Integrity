export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const nextActions: Record<string, string> = {
  APPROVAL_QUORUM_NOT_MET: 'Wait for the missing independent approval.',
  APPROVER_CANNOT_EXECUTE: 'Ask another reviewer to complete this step.',
  APPROVAL_EXPIRED: 'Re-approve under a current decision packet.',
  EVIDENCE_CHANGED: 'Re-run investigation and re-approve the current evidence.',
  POLICY_STALE: 'Refresh the policy decision and collect new approvals.',
  BREAK_GLASS_INCOMPLETE: 'Complete the separate co-sign before acting.',
  DEGRADATION_BLOCKED: 'Wait for the affected dependency to recover.',
  TARGET_UNAVAILABLE: 'Keep the case open and ask operations to restore target access.',
  RATE_LIMITER_UNAVAILABLE: 'Contact operations; mutation is blocked until the limiter recovers.',
};

export function nextActionForError(code: string): string {
  return nextActions[code] ?? 'Refresh the case state before taking another action.';
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{
  data: T;
  replayed: boolean;
}> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const envelope: unknown = await response.json().catch(() => null);
  if (!envelope || typeof envelope !== 'object')
    throw new ApiError(
      'INVALID_RESPONSE',
      'The server returned an invalid response.',
      undefined,
      response.status,
    );
  const value = envelope as {
    ok?: boolean;
    data?: T;
    error?: { code?: string; message?: string; requestId?: string };
    meta?: { replayed?: boolean };
  };
  if (!response.ok || !value.ok) {
    throw new ApiError(
      value.error?.code ?? 'REQUEST_FAILED',
      value.error?.message ?? 'The request could not be completed.',
      value.error?.requestId,
      response.status,
    );
  }
  return { data: value.data as T, replayed: Boolean(value.meta?.replayed) };
}
