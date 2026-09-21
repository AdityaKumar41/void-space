'use client';

/**
 * Shared UI primitives for the Tactical Telemetry system.
 *
 * The design rules are enforced here rather than re-decided per page: uppercase mono labels,
 * ASCII section framing, 1px structures, and status encoded as a small set of high-contrast
 * colours — never a pastel badge cloud.
 */
import Link from 'next/link';
import type { AssetStatus } from '@void-space/types';

/** `[ SECTION TITLE ]` — the system's structural framing device. */
export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="vs-panel-head">
      <span>[ {children} ]</span>
      {right ? <span className="vs-data">{right}</span> : null}
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`vs-panel ${className}`}>
      <SectionTitle right={right}>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** A single telemetry number with its label. `hint` is the raw label, never prose. */
export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'accent' | 'signal' | 'dim';
}) {
  const toneClass =
    tone === 'accent' ? 'vs-accent' : tone === 'signal' ? 'vs-signal' : tone === 'dim' ? 'opacity-60' : '';

  return (
    <div className="p-3">
      <div className="vs-label">{label}</div>
      <div className={`vs-display vs-num mt-1 text-3xl ${toneClass}`}>{value}</div>
      {hint ? <div className="vs-label mt-1 opacity-70">{hint}</div> : null}
    </div>
  );
}

const STATUS_TONE: Record<AssetStatus, string> = {
  draft: 'var(--vs-draft)',
  pending: 'var(--vs-pending)',
  needs_manual_review: 'var(--vs-review)',
  approved: 'var(--vs-approved)',
  rejected: 'var(--vs-rejected)',
  revision: 'var(--vs-revision)',
  published: 'var(--vs-published)',
};

const STATUS_LABEL: Record<AssetStatus, string> = {
  draft: 'DRAFT',
  pending: 'IN REVIEW',
  needs_manual_review: 'MANUAL REVIEW',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  revision: 'REVISION',
  published: 'PUBLISHED',
};

export function StatusPill({ status }: { status: AssetStatus }) {
  return (
    <span
      className="vs-data inline-flex items-center gap-1.5 border px-2 py-[3px]"
      style={{ borderColor: STATUS_TONE[status], color: STATUS_TONE[status] }}
    >
      <span aria-hidden>▚</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Tag({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'accent' }) {
  return (
    <span
      className="vs-data border px-1.5 py-[2px]"
      style={{
        borderColor: tone === 'accent' ? 'var(--vs-accent)' : 'var(--vs-line-strong)',
        color: tone === 'accent' ? 'var(--vs-accent)' : 'var(--vs-fg-dim)',
      }}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-8 text-center">
      <div className="vs-display text-xl opacity-70">{title}</div>
      {hint ? <div className="vs-label mt-2">{hint}</div> : null}
    </div>
  );
}

export function Loading({ label = 'QUERYING' }: { label?: string }) {
  return (
    <div className="vs-data vs-cursor p-6 opacity-70">
      {label}
    </div>
  );
}

export function ErrorNote({ message, code }: { message: string; code?: string }) {
  return (
    <div className="border p-3" style={{ borderColor: 'var(--vs-accent)' }}>
      <div className="vs-data vs-accent">&gt;&gt;&gt; FAULT{code ? ` / ${code}` : ''}</div>
      <div className="mt-1 text-[12px]">{message}</div>
    </div>
  );
}

/** 14-day ingest histogram, drawn with divs so it stays crisp and dependency-free. */
export function Sparkbars({ data }: { data: readonly { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((point) => point.count));
  return (
    <div className="flex h-16 items-end gap-[2px] p-2">
      {data.map((point) => (
        <div
          key={point.day}
          title={`${point.day}: ${point.count}`}
          className="flex-1"
          style={{
            height: `${Math.max(2, (point.count / max) * 100)}%`,
            background: point.count > 0 ? 'var(--vs-accent)' : 'var(--vs-line-strong)',
          }}
        />
      ))}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="vs-data opacity-70 hover:opacity-100">
      &lt;&lt; {children}
    </Link>
  );
}
