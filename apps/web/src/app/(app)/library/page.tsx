'use client';

/**
 * Asset library (SRS FR-3.5, FR-3.1).
 *
 * A Creator's working set: filters, a dense table, and the intake panel. The table shows the
 * operator what the pipeline is doing — pin state, polycount, state — because "why is this
 * asset not in the review queue yet" is the question this screen exists to answer.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ASSET_STATUSES, type AssetStatus, type Paginated } from '@void-space/types';

import { apiFetch } from '../../../lib/api';
import { formatBytes, formatNumber, formatRelative, shortCid } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { UploadPanel } from '../../../components/upload-panel';
import { EmptyState, ErrorNote, Loading, Panel, StatusPill, Tag } from '../../../components/ui-kit';

interface AssetSummaryView {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly status: AssetStatus;
  readonly updatedAt: string;
  readonly creator: { id: string; fullName: string } | null;
  readonly currentVersion: {
    readonly versionNumber: number;
    readonly format: string;
    readonly sizeBytes: number;
    readonly polycount: number | null;
    readonly pinStatus: string;
    readonly ipfsCid: string | null;
  } | null;
}

interface TenantView {
  readonly settings: { readonly allowedCategories: readonly string[] };
}

export default function LibraryPage() {
  const { can } = useSession();
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page), pageSize: '24', sort: 'updatedAt', order: 'desc' });
  if (status) query.set('status', status);
  if (search.trim()) query.set('q', search.trim());

  const assets = useQuery<Paginated<AssetSummaryView>>({
    queryKey: ['assets', query.toString()],
    queryFn: () => apiFetch<Paginated<AssetSummaryView>>(`/assets?${query.toString()}`),
  });

  const tenant = useQuery<TenantView>({
    queryKey: ['tenant'],
    queryFn: () => apiFetch<{ tenant: TenantView }>('/tenant').then((result) => result.tenant),
  });

  const canUpload = can('asset:upload-own');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vs-display text-4xl">Asset library</h1>
          <div className="vs-label mt-1">
            {assets.data ? `${assets.data.total} RECORDS` : 'QUERYING'} / SCOPE{' '}
            {can('review:decide') ? 'TENANT' : 'OWN'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="vs-input w-56"
            placeholder="search name / tag"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <select
            className="vs-select w-44"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as AssetStatus | '');
              setPage(1);
            }}
          >
            <option value="">ALL STATES</option>
            {ASSET_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, ' ').toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={canUpload ? 'grid gap-4 xl:grid-cols-[2fr_1fr]' : ''}>
        <Panel title="Records" right={assets.data ? `PAGE ${assets.data.page}/${assets.data.totalPages}` : undefined}>
          {assets.isLoading ? <Loading /> : null}
          {assets.error ? <ErrorNote message={(assets.error as Error).message} /> : null}

          {assets.data && assets.data.items.length === 0 ? (
            <EmptyState title="No assets match" hint="ADJUST FILTERS OR INGEST A MODEL" />
          ) : null}

          {assets.data && assets.data.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>State</th>
                    <th>Ver</th>
                    <th>Poly</th>
                    <th>Size</th>
                    <th>Pin</th>
                    <th className="text-right">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.data.items.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <Link href={`/assets/${asset.id}`} className="vs-link font-medium">
                          {asset.name}
                        </Link>
                        <div className="vs-label mt-1">
                          {asset.category} / {asset.creator?.fullName ?? 'UNKNOWN'}
                        </div>
                        {asset.tags.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {asset.tags.slice(0, 4).map((tag) => (
                              <Tag key={tag}>{tag}</Tag>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <StatusPill status={asset.status} />
                      </td>
                      <td className="vs-data">v{asset.currentVersion?.versionNumber ?? '—'}</td>
                      <td className="vs-num">{formatNumber(asset.currentVersion?.polycount ?? null)}</td>
                      <td className="vs-num">{formatBytes(asset.currentVersion?.sizeBytes ?? 0)}</td>
                      <td className="vs-data opacity-70" title={asset.currentVersion?.ipfsCid ?? ''}>
                        {asset.currentVersion?.pinStatus === 'pinned'
                          ? shortCid(asset.currentVersion.ipfsCid)
                          : (asset.currentVersion?.pinStatus ?? '—').toUpperCase()}
                      </td>
                      <td className="vs-data whitespace-nowrap text-right opacity-70">
                        {formatRelative(asset.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {assets.data && assets.data.totalPages > 1 ? (
            <div className="flex items-center justify-between p-3">
              <button
                type="button"
                className="vs-btn"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                &lt;&lt; PREV
              </button>
              <span className="vs-label">
                PAGE {assets.data.page} OF {assets.data.totalPages}
              </span>
              <button
                type="button"
                className="vs-btn"
                disabled={page >= assets.data.totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                NEXT &gt;&gt;
              </button>
            </div>
          ) : null}
        </Panel>

        {canUpload ? (
          <Panel title="Ingest" right="FR-3.1">
            <UploadPanel categories={tenant.data?.settings.allowedCategories ?? []} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
