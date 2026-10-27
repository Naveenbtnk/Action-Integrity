import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main id="main-content" className="min-h-screen overflow-hidden bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="font-medium tracking-[-0.04em]">
            ACTION INTEGRITY
          </Link>
          <Button render={<Link href="/login" />} size="lg">
            Sign in
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </header>

      <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1200px] items-center gap-16 border-x border-border px-6 py-20 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="relative z-10 max-w-3xl">
          <div
            data-instrument
            className="mb-8 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
          >
            <span className="size-2 bg-primary" aria-hidden="true" />
            GOVERNED ACTION CONTROL
          </div>
          <h1 className="max-w-3xl text-5xl font-medium leading-[1.06] tracking-[-0.04em] sm:text-6xl">
            Stop unreliable data before it becomes a harmful business action.
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-8 text-muted-foreground">
            Hold exposed actions, investigate conflicting evidence, enforce accountable approval,
            recover safely, and verify the business state—not just the API response.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button render={<Link href="/login" />} size="lg">
              Open the control room
              <ArrowRight aria-hidden="true" />
            </Button>
            <Button render={<Link href="/trust" />} variant="outline" size="lg">
              Review the trust model
            </Button>
          </div>
        </div>

        <div className="relative z-10 border border-border bg-card p-6">
          <div className="flex items-center justify-between border-b border-border pb-5">
            <div>
              <p data-instrument className="text-xs text-muted-foreground">
                CONTROL LOOP
              </p>
              <p className="mt-1 text-xl font-medium">Evidence before action</p>
            </div>
            <ShieldCheck className="text-primary" aria-hidden="true" />
          </div>
          <ol className="mt-3">
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
                className="grid grid-cols-[36px_1fr_20px] items-center gap-3 border-b border-border py-4 last:border-b-0"
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
