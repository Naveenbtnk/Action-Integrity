import { PageFrame } from '@/components/console/PageFrame';
import { pagePrincipal } from '@/lib/auth/page-principal';

export default async function SettingsPage() {
  const user = await pagePrincipal();
  return (
    <PageFrame
      eyebrow="WORKSPACE / SETTINGS"
      title="Settings"
      description="Your current identity and enabled roles. Administrative controls arrive in the operations phase."
    >
      <section className="max-w-xl border border-border bg-card p-6">
        <h2 className="text-xl font-medium">Account</h2>
        <dl className="mt-5 space-y-4 text-sm">
          <div>
            <dt className="text-operational-muted">Name</dt>
            <dd className="mt-1">{user.name}</dd>
          </div>
          <div>
            <dt className="text-operational-muted">Email</dt>
            <dd className="mt-1 font-mono">{user.email}</dd>
          </div>
          <div>
            <dt className="text-operational-muted">Roles</dt>
            <dd className="mt-2 flex flex-wrap gap-2">
              {user.roles.map((role) => (
                <span key={role} className="border border-border px-2 py-1 font-mono text-xs">
                  {role}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>
    </PageFrame>
  );
}
