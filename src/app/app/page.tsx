import { Construction, ShieldCheck } from 'lucide-react';

export default function ApplicationFoundationPage() {
  return (
    <main id="main-content" className="mx-auto max-w-[1600px] px-5 py-10 lg:px-8 xl:px-10">
      <div className="flex max-w-3xl flex-col gap-4">
        <p data-instrument className="text-xs text-muted-foreground">
          PHASE 00 / FOUNDATION
        </p>
        <h1 className="text-[28px] font-medium leading-[1.2]">Control room foundation</h1>
        <p className="max-w-2xl leading-7 text-muted-foreground">
          The application shell, design tokens, request envelope, environment validation and
          observability boundary are active. Business queues and case data are deliberately absent
          until the data foundation is verified.
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FoundationCard
          icon={ShieldCheck}
          label="FAIL CLOSED"
          title="Security boundaries first"
          description="Environment shortcuts are rejected in production and unknown server errors never expose internal details."
        />
        <FoundationCard
          icon={Construction}
          label="NO BUSINESS DATA"
          title="Phase-gated implementation"
          description="No case, action, approval or target-system model exists in this phase."
        />
      </div>
    </main>
  );
}

interface FoundationCardProps {
  readonly description: string;
  readonly icon: typeof ShieldCheck;
  readonly label: string;
  readonly title: string;
}

function FoundationCard({ description, icon: Icon, label, title }: FoundationCardProps) {
  return (
    <article className="border border-border bg-card p-6">
      <Icon className="size-5 text-primary" aria-hidden="true" />
      <p data-instrument className="mt-6 text-xs text-muted-foreground">
        {label}
      </p>
      <h2 className="mt-2 text-xl font-medium">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
    </article>
  );
}
