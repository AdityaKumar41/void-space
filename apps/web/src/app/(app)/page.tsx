'use client';

/**
 * Overview (SRS §6.1 "role-aware dashboards").
 *
 * One request renders the whole screen (`GET /dashboard`), which keeps the landing page fast
 * and keeps the six counters consistent with each other. The numbers are scoped by role on the
 * server: a Creator sees their library, a reviewer sees the tenant backlog.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { AssetStatus } from '@void-space/types';

import { apiFetch } from '../../lib/api';
import { useSession } from '../../lib/session';
import { formatBytes, formatNumber, formatRelative, shortId } from '../../lib/format';
import { ErrorNote, Loading, Panel, Sparkbars, Stat } from '../../components/ui-kit';

interface DashboardPayload {
  readonly scope: 'tenant' | 'own';
  readonly counts: {
    readonly assets: number;
    readonly byStatus: Partial<Record<AssetStatus, number>>;
    readonly awaitingReview: number;
    readonly myDrafts: number;
    readonly published: number;
    readonly licensesMinted: number;
    readonly users: number;
    readonly activeApiKeys: number;
    readonly storageBytes: number;
  };
  readonly jobsInFlight: readonly { queue: string; status: string; count: number }[];
  readonly recent: readonly {
    id: string;
    action: string;
    actorLabel: string | null;
    entityType: string;
    entityId: string | null;
    createdAt: string;
  }[];
  readonly ingest: readonly { day: string; count: number }[];
}

const STATUS_ORDER: readonly AssetStatus[] = [
  'draft',
  'pending',
  'needs_manual_review',
  'approved',
  'revision',
  'rejected',
  'published',
];

export default function OverviewPage() {
  const { can } = useSession();

  const { data, isLoading, error } = useQuery<DashboardPayload>({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch<DashboardPayload>('/dashboard'),
    refetchInterval: 15_000,
  });

  if (isLoading) return <Loading label="LOADING TELEMETRY" />;
  if (error || !data) {
    return <ErrorNote message={(error as Error)?.message ?? 'Dashboard unavailable'} />;
  }

  const totalInFlight = data.jobsInFlight.reduce((sum, job) => sum + job.count, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="vs-display text-4xl">Operations overview</h1>
          <div className="vs-label mt-1">
            SCOPE {data.scope === 'tenant' ? 'TENANT-WIDE' : 'OWN ASSETS'} / {data.counts.assets}{' '}
            ASSETS INDEXED
          </div>
        </div>
        <div className="vs-data text-right opacity-70">
          <div className="vs-cursor">QUEUE {totalInFlight} IN FLIGHT</div>
          <div className="mt-1">{formatBytes(data.counts.storageBytes)} ON DISK</div>
        </div>
      </div>

      <div className="vs-grid-lines grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting review" value={formatNumber(data.counts.awaitingReview)} hint="FR-4.1 backlog" tone={data.counts.awaitingReview > 0 ? 'accent' : 'default'} />
        <Stat label="Published" value={formatNumber(data.counts.published)} hint="live in catalog" tone="signal" />
        <Stat label="Licences minted" value={formatNumber(data.counts.licensesMinted)} hint="ERC-721 / Anvil" />
        <Stat label="My drafts" value={formatNumber(data.counts.myDrafts)} hint="not yet submitted" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title="Lifecycle distribution" right={`${data.counts.assets} TOTAL`}>
          <div className="vs-grid-lines grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
            {STATUS_ORDER.map((status) => (
              <div key={status} className="p-3">
                <div className="vs-label truncate">{status.replace(/_/g, ' ')}</div>
                <div className="vs-display vs-num mt-1 text-2xl">
                  {formatNumber(data.counts.byStatus[status] ?? 0)}
                </div>
              </div>
            ))}
          </div>

          <div className="vs-rule" />
          <div className="flex items-baseline justify-between px-3 pt-2">
            <span className="vs-label">Ingest volume / 14 days</span>
            <span className="vs-label">FR-3.5</span>
          </div>
          <Sparkbars data={data.ingest} />
        </Panel>

        <div className="space-y-4">
          <Panel title="Queue telemetry" right="§3.10">
            {data.jobsInFlight.length === 0 ? (
              <div className="vs-data p-3 opacity-60">NO JOBS PENDING</div>
            ) : (
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>Queue</th>
                    <th>State</th>
                    <th className="text-right">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobsInFlight.map((job) => (
                    <tr key={`${job.queue}-${job.status}`}>
                      <td className="vs-data">{job.queue}</td>
                      <td className="vs-data opacity-70">{job.status}</td>
                      <td className="vs-num text-right">{job.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Platform" right="FR-14.1">
            <div className="vs-grid-lines grid-cols-2">
              <Stat label="Members" value={formatNumber(data.counts.users)} />
              <Stat label="Active API keys" value={formatNumber(data.counts.activeApiKeys)} />
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        title="Recent activity"
        right={
          // audit:view is held by TenantAdmin / Compliance / SuperAdmin only (§3.6), so the
          // link is hidden for everyone else rather than leading to a 403.
          can('audit:view') ? (
            <Link href="/audit" className="vs-link">
              FULL LEDGER &gt;&gt;
            </Link>
          ) : (
            <span className="vs-label">SCOPED SLICE</span>
          )
        }
      >
        <table className="vs-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Entity</th>
              <th className="text-right">When</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((entry) => (
              <tr key={entry.id}>
                <td className="vs-data">{entry.action}</td>
                <td className="truncate opacity-80">{entry.actorLabel ?? '—'}</td>
                <td className="vs-data opacity-60">
                  {entry.entityType}/{shortId(entry.entityId, 6)}
                </td>
                <td className="vs-data whitespace-nowrap text-right opacity-70">
                  {formatRelative(entry.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
