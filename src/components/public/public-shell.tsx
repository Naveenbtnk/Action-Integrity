import Link from 'next/link';

import './public.css';

export function PublicShell({
  children,
  current,
}: {
  children: React.ReactNode;
  current: 'product' | 'trust';
}) {
  return (
    <div className="pub-site">
      <header className="pub-header">
        <div className="pub-wrap pub-header-inner">
          <Link className="pub-logo" href="/" aria-label="Action Integrity home">
            <span className="pub-logo-mark" aria-hidden="true">
              <i />
            </span>
            <span>
              ACTION<span className="pub-logo-slash">/</span>INTEGRITY
            </span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link href="/" aria-current={current === 'product' ? 'page' : undefined}>
              Product
            </Link>
            <Link href="/trust" aria-current={current === 'trust' ? 'page' : undefined}>
              Trust model
            </Link>
          </nav>
          <Link className="pub-header-cta" href="/login">
            Open control room <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="pub-footer">
        <div className="pub-wrap pub-footer-grid">
          <div>
            <Link className="pub-logo" href="/">
              <span className="pub-logo-mark" aria-hidden="true">
                <i />
              </span>
              <span>
                ACTION<span className="pub-logo-slash">/</span>INTEGRITY
              </span>
            </Link>
            <p>Evidence before action. Verification before closure.</p>
          </div>
          <nav aria-label="Footer navigation">
            <Link href="/">Product</Link>
            <Link href="/trust">Trust model</Link>
            <Link href="/login">Control room</Link>
          </nav>
          <p className="pub-footer-meta">
            PUBLIC SYSTEM / 2026
            <br />
            Built for accountable action.
          </p>
        </div>
      </footer>
    </div>
  );
}

export function SignalVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`pub-signal ${compact ? 'pub-signal-compact' : ''}`}
      role="img"
      aria-label="An unreliable source signal is stopped before it can trigger an exposed action"
    >
      <div className="pub-signal-glow" aria-hidden="true" />
      <div className="pub-signal-ring pub-signal-ring-one" aria-hidden="true" />
      <div className="pub-signal-ring pub-signal-ring-two" aria-hidden="true" />
      <div className="pub-signal-axis" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="pub-signal-node pub-node-source">
        <span>01 / SOURCE</span>
        <strong>CONFLICT DETECTED</strong>
        <small>BILLING · PLAN STATUS</small>
      </div>
      <div className="pub-signal-node pub-node-action">
        <span>02 / ACTION</span>
        <strong>ACCESS REVOKE</strong>
        <small>PROPOSED WRITE</small>
      </div>
      <div className="pub-signal-core">
        <span className="pub-core-icon" aria-hidden="true">
          ⊣
        </span>
        <strong>ACTION HELD</strong>
        <small>TARGET STATE UNCHANGED</small>
      </div>
      <div className="pub-signal-caption">
        <span className="pub-red-square" /> EVIDENCE REQUIRED BEFORE RELEASE
      </div>
    </div>
  );
}
