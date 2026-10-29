import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignInPanel } from '@/components/auth/SignInPanel';
import { auth } from '@/lib/auth/config';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

import './login.css';

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
    <main id="main-content" className="login-page">
      <div className="login-shell">
        <div className="login-topbar">
          <Link href="/" className="login-brand">
            <span className="login-brand-mark" aria-hidden="true" />
            ACTION<span>/</span>INTEGRITY
          </Link>
          <span data-instrument>SECURE ENTRY / 01</span>
        </div>
        <div className="login-grid">
          <div className="login-story">
            <p data-instrument className="login-kicker">
              THE CONTROL ROOM
            </p>
            <h2>Decisions need evidence. Outcomes need proof.</h2>
            <p className="login-description">
              Enter the workspace for investigating conflicts, approving a governed response, and
              verifying the customer state.
            </p>
            <div className="login-sequence" aria-label="Control sequence">
              <div>
                <span>01</span>
                <strong>DETECT</strong>
                <small>Find the conflicting signal</small>
              </div>
              <div>
                <span>02</span>
                <strong>HOLD</strong>
                <small>Contain the exposed action</small>
              </div>
              <div>
                <span>03</span>
                <strong>VERIFY</strong>
                <small>Prove the business outcome</small>
              </div>
            </div>
          </div>
          <div className="login-form">
            <SignInPanel
              nextPath={nextPath}
              credentialsEnabled={env.NODE_ENV !== 'production' && env.AUTH_CREDENTIALS_ENABLED}
              ssoEnabled={Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET)}
              reason={params.error ? 'provider_unreachable' : params.reason}
              retryAfter={params.retry}
            />
          </div>
        </div>
        <div className="login-bottom" data-instrument>
          <span>EVIDENCE BEFORE ACTION</span>
          <span>VERIFICATION BEFORE CLOSURE</span>
        </div>
      </div>
    </main>
  );
}
