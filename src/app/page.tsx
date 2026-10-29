import Link from 'next/link';

import { PublicShell, SignalVisual } from '@/components/public/public-shell';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Evidence before action',
  description:
    'Action Integrity holds exposed business actions when source evidence conflicts, then guides accountable recovery and verifies the customer outcome.',
};

const stages = [
  ['Detect', 'Compare incoming facts with the meaning declared by the business.'],
  ['Contain', 'Hold an exposed action before it reaches the target system.'],
  ['Investigate', 'Show cited records, disagreements and freshness in one case.'],
  ['Decide', 'Bind the disposition to policy and accountable human approval.'],
  ['Recover', 'Release or compensate through a bounded write path.'],
  ['Verify', 'Read the business state before closing the case.'],
];

export default function Home() {
  return (
    <PublicShell current="product">
      <section className="pub-hero">
        <div className="pub-wrap pub-hero-grid">
          <div className="pub-hero-copy">
            <p className="pub-eyebrow">
              <span className="pub-red-square" /> GOVERNED ACTION CONTROL{' '}
              <span className="pub-muted">/ PUBLIC 01</span>
            </p>
            <h1>
              Stop bad data before it becomes a <em>bad business action.</em>
            </h1>
            <p className="pub-lede">
              When evidence changes meaning, the next automated action should wait. See the
              conflict, contain the impact, and prove the customer state after recovery.
            </p>
            <div className="pub-actions">
              <Link className="pub-button" href="/login">
                Open control room <span aria-hidden="true">↗</span>
              </Link>
              <Link className="pub-button pub-button-outline" href="/trust">
                Examine the trust model <span aria-hidden="true">→</span>
              </Link>
            </div>
            <p className="pub-footnote">
              <span className="pub-green-dot" /> CONTROL BEFORE REASONING <span>/</span>{' '}
              VERIFICATION BEFORE CLOSURE
            </p>
          </div>
          <SignalVisual />
        </div>
        <div className="pub-wrap pub-hero-edge">
          <span>01 / THE PROBLEM</span>
          <a href="#problem">SCROLL TO EXPLORE ↓</a>
        </div>
      </section>

      <section id="problem" className="pub-section pub-tint">
        <div className="pub-wrap pub-two-col">
          <div>
            <p className="pub-index">01 / THE FAILURE PATH</p>
            <h2>Automation can run on time and still make the wrong decision.</h2>
          </div>
          <div className="pub-prose">
            <p>
              A subscription feed reports a status the contract does not recognize. A downstream
              workflow prepares to revoke a customer entitlement. An API success response would
              confirm delivery, but say nothing about whether the customer outcome is correct.
            </p>
            <p>
              Action Integrity puts a control boundary between conflicting evidence and the write.
              Operators can inspect the source, affected action, decision basis and path to a
              verified resolution.
            </p>
          </div>
        </div>
        <div className="pub-wrap pub-comparison">
          <div>
            <span>WITHOUT THE CONTROL</span>
            <p>
              Source drift <b>→</b> automated revoke <b>→</b> API 200
            </p>
            <small>CUSTOMER IMPACT UNKNOWN</small>
          </div>
          <div>
            <span>WITH ACTION INTEGRITY</span>
            <p>
              Source drift <b>→</b> hold <b>→</b> evidence <b>→</b> approval <b>→</b> verified state
            </p>
            <small>BUSINESS OUTCOME OBSERVED</small>
          </div>
        </div>
      </section>

      <section className="pub-section" id="system">
        <div className="pub-wrap">
          <div className="pub-section-intro">
            <div>
              <p className="pub-index">02 / THE CONTROL LOOP</p>
              <h2>Six stages. One accountable record.</h2>
            </div>
            <p>
              Every stage leaves evidence for the next. The model can explain and recommend.
              Deterministic controls decide whether an action may proceed.
            </p>
          </div>
          <ol className="pub-stage-grid">
            {stages.map(([title, detail], i) => (
              <li key={title}>
                <span>
                  {String(i + 1).padStart(2, '0')} <span aria-hidden="true">↗</span>
                </span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="pub-section pub-tint">
        <div className="pub-wrap pub-two-col pub-principles">
          <div>
            <p className="pub-index">03 / OPERATING PRINCIPLES</p>
            <h2>Built around the moment a decision matters.</h2>
            <Link className="pub-text-link" href="/trust">
              Read the operating model <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className="pub-principle-list">
            {[
              [
                'Evidence before recommendation',
                'Source records, conflicts and freshness remain visible beside each conclusion.',
              ],
              [
                'Human accountability',
                'Approval is bound to the evidence and policy version the reviewer saw.',
              ],
              [
                'One writer, explicit uncertainty',
                'A lost target response stays unknown until a read establishes the business state.',
              ],
              [
                'Closure requires proof',
                'Recovery completes only after verification observes the expected state.',
              ],
            ].map(([title, body], i) => (
              <article key={title}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pub-final">
        <div className="pub-wrap pub-final-inner">
          <div>
            <p className="pub-index">READY TO INSPECT THE CONTROL LOOP?</p>
            <h2>See the action. Trace the evidence. Verify the outcome.</h2>
          </div>
          <Link className="pub-button" href="/login">
            Open the control room <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
