'use client';

/** Audit ledger (SRS FR-13.1–FR-13.4). Append-only; the API has no write path for it. */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { apiFetch } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { RequirePermission } from '../../../components/permission-gate';
import { EmptyState, ErrorNote, Loading, Panel } from '../../../components/ui-kit';

interface AuditEntry {
  readonly id: string;
  readonly action: string;
  readonly actorLabel: string | null;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly createdAt: string;
  readonly txHash: string | null;
}

interface AuditPage {
  readonly items: readonly AuditEntry[];
  readonly total: number;
  readonly page: number;
  readonly totalPages: number;
  readonly actions: readonly string[];
  readonly actors: readonly { id: string; label: string }[];
}

/**
 * Permission check happens here, above the queries, not after they fail: a role the §3.6
 * matrix excludes never sends a request this screen would be refused for.
 */
export default function AuditPage() {
  return (
    <RequirePermission permission="audit:view">
      <AuditLedger />
    </RequirePermission>
  );
}

function AuditLedger() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page), pageSize: '40' });
  if (action) query.set('action', action);

  const log = useQuery<AuditPage>({
    queryKey: ['audit', query.toString()],
    queryFn: () => apiFetch<AuditPage>(`/audit?${query.toString()}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vs-display text-4xl">Audit ledger</h1>
          <div className="vs-label mt-1">
            {log.data ? `${log.data.total} ENTRIES` : 'QUERYING'} / APPEND-ONLY (WRITE REVOKED AT THE DATABASE)
          </div>
        </div>
        <select
          className="vs-select w-64"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
        >
          <option value="">ALL ACTIONS</option>
          {(log.data?.actions ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <Panel title="Event stream" right={log.data ? `PAGE ${log.data.page}/${log.data.totalPages}` : undefined}>
        {log.isLoading ? <Loading /> : null}
        {log.error ? <ErrorNote message={(log.error as Error).message} /> : null}
        {log.data && log.data.items.length === 0 ? <EmptyState title="No entries" /> : null}

        {log.data && log.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="vs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Entity</th>
                  <th>Chain</th>
                </tr>
              </thead>
              <tbody>
                {log.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="vs-data whitespace-nowrap opacity-70">{formatDateTime(entry.createdAt)}</td>
                    <td className="vs-data">{entry.action}</td>
                    <td className="truncate opacity-80">{entry.actorLabel ?? 'SYSTEM'}</td>
                    <td className="vs-data opacity-60">
                      {entry.entityType}
                      {entry.entityId ? `/${entry.entityId.slice(0, 8)}` : ''}
                    </td>
                    <td className="vs-data opacity-60">{entry.txHash ? `${entry.txHash.slice(0, 12)}…` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {log.data && log.data.totalPages > 1 ? (
          <div className="flex items-center justify-between p-3">
            <button type="button" className="vs-btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              &lt;&lt; PREV
            </button>
            <span className="vs-label">
              PAGE {log.data.page} OF {log.data.totalPages}
            </span>
            <button
              type="button"
              className="vs-btn"
              disabled={page >= log.data.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              NEXT &gt;&gt;
            </button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
