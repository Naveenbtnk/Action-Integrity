type FailureMode = 'timeout' | 'after-commit' | 'before-commit' | 'slow';
let pending: FailureMode | null = null;

export function setFailureMode(mode: FailureMode): void {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Failure injection is disabled in production.');
  pending = mode;
}

export function takeFailureMode(): FailureMode | null {
  if (process.env.NODE_ENV === 'production') return null;
  const mode = pending;
  pending = null;
  return mode;
}
