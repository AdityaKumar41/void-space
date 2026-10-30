'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import {
  BookOpen,
  Boxes,
  CircleHelp,
  Compass,
  FolderOpen,
  GraduationCap,
  History,
  LayoutDashboard,
  Menu,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@void-space/types';

import { apiFetch } from '../lib/api';
import { cn } from '../lib/cn';
import { SessionProvider, useSession } from '../lib/session';
import type { SessionView } from '../lib/session-types';
import { Avatar } from './ui/avatar';
import { Chip } from './ui/chip';
import { CubeIcon } from './ui/icons';
import { BellIcon, SearchIcon } from './console-kit';
import { ErrorNote } from './ui/feedback';
import { VoidStudioLaunchButton } from './studio-launch';

export { VoidStudioLaunchButton };

interface NavItem {
  href: string;
  label: string;
  permission: Permission;
  icon: LucideIcon;
}
const GROUPS: readonly { label: string; items: NavItem[] }[] = [
  {
    label: 'Your learning',
    items: [
      { href: '/console', label: 'Home', permission: 'catalog:view', icon: LayoutDashboard },
      {
        href: '/console/campus',
        label: 'Programs',
        permission: 'catalog:view',
        icon: GraduationCap,
      },
      { href: '/console/lessons', label: 'Lessons', permission: 'catalog:view', icon: BookOpen },
      {
        href: '/console/simulations',
        label: 'Practice',
        permission: 'catalog:view',
        icon: Compass,
      },
      { href: '/console/spaces', label: 'Spaces', permission: 'spatial:join', icon: Users },
      {
        href: '/console/field-guides',
        label: 'Field guides',
        permission: 'catalog:view',
        icon: Wrench,
      },
    ],
  },
  {
    label: 'Content workspace',
    items: [
      {
        href: '/console/library',
        label: 'Library',
        permission: 'asset:upload-own',
        icon: FolderOpen,
      },
      {
        href: '/console/review',
        label: 'Review queue',
        permission: 'review:view-queue',
        icon: ShieldCheck,
      },
      { href: '/console/catalog', label: 'Marketplace', permission: 'catalog:view', icon: Boxes },
      {
        href: '/console/licenses',
        label: 'Licences',
        permission: 'catalog:view',
        icon: ShieldCheck,
      },
      { href: '/console/twins', label: 'Digital twins', permission: 'iot:manage', icon: Radio },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        href: '/console/operations',
        label: 'Operations',
        permission: 'catalog:view',
        icon: History,
      },
      { href: '/console/career', label: 'Career', permission: 'catalog:view', icon: Compass },
      { href: '/console/ventures', label: 'Ventures', permission: 'catalog:view', icon: Sparkles },
      { href: '/console/audit', label: 'Audit', permission: 'audit:view', icon: History },
      { href: '/console/admin', label: 'Team', permission: 'tenant:manage-users', icon: Settings },
      { href: '/console/tenants', label: 'Workspaces', permission: 'tenant:manage', icon: Users },
    ],
  },
];
const NAV = GROUPS.flatMap((g) => g.items);

/**
 * The wordmark.
 *
 * The cube and the type together — the same mark as the storefront, from the same component, so a
 * visitor moving between the catalogue and the console is visibly in one product. It used to be two
 * different marks: an ASCII drawing on the storefront and a bare word here.
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <CubeIcon
        className="text-brand"
        width={compact ? 17 : 20}
        height={compact ? 17 : 20}
        strokeWidth={1.3}
      />
      <span
        className={cn(
          'font-semibold tracking-[-0.02em] text-ink',
          compact ? 'text-[14px]' : 'text-[15px]',
        )}
      >
        VOID·SPACE
      </span>
    </span>
  );
}

/**
 * First frame of the application.
 *
 * Calm by design: a signed-out visitor is a normal visitor, not an error (this screen replaces the
 * fault panel that used to flash "SESSION REFUSED … REDIRECTING" on every signed-out visit).
 */
function HoldingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-base">
      <div className="flex flex-col items-center gap-5">
        <Wordmark />
        <div aria-hidden className="h-0.5 w-16 animate-dot-pulse rounded-full bg-brand" />
        <p className="text-[12.5px] text-ink-faint">Checking your session</p>
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
      aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}
      title="Notifications"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-control border border-hairline bg-surface text-ink-dim transition-colors duration-150 ease-standard hover:border-hairline-strong hover:bg-surface-raised hover:text-ink"
    >
      <BellIcon />
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-base bg-brand px-1 font-mono text-[10px] text-white">
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The workspace search.
 *
 * It is a real form: pressing Enter navigates to the library with the query in the URL, so the
 * search is shareable, bookmarkable and works with the back button. A search box that silently
 * filters a page you are not on is the most common decorative control in a dashboard.
 */
