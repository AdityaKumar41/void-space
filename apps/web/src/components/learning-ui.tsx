'use client';
import type { ReactNode } from 'react';
export const control =
  'min-h-11 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';
export const action =
  control +
  ' inline-flex items-center justify-center gap-2 whitespace-nowrap hover:bg-surface-raised font-medium transition-colors disabled:cursor-not-allowed';
export function LearningLayout({
  title,
  description,
  children,
  playground = false,
  hideHeading = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  playground?: boolean;
  hideHeading?: boolean;
}) {
  return (
    <div className={playground ? 'lesson-playground-page' : 'learning-page'}>
      {!playground && !hideHeading && (
        <header className="learning-page-heading">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-2xl leading-relaxed text-ink-dim">{description}</p>
        </header>
      )}
      {children}
    </div>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={
        'rounded-lg border border-hairline p-4 text-sm leading-relaxed ' +
        (error ? 'text-red-700' : 'text-ink-dim')
      }
    >
      {children}
    </div>
  );
}
export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-hairline bg-surface/40 p-5">
      {children}
    </section>
  );
}
