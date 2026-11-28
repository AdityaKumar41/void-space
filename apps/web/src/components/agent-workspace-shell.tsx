'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  ChevronLeft,
  CircleHelp,
  Compass,
  FolderOpen,
  GraduationCap,
  LayoutGrid,
  LogOut,
  Menu,
  MessageCircle,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Boxes,
  Building2,
  History,
  Radio,
  Users,
} from 'lucide-react';
import { isLessonPlaygroundRoute } from '../lib/lesson-playground-route';
import { useSession } from '../lib/session';
import { useClientReady } from '../lib/use-client-ready';
import { useLearningProfile } from '../lib/learning-profile';
import { Avatar } from './ui/avatar';
import type { Permission } from '@void-space/types';
const groups = [
  {
    title: 'Workspace',
    items: [
      { href: '/console/learn/agent', label: 'Ask AI', icon: MessageCircle },
      { href: '/console/learn', label: 'My lessons', icon: BookOpen },
      { href: '/console/learn/library', label: 'Library', icon: FolderOpen },
    ],
  },
  {
    title: 'Explore & learn',
    items: [
      { href: '/console/learn/discover', label: 'Discover lessons', icon: Compass },
      { href: '/console/learn/progress', label: 'My progress', icon: LayoutGrid },
      { href: '/console/learn/sources', label: 'My sources', icon: GraduationCap },
      { href: '/console/models', label: 'Find a model', icon: Boxes },
    ],
  },
  {
    title: 'Manage',
    items: [
      { href: '/console/learn/institution', label: 'Institution', icon: ShieldCheck },
      { href: '/console/learn/settings', label: 'Settings', icon: Settings },
    ],
  },
];
export function AgentWorkspaceShell({ children }: { children: ReactNode }) {
  const ready = useClientReady();
  const pathname = usePathname(),
    { session, memberships, switchTenant, signOut, can } = useSession(),
    [open, setOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState(''),
    [error, setError] = useState('');
  const profile = useLearningProfile();
  const platform = useQuery({
    queryKey: ['platform-access'],
    enabled: !!session,
    queryFn: () =>
      apiFetch<{ granted: boolean; elevated: boolean; role: string | null }>('/platform/access'),
    staleTime: 30000,
  });
  const teacher = profile.data?.persona === 'teacher';
  const platformMode = pathname.startsWith('/console/platform');
  const learningGroups = groups.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => item.href !== '/console/learn/progress' || (!!profile.data && !teacher))
      .map((item) =>
        teacher && item.href === '/console/learn'
          ? { ...item, label: 'My teaching materials' }
          : item,
      ),
  }));
  const aside = useRef<HTMLElement>(null),
    menu = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        aside.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key === 'Tab') {
        const all = focusable(),
          first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      (previous ?? menu.current)?.focus();
    };
  }, [open]);
  const assetItems: { href: string; label: string; icon: typeof Boxes; permission: Permission }[] =
    [
      {
        href: '/console/library',
        label: 'Asset library',
        icon: FolderOpen,
        permission: 'asset:upload-own',
      },
      {
        href: '/console/review',
        label: 'Review queue',
        icon: ShieldCheck,
        permission: 'review:view-queue',
      },
      {
        href: '/console/licenses',
        label: 'Licences',
        icon: ShieldCheck,
        permission: 'catalog:view',
      },
      { href: '/console/twins', label: 'Digital twins', icon: Radio, permission: 'iot:manage' },
      {
        href: '/console/operations',
        label: 'Operations',
        icon: History,
        permission: 'catalog:view',
      },
      {
        href: '/console/analytics',
        label: 'Analytics',
        icon: LayoutGrid,
        permission: 'audit:view',
      },
      { href: '/console/audit', label: 'Audit', icon: History, permission: 'audit:view' },
      { href: '/console/admin', label: 'Team', icon: Users, permission: 'tenant:manage-users' },

      {
        href: '/console/learn/settings',
        label: 'Settings',
        icon: Settings,
        permission: 'catalog:view',
      },
    ];
  const assetPage =
    !pathname.startsWith('/console/learn') &&
    pathname !== '/console/catalog' &&
    pathname !== '/console/models';
  const navGroups = assetPage
    ? platformMode
      ? [
          {
            title: 'Platform',
            items: [
              { href: '/console/platform', label: 'Overview', icon: ShieldCheck },
              ...(platform.data?.elevated && platform.data.role === 'PlatformAdmin'
                ? [
                    {
                      href: '/console/platform#platform-workspaces',
                      label: 'Workspaces',
                      icon: Building2,
                    },
                    {
                      href: '/console/platform#platform-accounts',
                      label: 'Accounts and access',
                      icon: Users,
                    },
                    {
                      href: '/console/platform#platform-audit',
                      label: 'Platform audit',
                      icon: History,
                    },
                  ]
                : []),
            ],
          },
        ]
      : [{ title: 'Asset workspace', items: assetItems.filter((i) => can(i.permission)) }]
    : learningGroups;
  const selected =
    [
      ...learningGroups.flatMap((g) => g.items),
      ...assetItems,
      { href: '/console/catalog', label: 'Marketplace' },
      { href: '/console/models', label: 'Find a model' },
    ].find((i) => i.href === pathname)?.label ??
    (pathname.startsWith('/console/learn/library/')
      ? 'Library / Model'
      : pathname.includes('/notifications')
        ? 'Notifications'
        : pathname.includes('/settings')
          ? 'Settings'
          : pathname.includes('/help')
            ? 'Help'
            : pathname.includes('/assets/')
              ? 'Model details'
              : pathname.includes('/drafts/')
                ? 'Lesson playground'
                : pathname.includes('/lessons/')
                  ? 'Learning session'
                  : 'Ask AI');
  if (isLessonPlaygroundRoute(pathname))
    return (
      <div className="agent-workspace agent-playground-shell">
        <main
          id="main"
          aria-label={pathname.includes('/annotate') ? 'Annotation editor' : 'Lesson playground'}
        >
          {children}
        </main>
      </div>
    );
  return (
    <div className={'agent-workspace ' + (collapsed ? 'agent-sidebar-collapsed' : '')}>
      {open && (
        <button
          className="agent-nav-overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        ref={aside}
        className={'agent-sidebar ' + (open ? 'is-open' : '')}
        aria-label={assetPage ? 'Asset navigation' : 'Learning navigation'}
      >
        <Link href="/console/learn/agent" className="agent-brand" aria-label="Void Space">
          <span className="agent-brand-mark">
            <Sparkles size={20} />
          </span>
          <span>Void Space</span>
        </Link>
        <button
          className="agent-collapse"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronLeft size={16} />
        </button>
        <form
          className="agent-side-search"
          onSubmit={(e) => {
            e.preventDefault();
            location.assign(
              `${assetPage ? '/console/library' : pathname === '/console/catalog' ? '/console/catalog' : '/console/learn'}?q=${encodeURIComponent(search)}`,
            );
          }}
        >
          <Search size={17} />
          <input
            aria-label={
              assetPage
                ? 'Search assets'
                : pathname === '/console/catalog'
                  ? 'Search marketplace'
                  : 'Search lessons'
            }
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>↵</kbd>
        </form>
        <nav aria-label="Workspace sections" className="agent-nav">
          {navGroups.map((group) => (
            <section key={group.title}>
              <h2>{group.title}</h2>
              {group.items.map((item) => (
                <Link
                  onClick={() => setOpen(false)}
                  href={item.href}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                  key={item.href}
                  aria-current={
                    pathname === item.href ||
                    (item.href === '/console/learn/library' && pathname.startsWith(item.href + '/'))
                      ? 'page'
                      : undefined
                  }
                >
                  <item.icon size={18} strokeWidth={1.5} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </section>
          ))}
        </nav>
        {assetPage && (
          <Link className="agent-pill" href="/console/learn/agent">
            <BookOpen size={16} />
            Learning workspace
          </Link>
        )}
        <nav className="agent-bottom-nav" aria-label="Asset tools">
          <section className="agent-market-link">
            <Link
              href="/console/catalog"
              aria-label="Marketplace"
              title={collapsed ? 'Marketplace' : undefined}
              aria-current={pathname === '/console/catalog' ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <ShoppingBag size={18} strokeWidth={1.5} />
              <span>Marketplace</span>
              <ArrowUpRight size={14} />
            </Link>
            <Link
              href="/console/library"
              aria-label="Asset workspace"
              title={collapsed ? 'Asset workspace' : undefined}
              onClick={() => {
                localStorage.setItem('void-workspace-mode', 'assets');
                window.dispatchEvent(new Event('void-workspace-mode'));
              }}
            >
              <FolderOpen size={18} strokeWidth={1.5} />
              <span>Asset workspace</span>
              <ArrowUpRight size={14} />
            </Link>
          </section>
        </nav>
        {platform.data?.granted && (
          <Link className="agent-platform-link" href="/console/platform">
            <ShieldCheck size={17} />
            Platform administration
          </Link>
        )}
        <div className="agent-account-card">
          <div className="agent-person">
            <Avatar name={session?.user.fullName ?? 'Learner'} />
            <div>
              <strong>{session?.user.fullName}</strong>
              <span>
                {!profile.data
                  ? 'Loading access…'
                  : profile.data.workspace.kind === 'organization' && can('tenant:manage-users')
                    ? 'Administrator'
                    : profile.data.persona === 'teacher'
                      ? 'Teacher'
                      : profile.data?.persona === 'student'
                        ? 'Student'
                        : 'Individual'}{' '}
                · {session?.tenant.name}
              </span>
            </div>
            <button
              aria-label="Sign out"
              title="Sign out"
              onClick={() => void signOut().catch((e) => setError(e.message))}
            >
              <LogOut size={16} />
            </button>
          </div>
          {memberships.length > 1 && (
            <label className="agent-workspace-picker">
              Workspace
              <select
                aria-label="Switch workspace"
                value={session?.tenant.id}
                onChange={(e) =>
                  void switchTenant(e.target.value).catch((e) => setError(e.message))
                }
              >
                {memberships.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </aside>
      <div className="agent-content" inert={open || undefined}>
        <header className="agent-topbar">
          <button
            ref={menu}
            className="agent-mobile-menu"
            aria-label="Open navigation"
            aria-expanded={open}
            aria-controls="workspace-navigation"
            disabled={!ready}
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span>
            {assetPage ? 'Asset workspace' : (session?.tenant.name ?? 'Learning workspace')}
          </span>
          <span aria-hidden>/</span>
          <strong>{selected}</strong>
          <div className="agent-topbar-actions">
            <Link href="/console/learn/notifications" aria-label="Notifications">
              <Bell size={18} />
            </Link>
            <Link href="/console/learn/help" aria-label="Help and support">
              <CircleHelp size={18} />
            </Link>
          </div>
        </header>
        {profile.error && (
          <p className="agent-status agent-error" role="alert">
            Your workspace role could not be confirmed.{' '}
            <button className="underline" onClick={() => void profile.refetch()}>
              Try again
            </button>
          </p>
        )}
        <main
          id="main"
          className={
            'agent-main' + (assetPage || pathname === '/console/models' ? ' agent-asset-page' : '')
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
