import { LockKeyhole } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function SignInPanel() {
  return (
    <section
      className="w-full max-w-md border border-border bg-card p-8"
      aria-labelledby="sign-in-title"
    >
      <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background">
        <LockKeyhole className="size-5 text-primary" aria-hidden="true" />
      </div>
      <p data-instrument className="mt-8 text-xs text-muted-foreground">
        IDENTITY CONTROL
      </p>
      <h1 id="sign-in-title" className="mt-2 text-3xl font-medium">
        Sign in to Action Integrity
      </h1>
      <p className="mt-4 leading-6 text-muted-foreground">
        Production access uses your organisation&apos;s OIDC provider. Local credentials are enabled
        only in approved development environments.
      </p>
      <Button className="mt-8 w-full" size="lg" disabled aria-describedby="sso-status">
        Continue with SSO
      </Button>
      <p id="sso-status" className="mt-3 text-sm text-muted-foreground">
        Identity integration is configured in the authentication phase.
      </p>
    </section>
  );
}
