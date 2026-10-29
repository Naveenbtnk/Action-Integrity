import Link from 'next/link';

import './public.css';
import './public-hud.css';

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
      aria-label="Illustration: a conflicting source signal is detected, an exposed action is held, and recovery awaits verified evidence"
    >
      <div className="pub-hud-header" aria-hidden="true">
        <span>CONTROL TRACE / AIC-001</span>
        <span>
          <i /> CONFLICT DETECTED
        </span>
      </div>
      <div className="pub-hud-content" aria-hidden="true">
        <div className="pub-hud-panel pub-hud-panel-left">
          <span className="pub-hud-panel-label">EXPOSURE / RISK</span>
          <div className="pub-hud-bars">
            {[46, 71, 58, 85, 36].map((height, index) => (
              <span key={index} style={{ '--bar-height': `${height}%` } as React.CSSProperties} />
            ))}
          </div>
          <span className="pub-hud-panel-rule" />
          <strong>HELD STATUS: ACTIVE</strong>
          <small>Source meaning disputed</small>
          <small>Target write blocked</small>
        </div>
        <div className="pub-hud-radar">
          <div className="pub-hud-crosshair" />
          <div className="pub-hud-scan" />
          <div className="pub-hud-ring pub-hud-ring-outer" />
          <div className="pub-hud-ring pub-hud-ring-middle" />
          <div className="pub-hud-ring pub-hud-ring-inner" />
          <div className="pub-hud-ticks" />
          <div className="pub-hud-core">
            <span className="pub-hud-hold-icon">H</span>
            <strong>ACTION HELD</strong>
          </div>
          <span className="pub-hud-radar-dot pub-hud-dot-a" />
          <span className="pub-hud-radar-dot pub-hud-dot-b" />
          <span className="pub-hud-radar-dot pub-hud-dot-c" />
        </div>
        <div className="pub-hud-panel pub-hud-panel-right">
          <span className="pub-hud-panel-label">RECOVERY / VERIFY</span>
          <div className="pub-hud-matrix">
            {Array.from({ length: 24 }, (_, index) => (
              <i
                key={index}
                className={index % 7 === 0 ? 'is-alert' : index % 3 === 0 ? 'is-ready' : ''}
              />
            ))}
          </div>
          <span className="pub-hud-panel-rule" />
          <strong>RELEASE GATE: CLOSED</strong>
          <small>Evidence review required</small>
          <small>Verification pending</small>
        </div>
      </div>
      <div className="pub-hud-footer" aria-hidden="true">
        <span>
          <i /> EVIDENCE REQUIRED BEFORE RELEASE
        </span>
        <small>ILLUSTRATIVE VIEW</small>
      </div>
    </div>
  );
}
