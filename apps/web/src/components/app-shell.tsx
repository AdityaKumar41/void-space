'use client';

/**
 * Application shell (SRS §6.1).
 *
 * A floating glass header over an atmospheric ground, with the work area in a centred column — the
 * navigation is a layer that hovers above the content rather than a slab bolted to the top edge.
 *
 * Navigation is filtered by the §3.6 permission matrix, so a role never sees a door it cannot open.
 * That is courtesy, not security: every endpoint re-checks the caller independently.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Permission } from '@void-space/types';

import { apiFetch } from '../lib/api';
import { SessionProvider, useSession } from '../lib/session';
import type { SessionView } from '../lib/session-types';
import { ErrorNote } from './ui-kit';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly permission: Permission;
}

const NAV: readonly NavItem[] = [
  { href: '/console', label: 'Overview', permission: 'catalog:view' },
  { href: '/console/library', label: 'Library', permission: 'asset:upload-own' },
  { href: '/console/review', label: 'Review', permission: 'review:view-queue' },
  { href: '/console/catalog', label: 'Marketplace', permission: 'catalog:view' },
  { href: '/console/licenses', label: 'Licences', permission: 'catalog:view' },
  { href: '/console/audit', label: 'Audit', permission: 'audit:view' },
  { href: '/console/admin', label: 'Team', permission: 'tenant:manage-users' },
];

/** The wordmark, in one place so the shell and the holding screen cannot drift apart. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`vs-display ${compact ? 'text-base' : 'text-lg'}`} style={{ fontWeight: 800 }}>
      VOID
      <span className="vs-accent">·</span>
      SPACE
    </span>
  );
}

/**
 * First frame of the application.
 *
 * Calm by design: a signed-out visitor is a normal visitor, not an error (this screen replaces the
 * fault panel that used to flash \"SESSION REFUSED … REDIRECTING\" on every signed-out visit).
 */
function HoldingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        <Wordmark />
        <div className="vs-loader" aria-hidden />
        <p className="vs-label">Checking your session</p>
      </div>
    </div>
  );
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
    <Link
      href="/console/notifications"
      className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors"
      style={{ background: 'var(--vs-surface)', border: '1px solid var(--vs-line)' }}
      aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}
      title="Notifications"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8" />
        <path d="M10.5 20a2 2 0 0 0 3 0" />
      </svg>
      {count > 0 ? (
        <span
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
          style={{ background: 'var(--vs-accent)', color: 'var(--vs-accent-ink)' }}
        >
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );
}

function WorkspaceSwitcher() {
  const { session, memberships, switchTenant } = useSession();
  const [busy, setBusy] = useState(false);

  if (!session) return null;

  // One workspace means nothing to switch between, so the control stays a readout.
  if (memberships.length <= 1) {
    return (
      <span className="vs-chip" title={`Workspace: ${session.tenant.name}`}>
        {session.tenant.name}
      </span>
    );
  }

  return (
    <select
      className="vs-select w-auto py-1.5 text-xs"
      value={session.tenant.id}
      disabled={busy}
      aria-label="Switch workspace"
      onChange={async (event) => {
        setBusy(true);
        try {
          await switchTenant(event.target.value);
        } finally {
          setBusy(false);
        }
      }}
    >
      {memberships.map((membership) => (
        <option key={membership.id} value={membership.id}>
          {membership.name}
        </option>
      ))}
    </select>
  );
}

/** Avatar + account menu. Keeps sign-out out of the primary navigation. */
function AccountMenu() {
  const { session, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!session) return null;

  const initials = session.user.fullName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3"
        style={{ background: 'var(--vs-surface)', border: '1px solid var(--vs-line)' }}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
          style={{ background: 'rgba(139,108,246,0.22)', color: 'var(--vs-accent-warm)' }}
        >
          {initials || '·'}
        </span>
        <span className="hidden text-xs font-semibold sm:inline">{session.user.fullName}</span>
      </button>

      {open ? (
        <>
          {/* Click-away layer: closes the menu without stealing focus from the page. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="vs-glass absolute right-0 z-50 mt-2 w-64 rounded-2xl p-3"
            role="menu"
          >
            <div className="text-sm font-semibold">{session.user.fullName}</div>
            <div className="vs-data mt-0.5 truncate">{session.user.email}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {session.user.roles.map((role) => (
                <span key={role} className="vs-chip">
                  {role}
                </span>
              ))}
            </div>
            {session.readOnly ? (
              <div className="vs-label mt-3">Read-only token</div>
            ) : null}
            <button
              type="button"
              className="vs-btn vs-btn-quiet mt-3 w-full justify-center"
              onClick={() => {
                setOpen(false);
                void signOut().then(() => router.replace('/login'));
              }}
            >
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Header() {
  const pathname = usePathname();
  const { can } = useSession();
  const visible = NAV.filter((item) => can(item.permission));

  return (
    <header className="sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-5">
      <div className="vs-glass mx-auto flex max-w-[1500px] items-center gap-3 rounded-[22px] px-3 py-2.5 sm:px-4">
        <Link
          href="/console"
          className="flex items-center gap-2 pl-1 pr-2"
          aria-label="VOID·SPACE console home"
        >
          <Wordmark compact />
        </Link>

        <div
          className="h-6 w-px shrink-0"
          style={{ background: 'var(--vs-line-strong)' }}
          aria-hidden
        />

        {/* Horizontal, scrollable on narrow screens: every destination is reachable by thumb. */}
        <nav
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          aria-label="Primary"
        >
          {visible.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="vs-nav-link"
              data-active={
                pathname === item.href ||
                (item.href !== '/console' && pathname.startsWith(`${item.href}/`))
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden lg:inline-flex">
            <WorkspaceSwitcher />
          </span>
          <NotificationBell />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { session, isLoading, error } = useSession();
  const status = (error as { status?: number } | null)?.status;

  // 401 is not a fault, it is "not signed in": the provider has already asked the router to show the
  // sign-in screen. Rendering a fault panel here meant every signed-out visit flashed
  // "SESSION REFUSED … REDIRECTING" before the redirect landed.
  if (isLoading || status === 401) return <HoldingScreen />;

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20">
        <ErrorNote
          message={status ? `The session check failed with HTTP ${status}.` : 'No session was returned.'}
          code="SESSION_UNAVAILABLE"
          hint="The API may still be starting — retry in a moment, or sign in again."
        />
        <a className="vs-btn mt-4 inline-flex" href="/login">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <Header />
      <main id="main" className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-5 sm:px-6 sm:py-8">
        {children}
      </main>
      <footer className="mx-auto w-full max-w-[1500px] px-3 pb-8 pt-2 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4" style={{ borderColor: 'var(--vs-line)' }}>
          <span className="vs-label">VOID·SPACE · 3D asset lifecycle</span>
          <span className="vs-label">
            {session.tenant.name} · {session.user.roles.join(' / ')}
          </span>
        </div>
      </footer>
    </div>
  );
}

export function AppShell({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  /** Validated on the server by the console layout, so the first paint is already complete. */
  initialSession?: SessionView | null;
}) {
  return (
    <SessionProvider initialSession={initialSession}>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
