export default function ApplicationLoading() {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-[1600px] px-5 py-8 lg:px-8"
      aria-busy="true"
    >
      <p role="status" className="font-mono text-xs text-operational-muted">
        Loading current work…
      </p>
      <div className="mt-5 h-8 w-56 border border-border bg-card" aria-hidden="true" />
      <div className="mt-4 h-5 w-full max-w-xl border border-border bg-card" aria-hidden="true" />
      <div className="mt-8 space-y-2 border border-border bg-card p-4" aria-hidden="true">
        <div className="h-10 border border-border bg-background" />
        <div className="h-12 border border-border bg-background" />
        <div className="h-12 border border-border bg-background" />
        <div className="h-12 border border-border bg-background" />
      </div>
    </main>
  );
}
