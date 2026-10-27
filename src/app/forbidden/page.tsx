import { ShieldX } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function ForbiddenPage() {
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
        <Button render={<Link href="/" />} variant="outline" className="mt-8">
          Return home
        </Button>
      </section>
    </main>
  );
}
