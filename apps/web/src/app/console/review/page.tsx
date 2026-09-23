'use client';

/** Assessor triage queue (SRS FR-4.1, FR-4.3, §6.1). Oldest submission first. */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AssetStatus } from '@void-space/types';

import { apiFetch } from '../../../lib/api';
import { formatBytes, formatHours, formatNumber } from '../../../lib/format';
import { RequirePermission } from '../../../components/permission-gate';
import { EmptyState, ErrorNote, Loading, Panel, Stat, StatusPill, Tag } from '../../../components/ui-kit';

interface QueueItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly status: AssetStatus;
  readonly creator: { fullName: string } | null;
  readonly version: { versionNumber: number; format: string; sizeBytes: number; polycount: number | null; pinStatus: string } | null;
  readonly ai: { confidence: number; tags: readonly string[]; qualityFlags: readonly string[]; needsManualReview: boolean; modelVersion: string } | null;
  readonly waitingHours: number | null;
}

interface QueuePage {
  readonly items: readonly QueueItem[];
  readonly total: number;
  readonly page: number;
  readonly totalPages: number;
}

interface Stats {
  readonly awaitingReview: number;
  readonly approvedTotal: number;
  readonly rejectedTotal: number;
  readonly revisionTotal: number;
  readonly averageReviewHours: number | null;
  readonly oldestWaitingHours: number | null;
}

/**
 * Permission check happens here, above the queries, not after they fail: a role the §3.6
 * matrix excludes never sends a request this screen would be refused for.
 */
export default function ReviewQueuePage() {
  return (
    <RequirePermission permission="review:view-queue">
      <ReviewQueue />
    </RequirePermission>
  );
}

function ReviewQueue() {
  const [bucket, setBucket] = useState<'pending' | 'needs_manual_review'>('pending');

  const stats = useQuery<Stats>({
    queryKey: ['review', 'stats'],
    queryFn: () => apiFetch<{ stats: Stats }>('/review/stats').then((r) => r.stats),
    refetchInterval: 20_000,
  });

  const queue = useQuery<QueuePage>({
    queryKey: ['review', 'queue', bucket],
    queryFn: () => apiFetch<QueuePage>(`/review/queue?status=${bucket}&pageSize=25`),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vs-display text-4xl">Review queue</h1>
          <div className="vs-label mt-1">
            OLDEST FIRST / AVG DECISION {formatHours(stats.data?.averageReviewHours ?? null)} / OLDEST WAITING{' '}
            {formatHours(stats.data?.oldestWaitingHours ?? null)}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="vs-btn" data-active={bucket === 'pending'} onClick={() => setBucket('pending')}>
            IN REVIEW
          </button>
          <button
            type="button"
            className="vs-btn"
            data-active={bucket === 'needs_manual_review'}
            onClick={() => setBucket('needs_manual_review')}
          >
            MANUAL
          </button>
        </div>
      </div>

      <div className="vs-stat-strip grid-cols-2 lg:grid-cols-5">
        <Stat label="Awaiting" value={formatNumber(stats.data?.awaitingReview ?? 0)} tone="accent" />
        <Stat label="Approved" value={formatNumber(stats.data?.approvedTotal ?? 0)} tone="signal" />
        <Stat label="Rejected" value={formatNumber(stats.data?.rejectedTotal ?? 0)} />
        <Stat label="Revisions" value={formatNumber(stats.data?.revisionTotal ?? 0)} />
        <Stat label="Avg decision" value={formatHours(stats.data?.averageReviewHours ?? null)} hint="submit → decision" />
      </div>

      <Panel title={bucket === 'pending' ? 'Awaiting decision' : 'Flagged for manual classification'} right={queue.data ? `${queue.data.total} ITEMS` : undefined}>
        {queue.isLoading ? <Loading /> : null}
        {queue.error ? <ErrorNote message={(queue.error as Error).message} /> : null}
        {queue.data && queue.data.items.length === 0 ? <EmptyState title="Queue clear" hint="NOTHING AWAITING DECISION" /> : null}

        {queue.data && queue.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="vs-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>AI signal</th>
                  <th>Poly</th>
                  <th>Size</th>
                  <th className="text-right">Waiting</th>
                  <th className="text-right">Decide</th>
                </tr>
              </thead>
              <tbody>
                {queue.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/console/assets/${item.id}`} className="vs-link font-medium">
                        {item.name}
                      </Link>
                      <div className="vs-label mt-1">
                        {item.category} / {item.creator?.fullName ?? 'UNKNOWN'} / V{item.version?.versionNumber ?? '—'}
                      </div>
                    </td>
                    <td>
                      {item.ai ? (
                        <div>
                          <div className="vs-data" style={{ color: item.ai.confidence < 0.5 ? 'var(--vs-accent)' : 'var(--vs-signal)' }}>
                            CONF {(item.ai.confidence * 100).toFixed(0)}% / {item.ai.modelVersion}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.ai.tags.slice(0, 3).map((tag) => (
                              <Tag key={tag}>{tag}</Tag>
                            ))}
                            {item.ai.qualityFlags.slice(0, 2).map((flag) => (
                              <Tag key={flag} tone="accent">
                                {flag}
                              </Tag>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="vs-data opacity-50">PENDING</span>
                      )}
                    </td>
                    <td className="vs-num">{formatNumber(item.version?.polycount ?? null)}</td>
                    <td className="vs-num">{formatBytes(item.version?.sizeBytes ?? 0)}</td>
                    <td className="vs-data whitespace-nowrap text-right">{formatHours(item.waitingHours)}</td>
                    <td className="text-right">
                      <StatusPill status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
