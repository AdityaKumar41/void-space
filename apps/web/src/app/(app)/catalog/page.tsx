'use client';

/** Published catalog (SRS FR-5.4, §6.1). The Viewer role sees exactly this and nothing else. */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../../../lib/api';
import { formatBytes, formatNumber, formatRelative, shortCid } from '../../../lib/format';
import { EmptyState, ErrorNote, Loading, Panel, Tag } from '../../../components/ui-kit';

interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly currentVersion: { polycount: number | null; sizeBytes: number; ipfsCid: string | null; format: string } | null;
  readonly license: { tokenId: string; txHash: string; status: string; mintedAt: string } | null;
  readonly xrModuleUrl: string | null;
}

export default function CatalogPage() {
  const catalog = useQuery<{ items: readonly CatalogItem[]; total: number }>({
    queryKey: ['catalog'],
    queryFn: () => apiFetch<{ items: readonly CatalogItem[]; total: number }>('/assets?publishedOnly=true&pageSize=48'),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="vs-display text-4xl">Published catalog</h1>
        <div className="vs-label mt-1">
          {catalog.data ? `${catalog.data.total} LICENSED MODULES` : 'QUERYING'} / CONTENT-ADDRESSED / ON-CHAIN LICENSED
        </div>
      </div>

      {catalog.isLoading ? <Loading /> : null}
      {catalog.error ? <ErrorNote message={(catalog.error as Error).message} /> : null}
      {catalog.data && catalog.data.items.length === 0 ? (
        <Panel title="Catalog">
          <EmptyState title="No published modules" hint="AN APPROVED ASSET BECOMES PUBLIC WHEN PUBLISHED" />
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(catalog.data?.items ?? []).map((item) => (
          <Panel
            key={item.id}
            title={item.category}
            right={item.license ? `TOKEN #${item.license.tokenId}` : 'UNLICENSED'}
          >
            <div className="p-3">
              <Link href={`/assets/${item.id}`} className="vs-display text-xl hover:underline">
                {item.name}
              </Link>
              <div className="vs-label mt-2">{item.currentVersion?.format} / {formatBytes(item.currentVersion?.sizeBytes ?? 0)} / {formatNumber(item.currentVersion?.polycount ?? null)} POLY</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags.slice(0, 5).map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
              <dl className="mt-3 space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="vs-label">CID</dt>
                  <dd className="vs-data opacity-80">{shortCid(item.currentVersion?.ipfsCid)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="vs-label">XR module</dt>
                  <dd className="vs-data truncate opacity-80">
                    {item.xrModuleUrl ? (
                      <a className="vs-link" href={item.xrModuleUrl} target="_blank" rel="noreferrer">
                        OPEN
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="vs-label">Licensed</dt>
                  <dd className="vs-data opacity-80">{formatRelative(item.license?.mintedAt ?? item.updatedAt)}</dd>
                </div>
              </dl>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
