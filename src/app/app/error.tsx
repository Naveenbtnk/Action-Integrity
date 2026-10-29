'use client';

import Link from 'next/link';

export default function ApplicationError({ reset }: { readonly reset: () => void }) {
  return (
    <main id="main-content" className="mx-auto w-full max-w-[1600px] px-5 py-8 lg:px-8">
      <div role="alert" tabIndex={-1} className="max-w-2xl border border-primary bg-card p-6">
        <p data-instrument className="text-xs text-primary">
          WORKSPACE UNAVAILABLE
        </p>
        <h1 className="mt-3 text-2xl font-medium">This page could not load</h1>
        <p className="mt-3 text-sm leading-6 text-operational-muted">
          The current work was not changed. Try loading the page again, or return to the overview.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-10 border border-primary bg-primary px-4 text-sm text-white hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry this page
          </button>
          <Link
            href="/app/overview"
            className="inline-flex min-h-10 items-center border border-border px-4 text-sm hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            Return to overview
          </Link>
        </div>
      </div>
    </main>
  );
}
