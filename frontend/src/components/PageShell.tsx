import type { ReactNode } from "react";

export default function PageShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-cloud/60 to-white px-4 pt-28 pb-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-steel">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </main>
  );
}
