'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api/client';

interface Props {
  readonly version: string;
  readonly hash: string;
  readonly reviewTicket: string | null;
}

export function PolicyActivation({ version, hash, reviewTicket }: Props) {
  const router = useRouter();
  const [ticket, setTicket] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const requestKey = useRef<string | null>(null);

  async function activate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewTicket || ticket.trim() !== reviewTicket || confirmation.trim() !== version) {
      setError('Enter the registered review ticket and version exactly as shown.');
      return;
    }
    setBusy(true);
    setError('');
    requestKey.current ??= crypto.randomUUID();
    try {
      await apiFetch('/admin/policy/activate', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey.current },
        body: JSON.stringify({ version, hash, reviewTicket: ticket.trim() }),
      });
      requestKey.current = null;
      setSuccess(true);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `${cause.code}: ${cause.message}`
          : 'Activation could not be confirmed. Retry with the same review details.',
      );
      if (cause instanceof ApiError && cause.status === 401)
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 border border-border bg-card p-6" aria-labelledby="activate-policy">
      <h2 id="activate-policy" className="text-xl font-medium">
        Activate this version
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-operational-muted">
        Activation retires the current policy and supersedes approvals on open cases. Review the
        rule document and registered hash before continuing.
      </p>
      <form onSubmit={(event) => void activate(event)} className="mt-5 max-w-lg space-y-4">
        <label className="block text-sm" htmlFor="policy-review-ticket">
          Registered review ticket
        </label>
        <input
          id="policy-review-ticket"
          value={ticket}
          onChange={(event) => setTicket(event.target.value)}
          required
          autoComplete="off"
          className="h-10 w-full border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        />
        <label className="block text-sm" htmlFor="policy-confirm-version">
          Type {version} to confirm
        </label>
        <input
          id="policy-confirm-version"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          autoComplete="off"
          className="h-10 w-full border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        />
        {error && (
          <p role="alert" className="text-sm text-primary">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-operational-success">
            Policy activated. The page is refreshing.
          </p>
        )}
        <Button type="submit" disabled={busy || success || !reviewTicket}>
          {busy ? 'Activating…' : 'Activate policy'}
        </Button>
      </form>
    </section>
  );
}
