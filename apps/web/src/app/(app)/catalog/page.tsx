'use client';

/**
 * Published catalogue — the marketplace (SRS FR-5.4, §6.1).
 *
 * Browsing rules this screen follows:
 *
 * - **Nothing heavy loads unasked.** Cards carry metadata and a badge; the 3D model is fetched only
 *   when someone opens the quick look, one at a time. A grid of live canvases would be a slideshow.
 * - **Filtering is instant and local.** The catalogue is small enough to filter in the browser, so
 *   typing in the search box does not wait on a round trip.
 * - **The licence is the headline.** This is a licensed marketplace, not a file list: token id,
 *   licence type and status sit at the same level as the name.
 * - **Empty is a state, not an accident.** With nothing published, the screen explains why and what
 *   to do next rather than showing a blank grid.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api';
import { formatBytes, formatNumber, formatRelative, shortCid } from '../../../lib/format';
import { AssetQuickLook, type QuickLookAsset } from '../../../components/asset-quick-look';
import { CopyButton } from '../../../components/copy-button';
import { EmptyState, ErrorNote } from '../../../components/ui-kit';
import { useToast } from '../../../components/toast';
import { canPreviewNatively } from '../../../components/model-viewer';

interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly currentVersion: QuickLookAsset['currentVersion'];
  readonly license:
    | {
        readonly tokenId: string;
        readonly txHash: string | null;
        readonly status: string;
        readonly mintedAt: string;
        readonly licenseType?: string;
        readonly revokedAt?: string | null;
      }
    | null;
  readonly xrModuleUrl: string | null;
}

type SortKey = 'recent' | 'name' | 'polycount';

function Skeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <div key={key} className="vs-card">
          <div className="vs-card-well vs-skeleton" />
          <div className="space-y-2 p-3">
            <div className="vs-skeleton h-4 w-3/4" />
            <div className="vs-skeleton h-3 w-1/2" />
            <div className="vs-skeleton h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A labelled select that keeps its own state simple. */
