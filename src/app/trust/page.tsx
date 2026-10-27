import { ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

const safeguards = [
  'The model has no target-system write tool or credential.',
  'Deterministic policy owns risk, quorum, and allowed dispositions.',
  'Target writes are attempted once; unknown outcomes are verified by reading state.',
  'A case cannot close without a passing business-state verification.',
  'Every consequential transition is bound to an append-only audit record.',
];

export default function TrustPage() {
  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-[1200px] px-6 py-16">
      <Button render={<Link href="/" />} variant="ghost">
        <ArrowLeft aria-hidden="true" />
        Back
      </Button>
      <div className="mt-16 grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <LockKeyhole className="text-primary" aria-hidden="true" />
          <p data-instrument className="mt-8 text-xs text-muted-foreground">
            DETERMINISM BOUNDARY
          </p>
          <h1 className="mt-3 text-4xl font-medium">Reasoning recommends. Controls decide.</h1>
        </div>
        <div className="border border-border bg-card p-6">
          <ul>
            {safeguards.map((safeguard) => (
              <li
                key={safeguard}
                className="flex gap-4 border-b border-border py-5 first:pt-0 last:border-b-0 last:pb-0"
              >
                <ShieldCheck
                  className="mt-0.5 size-5 shrink-0 text-operational-success"
                  aria-hidden="true"
                />
                <span className="leading-6 text-muted-foreground">{safeguard}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
