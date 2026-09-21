'use client';

/**
 * Application shell (SRS §6.1) — client component, wrapped by the (app) server layout.
 *
 * Fixed instrument layout: a navigation rail keyed to the §3.6 permission matrix (a page a
 * role cannot use is not advertised), a telemetry bar carrying the active workspace, the
 * unread notification count and a live clock, and a scrollable work area.
 *
 * Navigation is filtered by permission, but that is only cosmetic: every endpoint re-checks
 * the caller independently, so hiding a link is courtesy, never security.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Permission } from '@void-space/types';

import { apiFetch } from '../lib/api';
import { SessionProvider, useSession } from '../lib/session';
import { Loading } from './ui-kit';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly permission: Permission;
  readonly hint: string;
}

const NAV: readonly NavItem[] = [
  { href: '/', label: 'Overview', permission: 'catalog:view', hint: 'OPS' },
  { href: '/library', label: 'Library', permission: 'asset:upload-own', hint: 'ASSETS' },
  { href: '/review', label: 'Review queue', permission: 'review:view-queue', hint: 'TRIAGE' },
  { href: '/catalog', label: 'Catalog', permission: 'catalog:view', hint: 'PUBLIC' },
  { href: '/licenses', label: 'Licences', permission: 'catalog:view', hint: 'CHAIN' },
  { href: '/audit', label: 'Audit log', permission: 'audit:view', hint: 'LEDGER' },
  { href: '/admin', label: 'Administration', permission: 'tenant:manage-users', hint: 'USERS' },
];

function Clock() {
  const [now, setNow] = useState<string>('--:--:--');

  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  return <span className="vs-num">{now} UTC</span>;
}

function NotificationBell() {
  const { data } = useQuery<{ unreadCount: number }>({
    queryKey: ['notifications', 'count'],
    queryFn: () => apiFetch<{ unreadCount: number }>('/notifications/count'),
    refetchInterval: 20_000,
    retry: false,
  });

  const count = data?.unreadCount ?? 0;

  return (
    <Link href="/notifications" className="vs-data flex items-center gap-2 hover:opacity-100 opacity-80">
      <span>[ ALERTS ]</span>
      <span className={count > 0 ? 'vs-accent' : 'opacity-50'}>{String(count).padStart(2, '0')}</span>
    </Link>
  );
}

function WorkspaceSwitcher() {
  const { session, memberships, switchTenant } = useSession();

  if (!session) return null;

  // With one workspace there is nothing to switch between, so the control stays a readout.
  if (memberships.length <= 1) {
    return (
      <span className="vs-data">
        [ {session.tenant.name} ] <span className="opacity-50">{session.tenant.slug}</span>
      </span>
    );
  }

  return (
    <select
      className="vs-select w-auto py-1 text-[11px] uppercase"
      value={session.tenant.id}
      onChange={(event) => void switchTenant(event.target.value)}
    >
      {memberships.map((membership) => (
        <option key={membership.id} value={membership.id}>
          {membership.name}
        </option>
      ))}
    </select>
  );
}

function Rail() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, can, signOut } = useSession();

  const visible = NAV.filter((item) => can(item.permission));

  return (
    <aside
      className="flex w-[228px] shrink-0 flex-col border-r"
      style={{ borderColor: 'var(--vs-line-strong)' }}
    >
      <div className="border-b p-4" style={{ borderColor: 'var(--vs-line-strong)' }}>
        <Link href="/" className="vs-display text-2xl">
          VOID<span className="vs-accent">·</span>SPACE
        </Link>
        <div className="vs-label mt-1">Asset operations console</div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {visible.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="vs-nav-link"
            data-active={pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))}
          >
            <span>{item.label}</span>
            <span className="opacity-50">{item.hint}</span>
          </Link>
        ))}
      </nav>

      <div className="border-t p-3" style={{ borderColor: 'var(--vs-line-strong)' }}>
        <div className="vs-label">Operator</div>
        <div className="vs-data mt-1 truncate">{session?.user.fullName ?? '—'}</div>
        <div className="vs-label truncate opacity-70">{session?.user.roles.join(' / ') ?? ''}</div>
        <button
          type="button"
          className="vs-btn mt-3 w-full justify-center"
          onClick={() => {
            void signOut().then(() => router.replace('/login'));
          }}
        >
          SIGN OUT
        </button>
      </div>
    </aside>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { session, isLoading, error } = useSession();

  if (isLoading) return <Loading label="INITIALISING SESSION" />;

  const status = (error as { status?: number } | null)?.status;
  if (!session) {
    return (
      <div className="p-8">
        <div className="vs-data vs-accent">&gt;&gt;&gt; SESSION REFUSED{status ? ` / HTTP ${status}` : ''}; REDIRECTING</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center justify-between gap-4 border-b px-4 py-2"
          style={{ borderColor: 'var(--vs-line-strong)' }}
        >
          <div className="flex items-center gap-4">
            <span className="vs-data opacity-60">SYS.ONLINE</span>
            <WorkspaceSwitcher />
            {session.readOnly ? <span className="vs-data vs-accent">READ-ONLY TOKEN</span> : null}
          </div>
          <div className="flex items-center gap-5">
            <NotificationBell />
            <span className="vs-data opacity-60">
              <Clock />
            </span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