function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { readonly value: string; readonly label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="vs-label shrink-0">{label}</span>
      <select className="vs-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function CatalogPage() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [preview, setPreview] = useState<CatalogItem | null>(null);

  const catalog = useQuery<{ items: readonly CatalogItem[]; total: number }>({
    queryKey: ['catalog'],
    queryFn: () =>
      apiFetch<{ items: readonly CatalogItem[]; total: number }>(
        '/assets?publishedOnly=true&pageSize=100',
      ),
  });

  const items = catalog.data?.items ?? [];

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort(),
    [items],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'polycount') {
        return (b.currentVersion?.polycount ?? 0) - (a.currentVersion?.polycount ?? 0);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [items, query, category, sort]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="vs-display text-4xl">Marketplace</h1>
          <p className="vs-prose mt-1">
            Published modules, each licensed on-chain. Open any one for an interactive preview — the
            model is streamed from IPFS only when you ask for it.
          </p>
        </div>
        <div className="text-right">
          <div className="vs-display vs-num text-2xl">{items.length}</div>
          <div className="vs-label">modules published</div>
        </div>
      </header>

      {/* Controls */}
      <div className="vs-panel flex flex-wrap items-center gap-3 p-3">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="vs-label shrink-0">Search</span>
          <input
            className="vs-input"
            type="search"
            value={query}
            placeholder="name, category or tag"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <Filter
          label="Category"
          value={category}
          onChange={setCategory}
          options={[
            { value: 'all', label: `ALL (${items.length})` },
            ...categories.map((value) => ({ value, label: value.toUpperCase() })),
          ]}
        />

        <Filter
          label="Sort"
          value={sort}
          onChange={(next) => setSort(next as SortKey)}
          options={[
            { value: 'recent', label: 'RECENTLY UPDATED' },
            { value: 'name', label: 'NAME (A–Z)' },
            { value: 'polycount', label: 'COMPLEXITY (HIGH → LOW)' },
          ]}
        />

        <button
          type="button"
          className="vs-btn vs-btn-quiet"
          onClick={() => {
            setQuery('');
            setCategory('all');
            setSort('recent');
            toast.info('Filters cleared');
          }}
        >
          RESET
        </button>
      </div>

      {catalog.isLoading ? <Skeleton /> : null}
      {catalog.error ? (
        <ErrorNote
          message={(catalog.error as Error).message}
          code="CATALOG_UNAVAILABLE"
        />
      ) : null}

      {!catalog.isLoading && items.length === 0 ? (
        <div className="vs-panel">
          <EmptyState
            title="Nothing published yet"
            hint="AN ASSET APPEARS HERE ONCE IT IS APPROVED AND PUBLISHED — THE LICENCE IS MINTED AT THAT MOMENT"
          />
        </div>
      ) : null}

      {!catalog.isLoading && items.length > 0 && visible.length === 0 ? (
        <div className="vs-panel">
          <EmptyState title="No match" hint="TRY A DIFFERENT SEARCH OR CLEAR THE CATEGORY FILTER" />
        </div>
      ) : null}

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((item) => {
          const version = item.currentVersion;
          const previewable = version?.ipfsCid && canPreviewNatively(version.format);
          const revoked = item.license && item.license.status !== 'active';

          return (
            <article key={item.id} className="vs-card group">
              <div className="vs-card-well">
                <div className="vs-card-badges">
                  <span
                    className="vs-data border px-1.5 py-[2px]"
                    style={{
                      borderColor: revoked ? 'var(--vs-accent)' : 'var(--vs-signal)',
                      color: revoked ? 'var(--vs-accent)' : 'var(--vs-signal)',
                    }}
                  >
                    {revoked ? 'LICENCE REVOKED' : item.license ? `TOKEN #${item.license.tokenId}` : 'UNLICENSED'}
                  </span>
                  <span className="vs-data border px-1.5 py-[2px]" style={{ borderColor: 'var(--vs-line-strong)', color: 'var(--vs-fg-dim)' }}>
                    {item.category.toUpperCase()}
                  </span>
                </div>

                {/* The well is a button: the whole area is a hit target, and its label says what
                    will happen rather than relying on the user guessing that a thumbnail is one. */}
                {previewable ? (
                  <button
                    type="button"
                    onClick={() => setPreview(item)}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                    style={{ color: 'var(--vs-fg-dim)' }}
                    aria-label={`Preview ${item.name} in 3D`}
                  >
                    <SchematicGlyph seed={item.id} />
                    <span className="vs-data text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
                      VIEW IN 3D
                    </span>
                  </button>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <SchematicGlyph seed={item.id} muted />
                    <span className="vs-label">NO BROWSER PREVIEW</span>
                  </div>
                )}

                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                  <span className="vs-data text-[10px] opacity-70">
                    {version?.polycount ? `${formatNumber(version.polycount)} TRI` : 'TRI —'}
                  </span>
                  <span className="vs-data text-[10px] opacity-70">{formatBytes(version?.sizeBytes)}</span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-3">
                <Link href={`/assets/${item.id}`} className="vs-display text-lg hover:underline">
                  {item.name}
                </Link>

                <div className="vs-label mt-1">
                  {version?.format.toUpperCase() ?? '—'}
                  {version?.dimensions
                    ? ` · ${version.dimensions.x} × ${version.dimensions.y} × ${version.dimensions.z} UNITS`
                    : ''}
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {item.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="vs-data border px-1.5 py-[2px]"
                      style={{ borderColor: 'var(--vs-line-strong)', color: 'var(--vs-fg-dim)' }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <dl className="mt-3 space-y-1 border-t pt-2" style={{ borderColor: 'var(--vs-line)' }}>
                  <div className="flex justify-between gap-2">
                    <dt className="vs-label">Content id</dt>
                    <dd className="vs-data opacity-80">{shortCid(version?.ipfsCid)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="vs-label">Licensed</dt>
                    <dd className="vs-data opacity-80">
                      {item.license ? formatRelative(item.license.mintedAt) : '—'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap gap-2">
                  {previewable ? (
                    <button
                      type="button"
                      className="vs-btn vs-btn-primary"
                      onClick={() => setPreview(item)}
                    >
                      VIEW IN 3D
                    </button>
                  ) : null}
                  <Link href={`/assets/${item.id}`} className="vs-btn vs-btn-quiet">
                    RECORD
                  </Link>
                  <CopyButton label="CID" value={version?.ipfsCid} compact />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {visible.length > 0 ? (
        <div className="vs-label">
          SHOWING {visible.length} OF {items.length}
        </div>
      ) : null}

      {preview ? <AssetQuickLook asset={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

/**
 * Deterministic line art for the card well.
 *
 * Deliberately not a fake render: it is a generated figure derived from the asset id, so cards have
 * visual rhythm without pretending to show geometry the browser has not downloaded. The honest
 * indication of what the model contains is the triangle count and the extent, which are measured.
 */
function SchematicGlyph({ seed, muted = false }: { seed: string; muted?: boolean }) {
  const stroke = muted ? 'var(--vs-line-strong)' : 'var(--vs-line-strong)';

  // A cheap deterministic hash: same asset, same figure, every render.
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
  }

  const rings = 3 + (hash % 3);
  const rotation = hash % 45;

  return (
    <svg
      width="86"
      height="86"
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden
      className="opacity-60 transition-opacity group-hover:opacity-90"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      {Array.from({ length: rings }, (_, index) => {
        const size = 18 + index * (58 / rings);
        return (
          <rect
            key={index}
            x={50 - size / 2}
            y={50 - size / 2}
            width={size}
            height={size}
            stroke={stroke}
            strokeWidth={1}
          />
        );
      })}
      <line x1="50" y1="8" x2="50" y2="92" stroke={stroke} strokeWidth={1} />
      <line x1="8" y1="50" x2="92" y2="50" stroke={stroke} strokeWidth={1} />
    </svg>
  );
}
