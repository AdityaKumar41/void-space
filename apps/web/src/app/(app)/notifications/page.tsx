'use client';

/** Notification centre (SRS FR-12.1–FR-12.3, FR-11.3). */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../../lib/api';
import { formatRelative } from '../../../lib/format';
import { EmptyState, ErrorNote, Loading, Panel } from '../../../components/ui-kit';

interface NotificationItem {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly readAt: string | null;
  readonly createdAt: string;
}

/** Falls back to a readable label: seeded demo rows carry no title, only a type. */
function label(item: NotificationItem): string {
  const title = item.payload['title'];
  if (typeof title === 'string' && title.length > 0) return title;
  return item.type.replace(/[._]/g, ' ').toUpperCase();
}

function body(item: NotificationItem): string | null {
  const value = item.payload['body'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const notifications = useQuery<{ items: readonly NotificationItem[]; unreadCount: number; total: number }>({
    queryKey: ['notifications'],
    queryFn: () => apiFetch('/notifications?pageSize=50'),
  });

  async function markAllRead() {
    await apiFetch('/notifications/read', { method: 'POST', body: {} });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vs-display text-4xl">Alerts</h1>
          <div className="vs-label mt-1">
            {notifications.data ? `${notifications.data.unreadCount} UNREAD / ${notifications.data.total} TOTAL` : 'QUERYING'}
          </div>
        </div>
        <button type="button" className="vs-btn" onClick={() => void markAllRead()}>
          MARK ALL READ
        </button>
      </div>

      <Panel title="Event feed">
        {notifications.isLoading ? <Loading /> : null}
        {notifications.error ? <ErrorNote message={(notifications.error as Error).message} /> : null}
        {notifications.data && notifications.data.items.length === 0 ? (
          <EmptyState title="No alerts" hint="REVIEW DECISIONS AND PUBLISHES WILL APPEAR HERE" />
        ) : null}

        {notifications.data && notifications.data.items.length > 0 ? (
          <ul>
            {notifications.data.items.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-4 border-b p-3"
                style={{ borderColor: 'var(--vs-line)' }}
              >
                <div className="min-w-0">
                  <div className={item.readAt ? 'vs-data' : 'vs-data vs-accent'}>{label(item)}</div>
                  {body(item) ? <div className="mt-1 text-[12px] opacity-80">{body(item)}</div> : null}
                  <div className="vs-label mt-1">{item.type}</div>
                </div>
                <span className="vs-label whitespace-nowrap">{formatRelative(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
    </div>
  );
}
