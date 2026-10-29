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
          <Link href="/" className="login-home-link">
            View product <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <svg
          className="login-wave"
          viewBox="0 0 1200 700"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="login-wave-primary" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#08212f" />
              <stop offset=".28" stopColor="#5295a8" />
              <stop offset=".48" stopColor="#0e1522" />
              <stop offset=".7" stopColor="#e32735" />
              <stop offset="1" stopColor="#2b1029" />
            </linearGradient>
            <linearGradient id="login-wave-highlight" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#225368" />
              <stop offset=".32" stopColor="#d9f4f5" />
              <stop offset=".56" stopColor="#48697d" />
              <stop offset=".82" stopColor="#f24d58" />
              <stop offset="1" stopColor="#dde7e7" />
            </linearGradient>
            <filter id="login-wave-blur">
              <feGaussianBlur stdDeviation="16" />
            </filter>
          </defs>
          <path
            className="login-wave-glow"
            d="M-80 490 C145 560 295 275 520 365 S885 600 1280 285"
            stroke="url(#login-wave-primary)"
            strokeWidth="76"
            filter="url(#login-wave-blur)"
          />
          <path
            className="login-wave-ribbon"
            d="M-80 480 C145 550 295 278 520 370 S885 590 1280 290"
            stroke="url(#login-wave-primary)"
            strokeWidth="30"
          />
          <path
            className="login-wave-ribbon login-wave-ribbon-alt"
            d="M-80 535 C165 425 275 475 525 390 S900 275 1280 410"
            stroke="url(#login-wave-primary)"
            strokeWidth="22"
          />
          <path
            className="login-wave-edge"
            d="M-80 460 C145 530 295 265 520 350 S885 575 1280 270"
            stroke="url(#login-wave-highlight)"
            strokeWidth="2"
          />
          <path
            className="login-wave-edge login-wave-edge-alt"
            d="M-80 522 C165 414 275 462 525 378 S900 263 1280 398"
            stroke="url(#login-wave-highlight)"
            strokeWidth="1.5"
          />
        </svg>
        <div className="login-grid">
          <div className="login-story">
            <p data-instrument className="login-kicker">
              ACTION INTEGRITY / ACCESS
            </p>
            <h2>Welcome back.</h2>
            <p className="login-description">
              Sign in to review held actions, continue investigations, and verify the result of each
              decision.
            </p>
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
      </div>
    </main>
  );
}
