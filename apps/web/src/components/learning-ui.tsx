'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
export const control =
  'min-h-11 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';
export const action = control + ' hover:bg-surface-raised font-medium';
export function LearningLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-7 px-4 py-8 sm:px-8">
      <header className="space-y-3">
        <nav className="flex flex-wrap gap-4 text-sm text-ink-dim">
          <Link href="/console/learn">Lessons</Link>
          <Link href="/console/learn/agent">Ask your agent</Link>
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-2xl leading-relaxed text-ink-dim">{description}</p>
      </header>
      {children}
    </div>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={
        'rounded-lg border border-hairline p-4 text-sm leading-relaxed ' +
        (error ? 'text-red-400' : 'text-ink-dim')
      }
    >
      {children}
    </p>
  );
}
export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-hairline bg-surface/40 p-5">
      {children}
    </section>
  );
}
