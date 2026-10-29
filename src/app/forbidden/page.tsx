import { ShieldX } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { pagePrincipal } from '@/lib/auth/page-principal';

export default async function ForbiddenPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ permission?: string; next?: string }>;
}) {
  const user = await pagePrincipal();
  const params = await searchParams;
  return (
    <main id="main-content" className="grid min-h-screen place-items-center px-6">
      <section className="max-w-lg border border-border bg-card p-8 text-center">
        <ShieldX className="mx-auto size-8 text-primary" aria-hidden="true" />
        <p data-instrument className="mt-6 text-xs text-muted-foreground">
          ACCESS DENIED
        </p>
        <h1 className="mt-2 text-3xl font-medium">You do not have permission for this surface.</h1>
        <p className="mt-4 text-muted-foreground">
          Access is denied by default. Contact an administrator if your assigned responsibilities
          require this capability.
        </p>
        <dl className="mt-6 space-y-2 border-t border-border pt-5 text-left text-sm">
          <div>
            <dt className="text-operational-muted">Required permission</dt>
            <dd className="font-mono">{params.permission ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-operational-muted">Held roles</dt>
            <dd className="font-mono">{user.roles.join(', ')}</dd>
          </div>
          {params.next && (
            <div>
              <dt className="text-operational-muted">Requested route</dt>
              <dd className="break-all font-mono">{params.next}</dd>
            </div>
          )}
        </dl>
        <Button render={<Link href="/app/overview" />} variant="outline" className="mt-8">
          Return to overview
        </Button>
      </section>
    </main>
  );
}
