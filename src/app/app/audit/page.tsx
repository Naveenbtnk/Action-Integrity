import { PageFrame } from '@/components/console/PageFrame';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { db } from '@/lib/db';

export default async function AuditPage() {
  await pagePrincipalWith('audit:read');
  const events = await db.auditEvent.findMany({ orderBy: { seq: 'desc' }, take: 100 });
  return (
    <PageFrame
      eyebrow="CONTROL / 02"
      title="Audit record"
      description="Recent immutable events. Chain proof and export are part of the later audit phase."
    >
      {events.length === 0 ? (
        <div className="border border-border bg-card p-8 text-sm text-operational-muted">
          No audit events match this view.
        </div>
      ) : (
        <div className="overflow-x-auto border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-background font-mono text-[11px] text-operational-muted">
              <tr>
                <th className="px-4 py-3 font-normal">Sequence</th>
                <th className="px-4 py-3 font-normal">Event</th>
                <th className="px-4 py-3 font-normal">Actor</th>
                <th className="px-4 py-3 font-normal">Case</th>
                <th className="px-4 py-3 font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-border/70">
                  <td className="px-4 py-3 font-mono text-xs">#{event.seq.toString()}</td>
                  <td className="px-4 py-3">{event.eventType}</td>
                  <td className="px-4 py-3 font-mono text-xs">{event.actorType}</td>
                  <td className="px-4 py-3 font-mono text-xs">{event.caseId ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-operational-muted">
                    <time dateTime={event.createdAt.toISOString()}>
                      {event.createdAt.toLocaleString()}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageFrame>
  );
}
