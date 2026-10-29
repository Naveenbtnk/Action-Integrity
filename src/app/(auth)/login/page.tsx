import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignInPanel } from '@/components/auth/SignInPanel';
import { auth } from '@/lib/auth/config';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    next?: string;
    reason?: string;
    retry?: string;
    error?: string;
  }>;
}) {
  const session = await auth();
  if (session?.user?.id) {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { isActive: true, sessionEpoch: true },
    });
    if (user?.isActive && user.sessionEpoch === session.user.sessionEpoch)
      redirect('/app/overview');
  }
  const params = await searchParams;
  const nextPath =
    params.next?.startsWith('/') && !params.next.startsWith('//') && !params.next.includes('\\')
      ? params.next
      : '/app/overview';
  return (
    <main id="main-content" className="grid min-h-screen lg:grid-cols-2">
      <div className="flex min-h-[300px] flex-col justify-between border-b border-border bg-card p-8 lg:min-h-screen lg:border-b-0 lg:border-r lg:p-12">
        <Link href="/" className="text-sm font-medium tracking-[-0.04em]">
          ACTION INTEGRITY
        </Link>
        <div className="max-w-xl">
          <p data-instrument className="text-xs text-primary">
            DETECT / HOLD / VERIFY
          </p>
          <h2 className="mt-5 text-4xl font-medium leading-tight lg:text-[clamp(38px,3.2vw,52px)]">
            Every business action deserves a verified outcome.
          </h2>
          <p className="mt-6 max-w-lg text-base leading-7 text-operational-muted">
            A governed workflow for investigating uncertain data, separating approval from
            execution, and proving what changed in the target system.
          </p>
        </div>
        <p data-instrument className="text-xs text-operational-muted">
          EVIDENCE BEFORE CLOSURE
        </p>
      </div>
      <div className="grid place-items-center px-6 py-14 lg:px-12">
        <div className="w-full max-w-md">
          <SignInPanel
            nextPath={nextPath}
            credentialsEnabled={env.NODE_ENV !== 'production' && env.AUTH_CREDENTIALS_ENABLED}
            ssoEnabled={Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET)}
            reason={params.error ? 'provider_unreachable' : params.reason}
            retryAfter={params.retry}
          />
        </div>
      </div>
    </main>
  );
}
