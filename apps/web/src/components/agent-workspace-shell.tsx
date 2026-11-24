'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  ChevronDown,
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
  X,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { Avatar } from './ui/avatar';
const groups = [
  {
    title: 'Overview',
    items: [
      { href: '/console/learn/agent', label: 'Ask AI', icon: MessageCircle },
      { href: '/console/learn', label: 'My lessons', icon: BookOpen },
      { href: '/console/learn/library', label: 'Library', icon: FolderOpen },
    ],
  },
  {
    title: 'Learning tools',
    items: [
      { href: '/console/learn/discover', label: 'Discover lessons', icon: Compass },
      { href: '/console/learn/progress', label: 'My progress', icon: LayoutGrid },
      { href: '/console/learn/sources', label: 'My sources', icon: GraduationCap },
    ],
  },
  {
    title: 'Manage',
    items: [
      { href: '/console/learn/institution', label: 'Institution', icon: ShieldCheck },
      { href: '/console/account', label: 'Settings', icon: Settings },
    ],
  },
];
export function AgentWorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    { session, memberships, switchTenant, signOut } = useSession(),
    [open, setOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState(''),
    [error, setError] = useState('');
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
  const selected =
    groups.flatMap((g) => g.items).find((i) => i.href === pathname)?.label ??
    (pathname.includes('/drafts/')
      ? 'Lesson workspace'
      : pathname.includes('/lessons/')
        ? 'Learning session'
        : 'Ask AI');
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
        ref={aside}
        className={'agent-sidebar ' + (open ? 'is-open' : '')}
        aria-label="Learning navigation"
      >
        <Link href="/console/learn/agent" className="agent-brand">
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
            location.assign(`/console/learn?q=${encodeURIComponent(search)}`);
          }}
        >
          <Search size={17} />
          <input
            aria-label="Search lessons"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>↵</kbd>
        </form>
        <nav aria-label="Workspace sections" className="agent-nav">
          {groups.map((group) => (
            <section key={group.title}>
              <h2>
                {group.title}
                <ChevronDown size={13} />
              </h2>
              {group.items.map((item) => (
                <Link
                  onClick={() => setOpen(false)}
                  href={item.href}
                  key={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                >
                  <item.icon size={18} strokeWidth={1.5} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </section>
          ))}
        </nav>
        <nav className="agent-bottom-nav" aria-label="Asset tools">
          <section className="agent-market-link">
            <Link href="/console/catalog">
              <ShoppingBag size={18} strokeWidth={1.5} />
              <span>Marketplace</span>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/console/library">
              <FolderOpen size={18} strokeWidth={1.5} />
              <span>Asset workspace</span>
              <ArrowUpRight size={14} />
            </Link>
          </section>
        </nav>
        <div className="agent-account-card">
          <div className="agent-help">
            <h3>What will you teach next?</h3>
            <p>Start with an idea. Build it together.</p>
            <Link href="/console/learn/agent">
              <Sparkles size={15} /> Chat with AI
            </Link>
          </div>
          <div className="agent-person">
            <Avatar name={session?.user.fullName ?? 'Learner'} />
            <div>
              <strong>{session?.user.fullName}</strong>
              <span>{session?.tenant.name}</span>
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
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span>Overview</span>
          <span aria-hidden>/</span>
          <strong>{selected}</strong>
          <div className="agent-topbar-actions">
            <Link href="/console/notifications" aria-label="Notifications">
              <Bell size={18} />
            </Link>
            <Link href="/console/help" aria-label="Help and support">
              <CircleHelp size={18} />
            </Link>
          </div>
        </header>
        <main id="main" className="agent-main">
          {children}
        </main>
      </div>
    </div>
  );
}