function WorkspaceSearch() {
  const router = useRouter();
  const { can } = useSession();
  const destination = can('asset:upload-own') ? '/console/library' : '/console/catalog';
  const inputId = useId();
  const [value, setValue] = useState('');

  return (
    <form
      role="search"
      className="relative flex h-10 items-center"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        router.push(
          query.length > 0 ? `${destination}?q=${encodeURIComponent(query)}` : destination,
        );
      }}
    >
      <span className="pointer-events-none absolute left-3.5 text-ink-faint">
        <SearchIcon />
      </span>
      <label className="sr-only" htmlFor={inputId}>
        Search assets by name or tag
      </label>
      <input
        id={inputId}
        type="search"
        value={value}
        placeholder="Search assets by name or tag"
        onChange={(event) => setValue(event.target.value)}
        className="h-10 w-full rounded-control border border-hairline bg-surface pl-10 pr-3.5 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-faint hover:border-hairline-strong focus:border-brand focus:outline-none"
      />
    </form>
  );
}

function WorkspaceSwitcher() {
  const { session, memberships, switchTenant } = useSession();
  const [busy, setBusy] = useState(false);

  if (!session) return null;

  // One workspace means nothing to switch between, so the control stays a readout.
  if (memberships.length <= 1) {
    return (
      <span
        className="block truncate text-[12px] text-ink-dim"
        title={`Workspace: ${session.tenant.name}`}
      >
        <span aria-hidden className="hidden" />
        {session.tenant.name}
      </span>
    );
  }

  return (
    <select
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
      className={cn(
        'h-9 w-auto min-w-[150px] cursor-pointer appearance-none rounded-control border border-hairline bg-surface pl-3 pr-9 text-[13px] text-ink',
      )}
    >
      {memberships.map((membership) => (
        <option key={membership.id} value={membership.id}>
          {membership.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Avatar + account menu. Keeps sign-out out of the primary navigation.
 *
 * `tenants.length > 1` decides whether the switcher is offered at all, which is why the account
 * menu also carries the workspace list as a fallback on narrow screens where the switcher is hidden.
 */
function AccountMenu() {
  const { session, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!session) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2.5 rounded-full border border-hairline bg-surface py-1 pl-1 pr-3 text-ink transition-colors duration-150 ease-standard hover:border-hairline-strong"
      >
        <Avatar name={session.user.fullName} size="sm" />
        <span className="hidden text-[13px] font-semibold sm:inline">{session.user.fullName}</span>
      </button>

      {open ? (
        <>
          {/* Click-away layer: closes the menu without stealing focus from the page. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%_+_8px)] z-50 w-64 overflow-hidden rounded-card border border-hairline bg-surface shadow-float"
          >
            <div className="border-b border-hairline px-4 py-4">
              <div className="text-[14px] font-semibold text-ink">{session.user.fullName}</div>
              <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-faint">
                {session.user.email}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {session.user.roles.map((role) => (
                  <Chip key={role}>{role}</Chip>
                ))}
              </div>
              {session.readOnly ? (
                <div className="mt-2.5 text-[12px] leading-snug text-ink-faint">
                  Read-only session — write actions are refused by the API, not hidden here.
                </div>
              ) : null}
            </div>

            <div className="py-1.5">
              {[
                { href: '/console/notifications', label: 'Notifications' },
                { href: '/docs', label: 'Studio guide' },
                { href: '/catalog', label: 'Public catalogue' },
              ].map((entry) => (
                <Link
                  key={entry.href}
                  href={entry.href}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-[13.5px] text-ink-dim transition-colors duration-150 ease-standard hover:bg-veil-6 hover:text-ink"
                >
                  {entry.label}
                </Link>
              ))}
              <a
                href="/api/v1/docs"
                target="_blank"
                rel="noreferrer"
                className="block px-4 py-2 text-[13.5px] text-ink-dim transition-colors duration-150 ease-standard hover:bg-veil-6 hover:text-ink"
              >
                API reference
              </a>
            </div>

            <div className="border-t border-hairline py-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void signOut().then(() => router.replace('/login'));
                }}
                className="block w-full px-4 py-2 text-left text-[13.5px] text-state-rejected transition-colors duration-150 ease-standard hover:bg-veil-6"
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The two rows of navigation.
 *
 * The tabs are links, not tabs in the ARIA sense: each is a route, and the browser's own history is
 * what moves between them. `aria-current="page"` is the correct signal for that, and a
 * `role="tablist"` here would tell a screen reader to expect arrow-key navigation that does not
 * exist.
 */
function Header({ openNavigation }: { openNavigation: () => void }) {
  const pathname = usePathname();
  const current =
    NAV.find((item) => item.href === pathname) ??
    NAV.find((item) => item.href !== '/console' && pathname.startsWith(item.href + '/'));
  const { can } = useSession();
  return (
    <header className="workspace-topbar">
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="workspace-menu-button"
          aria-label="Open navigation"
          onClick={openNavigation}
        >
          <Menu size={20} />
        </button>
        <span className="hidden text-sm text-ink-faint sm:inline">Workspace</span>
        <span aria-hidden className="hidden text-ink-faint sm:inline">
          /
        </span>
        <span className="truncate text-sm font-semibold text-ink">
          {current?.label ?? 'Details'}
        </span>
      </div>
      <div className="ml-auto hidden w-full max-w-[330px] lg:block">
        <WorkspaceSearch />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {can('asset:upload-own') ? <VoidStudioLaunchButton variant="nav" /> : null}
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  );
}
function Sidebar({ open, close }: { open: boolean; close: () => void }) {
  const pathname = usePathname();
  const { can, session } = useSession();
  useEffect(() => {
    if (!open) return;
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [open, close]);
  return (
    <>
      {open ? (
        <button
          aria-label="Close navigation overlay"
          className="workspace-nav-overlay"
          onClick={close}
        />
      ) : null}
      <aside
        className={cn('workspace-sidebar', open && 'is-open')}
        aria-label="Workspace navigation"
      >
        <div className="flex items-center justify-between px-6 pb-6 pt-7">
          <Link href="/console" aria-label="VOID·SPACE console home" onClick={close}>
            <Wordmark />
          </Link>
          <button className="workspace-mobile-close" aria-label="Close navigation" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <div className="mx-4 mb-6 rounded-xl border border-hairline bg-surface px-4 py-3">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[.14em] text-ink-faint">
            Learning workspace
          </span>
          <WorkspaceSwitcher />
        </div>
        <nav aria-label="Sections" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-6">
          {GROUPS.map((group) => {
            const items = group.items.filter((item) => can(item.permission));
            return items.length ? (
              <div key={group.label}>
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[.13em] text-ink-faint">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {items.map((item) => {
                    const active =
                      pathname === item.href ||
                      (item.href !== '/console' && pathname.startsWith(item.href + '/'));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        onClick={close}
                        className={cn('workspace-nav-link', active && 'is-active')}
                      >
                        <Icon size={17} strokeWidth={1.7} />
                        <span>{item.label}</span>
                        {active ? (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })}
        </nav>
        <div className="border-t border-hairline p-4">
          <Link
            href="/console/field-guides"
            onClick={close}
            className="flex items-center gap-3 rounded-lg px-2 py-2 text-xs text-ink-dim hover:text-ink"
          >
            <CircleHelp size={17} />
            <span>Guidance when you need it</span>
          </Link>
          <p className="mt-3 truncate px-2 text-[10px] text-ink-faint">{session?.tenant.name}</p>
        </div>
      </aside>
    </>
  );
}

/**
 * The frame around every authenticated screen.
 *
 * The main column is capped at 1560px rather than the storefront's 1200: an operator reading a
 * table of forty audit rows wants the width, and the storefront's measure is about reading prose.
 */
function Shell({ children }: { children: React.ReactNode }) {
  const { session, isLoading, error } = useSession();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const status = (error as { status?: number } | null)?.status;

  // 401 is not a fault, it is "not signed in": the provider has already asked the router to show the
  // sign-in screen. Rendering a fault panel here meant every signed-out visit flashed
  // "SESSION REFUSED … REDIRECTING" before the redirect landed.
  if (isLoading || status === 401) return <HoldingScreen />;

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20">
        <ErrorNote
          message={
            status ? `The session check failed with HTTP ${status}.` : 'No session was returned.'
          }
          code="SESSION_UNAVAILABLE"
          hint="The API may still be starting — retry in a moment, or sign in again."
        />
        <a
          className="h-10 items-center justify-center gap-2 rounded-control border border-transparent bg-veil-8 px-4 text-[14px] font-semibold text-ink transition-all duration-200 ease-standard hover:bg-veil-12 mt-4 inline-flex"
          href="/login"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="workspace-theme">
      <Sidebar open={navigationOpen} close={() => setNavigationOpen(false)} />
      <div className="workspace-body">
        <Header openNavigation={() => setNavigationOpen(true)} />
        <main id="main" className="workspace-main">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>VOID·SPACE</span>
          <span>Learn by exploring. Build through practice.</span>
        </footer>
      </div>
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
