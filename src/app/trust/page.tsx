import Link from 'next/link';

import { PublicShell, SignalVisual } from '@/components/public/public-shell';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trust model',
  description:
    'The control boundaries, human accountability and release status behind Action Integrity.',
};

const controls = [
  [
    'The model does not write',
    'An investigator can assemble cited hypotheses and recommendations. Deterministic controls decide whether an action is permitted.',
  ],
  [
    'A single write path',
    'The executor is the only caller allowed to initiate a target write. An uncertain outcome stays unknown until a state read resolves it.',
  ],
  [
    'Approval bound to evidence',
    'Review applies to a specific evidence set, report, disposition and policy version. A changed basis requires another review.',
  ],
  [
    'Verification before closure',
    'The observed business state must match the expected state. HTTP success alone does not resolve a case.',
  ],
  [
    'Audit beside the effect',
    'Consequential decisions append audit events in the same business transaction. An outbox handles follow-up delivery.',
  ],
];

export default function TrustPage() {
  return (
    <PublicShell current="trust">
      <section className="pub-hero pub-trust-hero">
        <div className="pub-wrap pub-hero-grid">
          <div className="pub-hero-copy">
            <p className="pub-eyebrow">
              <span className="pub-red-square" /> PUBLIC SYSTEM / TRUST MODEL
            </p>
            <h1>
              The control boundary is <em>the product.</em>
            </h1>
            <p className="pub-lede">
              Action Integrity is designed to make a harmful automated decision harder to execute
              and easier to examine. These rules are testable system boundaries, not promises a
              polished interface can prove by itself.
            </p>
            <Link className="pub-text-link" href="#boundaries">
              Explore the boundaries <span aria-hidden="true">↓</span>
            </Link>
          </div>
          <SignalVisual compact />
        </div>
      </section>
      <section id="boundaries" className="pub-section">
        <div className="pub-wrap">
          <p className="pub-index">01 / SAFETY BOUNDARIES</p>
          <h2>Five rules across the action lifecycle.</h2>
          <div className="pub-control-list">
            {controls.map(([title, body], i) => (
              <article key={title}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="pub-section pub-tint">
        <div className="pub-wrap pub-two-col">
          <div>
            <p className="pub-index">02 / HUMAN ACCOUNTABILITY</p>
            <h2>A platform role is not business consent.</h2>
          </div>
          <div className="pub-prose">
            <p>
              Reviewers approve a disposition against the evidence they saw. Higher-risk actions
              require distinct people and role coverage. The person taking a post-approval action
              cannot be one of its approvers.
            </p>
            <p>
              Platform administrators manage access and operations. Their platform role alone does
              not grant approval or execution rights for business actions.
            </p>
            <Link className="pub-text-link" href="/login">
              Inspect the control room <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </section>
      <section className="pub-section">
        <div className="pub-wrap pub-two-col">
          <div>
            <p className="pub-index">03 / RELEASE STATUS</p>
            <h2>The implementation is in progress.</h2>
          </div>
          <div className="pub-release">
            <span>
              <i /> DEVELOPMENT / DEMO
            </span>
            <p>
              This site describes the intended operating model. Production capability depends on
              automated readiness checks on the release commit and named operational and security
              sign-offs.
            </p>
            <p>
              The current demonstration uses synthetic data. This page does not claim certification
              or approval for real customer data.
            </p>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
