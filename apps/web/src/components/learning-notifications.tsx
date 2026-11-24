'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck, BookOpen, Users, Box, ArrowUpRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatRelative } from '../lib/format';
import { LearningLayout, Notice } from './learning-ui';
interface Item {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
export function LearningNotifications() {
  const client = useQueryClient(),
    [unreadOnly, setUnreadOnly] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiFetch<{ items: Item[]; unreadCount: number; total: number }>('/notifications?pageSize=50'),
  });
  async function read(ids?: string[]) {
    setBusy(true);
    setError('');
    try {
      await apiFetch('/notifications/read', { method: 'POST', body: ids ? { ids } : {} });
      await client.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const items = q.data?.items.filter((i) => !unreadOnly || !i.readAt) ?? [];
  return (
    <LearningLayout
      title="Notifications"
      description="Updates from your learning and workspace, in one place."
    >
      <div className="learning-inbox-toolbar">
        <div role="group" aria-label="Notification filter">
          <button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>
            All updates
          </button>
          <button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
            Unread {q.data?.unreadCount ?? 0}
          </button>
        </div>
        <button disabled={busy || !q.data?.unreadCount} onClick={() => void read()}>
          <CheckCheck size={17} />
          Mark all read
        </button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {q.error && (
        <Notice error>
          {q.error.message} <button onClick={() => void q.refetch()}>Try again</button>
        </Notice>
      )}
      {q.isPending && (
        <div className="learning-empty" role="status">
          <Bell size={32} />
          <p>Loading your updates…</p>
        </div>
      )}
      {q.data && !items.length && (
        <div className="learning-empty">
          <BellOff size={38} />
          <h2>{unreadOnly ? 'You’re all caught up' : 'A quiet space, for now'}</h2>
          <p>
            {unreadOnly
              ? 'There are no unread updates.'
              : 'Your learning and workspace updates will appear here.'}
          </p>
          <Link href="/console/learn">
            Explore your lessons <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
      <div className="learning-inbox">
        {items.map((i) => {
          const isLesson = /lesson|learning/.test(i.type),
            isInvite = /invit|member/.test(i.type),
            Icon = isLesson ? BookOpen : isInvite ? Users : Box;
          const title =
            typeof i.payload.title === 'string'
              ? i.payload.title
              : i.type.replace(/[_.]/g, ' ').replace(/^./, (c) => c.toUpperCase());
          return (
            <article key={i.id} className={i.readAt ? '' : 'is-unread'}>
              <div className="learning-update-icon">
                <Icon size={21} />
              </div>
              <div>
                <h2>{title}</h2>
                {typeof i.payload.body === 'string' && <p>{i.payload.body}</p>}
                <time dateTime={i.createdAt}>{formatRelative(i.createdAt)}</time>
              </div>
              {!i.readAt && (
                <button disabled={busy} onClick={() => void read([i.id])}>
                  Mark as read
                </button>
              )}
            </article>
          );
        })}
      </div>
      {q.data && q.data.total > q.data.items.length && (
        <p className="text-sm text-ink-dim">Showing your latest {q.data.items.length} updates.</p>
      )}
    </LearningLayout>
  );
}
