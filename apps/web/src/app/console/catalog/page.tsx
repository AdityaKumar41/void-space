'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingBag, ArrowUpRight, Box, Search } from 'lucide-react';

import { apiFetch } from '../../../lib/api';
import { formatBytes, formatNumber, formatRelative } from '../../../lib/format';
import { AssetQuickLook, type QuickLookAsset } from '../../../components/asset-quick-look';
import { ItemCard } from '../../../components/console-kit';
import { Reveal } from '../../../components/reveal';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';

interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly currentVersion: QuickLookAsset['currentVersion'];
  readonly license: {
    readonly tokenId: string;
    readonly txHash: string | null;
    readonly status: string;
    readonly mintedAt: string;
    readonly licenseType?: string;
    readonly revokedAt?: string | null;
  } | null;
  readonly xrModuleUrl: string | null;
}

type SortKey = 'recent' | 'name' | 'polycount';

const SORTS: readonly { readonly value: SortKey; readonly label: string }[] = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'polycount', label: 'Most detailed first' },
];

/** Above this an asset needs a decimation pass before it runs on a standalone headset (FR-3.4). */
const HEAVY_TRIANGLES = 150_000;

type Band = '' | 'light' | 'medium' | 'heavy';

function bandOf(polycount: number | null | undefined): Band {
  if (polycount === null || polycount === undefined) return '';
  if (polycount > HEAVY_TRIANGLES) return 'heavy';
  if (polycount > 50_000) return 'medium';
  return 'light';
}

export default function ConsoleCatalogPage() {
  const [query, setQuery] = useState('');
  useEffect(() => {
    setQuery(new URLSearchParams(location.search).get('q') ?? '');
  }, []);
  const [category, setCategory] = useState('');
  const [licence, setLicence] = useState('');
  const [band, setBand] = useState<Band>('');
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
    () =>
      [...new Set(items.map((item) => item.category))].sort().map((value) => ({
        value,
        label: value,
        count: items.filter((item) => item.category === value).length,
      })),
    [items],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (category && item.category !== category) return false;
      if (licence === 'active' && item.license?.status !== 'active') return false;
      if (licence === 'revoked' && item.license?.status !== 'revoked') return false;
      if (licence === 'none' && item.license !== null) return false;
      if (band && bandOf(item.currentVersion?.polycount) !== band) return false;
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
  }, [items, query, category, licence, band, sort]);

  const filtering = Boolean(query || category || licence || band);
  if (catalog.isLoading)
    return (
      <div className="learning-marketplace">
        <LoadingBlock label="Loading the marketplace" />
      </div>
    );
  if (catalog.error || !catalog.data) {
    return (
      <div className="learning-marketplace">
        <ErrorNote
          message={(catalog.error as Error)?.message ?? 'The marketplace is unavailable'}
        />
        <button className="agent-pill" onClick={() => void catalog.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="learning-marketplace">
      <header className="marketplace-heading">
        <div>
          <p className="marketplace-eyebrow">
            <ShoppingBag size={16} />
            Marketplace
          </p>
          <h1>Find your next learning model.</h1>
          <p>
            Explore published workspace assets. Preview a model, check its licence, or use it in a
            lesson.
          </p>
        </div>
        <Link className="agent-pill" href="/catalog">
          Public marketplace
          <ArrowUpRight size={16} />
        </Link>
      </header>
      <div className="marketplace-search-row">
        <label className="marketplace-search">
          <Search size={18} />
          <input
            type="search"
            aria-label="Search by name, category or tag"
            placeholder="Find a model…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Sort the marketplace"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="marketplace-filter-row">
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select aria-label="Licence" value={licence} onChange={(e) => setLicence(e.target.value)}>
          <option value="">All licences</option>
          <option value="active">Active licence</option>
          <option value="revoked">Revoked licence</option>
          <option value="none">Not licensed</option>
        </select>
        <select
          aria-label="Model complexity"
          value={band}
          onChange={(e) => setBand(e.target.value as Band)}
        >
          <option value="">All sizes</option>
          <option value="light">Under 50k triangles</option>
          <option value="medium">50k–150k triangles</option>
          <option value="heavy">Over 150k triangles</option>
        </select>
        <span role="status">
          {visible.length} {visible.length === 1 ? 'model' : 'models'}
          {catalog.data.total > items.length
            ? ` · first ${items.length} of ${catalog.data.total}`
            : ''}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="marketplace-empty">
          <Box size={42} strokeWidth={1} />
          <h2>{filtering ? 'No models match your search' : 'Your model collection starts here'}</h2>
          <p>
            {filtering
              ? 'Try another name or clear the filters.'
              : 'Published workspace models appear here. You can also browse the public marketplace or add a private model to your library.'}
          </p>
          {filtering ? (
            <button
              className="agent-pill"
              onClick={() => {
                setQuery('');
                setCategory('');
                setLicence('');
                setBand('');
              }}
            >
              Clear filters
            </button>
          ) : (
            <div>
              <Link className="agent-pill primary" href="/catalog">
                Browse public models
              </Link>
              <Link className="agent-pill" href="/console/learn/library">
                Open my library
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((item, position) => {
            const version = item.currentVersion;
            const heavy = bandOf(version?.polycount) === 'heavy';

            return (
              <Reveal key={item.id} delay={(position % 3) * 60}>
                <ItemCard
                  assetId={item.id}
                  name={item.name}
                  href={`/console/assets/${item.id}`}
                  collection={item.category}
                  cid={version?.ipfsCid ?? null}
                  polycount={version?.polycount ?? null}
                  sizeBytes={version?.sizeBytes ?? null}
                  badge={item.license ? `#${item.license.tokenId}` : undefined}
                  figure={`${formatNumber(version?.polycount ?? null)} tris`}
                  figureSub={`${formatBytes(version?.sizeBytes ?? 0)} · ${formatRelative(item.updatedAt)}${
                    heavy ? ' · heavy for XR' : ''
                  }`}
                  action={
                    // A button, not a link: the preview opens in place rather than navigating.
                    <button
                      type="button"
                      className="rounded-control border border-veil-8 bg-veil-6 px-3 py-1.5 text-[13px] font-semibold text-ink transition-colors duration-150 ease-standard hover:bg-veil-12"
                      onClick={() => setPreview(item)}
                    >
                      Preview
                    </button>
                  }
                />
              </Reveal>
            );
          })}
        </div>
      )}

      {preview ? <AssetQuickLook asset={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
