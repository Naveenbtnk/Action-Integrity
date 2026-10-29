import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';

export default async function Home() {
  await connection();
  const publicSite =
    env.PUBLIC_SITE_URL || (env.NODE_ENV === 'development' ? 'http://localhost:4321' : null);
  if (publicSite) {
    if (env.NODE_ENV === 'production') redirect(publicSite);
    const available = await fetch(publicSite, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(1_000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (available) redirect(publicSite);
  }
  return (
    <main id="main-content" className="min-h-screen overflow-hidden bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="font-medium tracking-[-0.04em]">
            ACTION INTEGRITY
          </Link>
          <Button nativeButton={false} render={<Link href="/login" />} size="lg">
            Sign in
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-[1200px] items-center gap-10 border-x border-border px-5 py-12 sm:px-8 lg:gap-12 lg:py-16 xl:min-h-[min(680px,calc(100vh-4rem))] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="relative z-10 min-w-0 max-w-2xl">
          <div
            data-instrument
            className="mb-5 inline-flex items-center gap-2 border border-border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground"
          >
            <span className="size-2 bg-primary" aria-hidden="true" />
            GOVERNED ACTION CONTROL
          </div>
          <h1 className="max-w-[19ch] text-[clamp(2.25rem,3vw,3.25rem)] font-medium leading-[1.1] tracking-[-0.04em]">
            Stop unreliable data before it becomes a harmful business action.
          </h1>
          <p className="mt-5 max-w-[60ch] text-base leading-7 text-muted-foreground">
            Hold exposed actions, investigate conflicting evidence, enforce accountable approval,
            recover safely, and verify the business state—not just the API response.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button nativeButton={false} render={<Link href="/login" />} size="lg">
              Open the control room
              <ArrowRight aria-hidden="true" />
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/trust" />}
              variant="outline"
              size="lg"
            >
              Review the trust model
            </Button>
          </div>
        </div>

        <div className="relative z-10 min-w-0 border border-border bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <p data-instrument className="text-xs text-muted-foreground">
                CONTROL LOOP
              </p>
              <p className="mt-1 text-lg font-medium">Evidence before action</p>
            </div>
            <ShieldCheck className="text-primary" aria-hidden="true" />
          </div>
          <ol className="mt-2">
            {[
              'Detect unreliable evidence',
              'Hold the exposed action',
              'Investigate and cite',
              'Approve with quorum',
              'Release or compensate',
              'Verify business state',
            ].map((step, index) => (
              <li
                key={step}
                className="grid grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-3 border-b border-border py-2.5 last:border-b-0"
              >
                <span data-instrument className="text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-sm">{step}</span>
                <CheckCircle2 className="size-4 text-operational-success" aria-hidden="true" />
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
