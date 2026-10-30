'use client';

import { ArrowRight, LockKeyhole } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

interface SignInPanelProps {
  readonly nextPath: string;
  readonly credentialsEnabled: boolean;
  readonly ssoEnabled: boolean;
  readonly reason?: string | undefined;
  readonly retryAfter?: string | undefined;
}

const seededEmails = [
  'analyst@aic.local',
  'reviewer@aic.local',
  'reviewer2@aic.local',
  'senior@aic.local',
  'viewer@aic.local',
  'admin@aic.local',
];

export function SignInPanel({
  nextPath,
  credentialsEnabled,
  ssoEnabled,
  reason,
  retryAfter,
}: SignInPanelProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    reason === 'session_stale'
      ? 'Your session changed. Sign in again to continue.'
      : reason === 'user_inactive'
        ? 'This account is inactive. Contact an administrator.'
        : reason === 'rate_limited'
          ? `Too many sign-in attempts. Try again in ${retryAfter ?? '60'} seconds.`
          : reason === 'rate_limiter_unavailable'
            ? 'Sign-in is temporarily unavailable because the rate limiter is offline.'
            : reason === 'provider_unreachable'
              ? 'The identity provider is temporarily unavailable.'
              : '',
  );

  async function submitCredentials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.ok) window.location.assign(nextPath);
      else if (result?.status === 429) {
        const retry = result.url ? new URL(result.url).searchParams.get('retry') : null;
        setError(`Too many sign-in attempts. Try again in ${retry ?? '60'} seconds.`);
      } else if (result?.status === 503) {
        setError('Sign-in is temporarily unavailable because the rate limiter is offline.');
      } else setError('Unable to sign in with those credentials.');
    } catch {
      setError('Sign-in is temporarily unavailable. Try again later.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="w-full border border-border bg-card p-6 lg:p-7"
      aria-labelledby="sign-in-title"
    >
      <div className="login-lock flex size-11 items-center justify-center border border-border bg-background">
        <LockKeyhole className="size-5 text-primary" aria-hidden="true" />
      </div>
      <h1 id="sign-in-title" className="mt-4 text-[28px] font-medium leading-tight">
        Sign in
      </h1>
      <p className="mt-3 text-sm leading-6 text-operational-muted">
        {ssoEnabled
          ? "Continue with your organization's identity provider."
          : credentialsEnabled
            ? 'Enter your local development credentials.'
            : 'Sign-in is unavailable in this environment.'}
      </p>
      <div role="alert" className={error ? 'mt-4 border border-primary p-3 text-sm' : 'sr-only'}>
        {error}
      </div>
      {ssoEnabled ? (
        <Button
          className="mt-6 h-10 w-full justify-between rounded-[4px] px-4"
          onClick={() => void signIn('corporate', { callbackUrl: nextPath })}
          disabled={busy}
        >
          Continue with SSO <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      ) : !credentialsEnabled ? (
        <p className="mt-6 border border-operational-warning/50 p-3 text-sm text-operational-warning">
          SSO is not configured for this environment.
        </p>
      ) : null}
      {credentialsEnabled && (
        <div className="mt-5 border-t border-border pt-5">
          <p data-instrument className="mb-3 text-xs text-operational-muted">
            LOCAL DEVELOPMENT
          </p>
          <form onSubmit={(event) => void submitCredentials(event)} className="space-y-3">
            <label className="block text-sm" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <label className="block text-sm" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              variant="outline"
              className="login-submit h-10 w-full rounded-[4px]"
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Sign in locally'}
            </Button>
          </form>
          <details className="login-demo-accounts mt-4">
            <summary>Demo accounts</summary>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Seeded local accounts">
              {seededEmails.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setEmail(item)}
                  className="border border-border px-2 py-1 font-mono text-[11px] text-operational-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.split('@')[0]}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}
      <p className="mt-5 text-xs leading-5 text-operational-muted">
        Need access? Contact your workspace administrator.
      </p>
    </section>
  );
}
