import type { ReactNode } from 'react';

export function PageFrame({
  eyebrow,
  title,
  description,
  children,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <main id="main-content" className="mx-auto w-full max-w-[1600px] px-5 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[.09em] text-primary">{eyebrow}</p>
          <h1 className="mt-2 text-[clamp(26px,2.2vw,34px)] font-medium leading-tight">{title}</h1>
          <p className="mt-2 max-w-2xl text-base leading-6 text-operational-muted">{description}</p>
        </div>
        {actions}
      </div>
      <div className="pt-5">{children}</div>
    </main>
  );
}
