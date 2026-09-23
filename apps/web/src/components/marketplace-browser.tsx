'use client';

/**
 * Catalogue browser (§6.1 "Public Catalog").
 *
 * The first page of results is server-rendered and passed in as `initial`, so a visitor following a
 * shared link sees models immediately rather than a spinner. Filtering then re-queries the API rather
 * than filtering in memory: facet counts and totals must describe the whole catalogue, and a client
 * that filters its own page is what makes a marketplace claim a category is empty while showing
 * "5 of 24".
 *
 * Filter state is mirrored into the URL with `history.replaceState`, not `router.replace`. The page
 * is rendered per request, so a router navigation would re-render the Server Component *and* re-run
 * the query — two round trips for one keystroke. `replaceState` keeps the link shareable, which is
 * the actual goal, and costs nothing.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type {
  PublicCatalogFacets,
  PublicCatalogPage,
  PublicCatalogSort,
} from '@void-space/types';

import { apiFetch } from '../lib/api';
import { formatNumber } from '../lib/format';
import { SORT_OPTIONS } from '../lib/public-api';
import { MarketCard } from './market-card';

export interface MarketplaceBrowserProps {
  readonly initial: PublicCatalogPage;
  readonly facets: PublicCatalogFacets | null;
  /** Filters that arrived in the URL, so a shared link opens the same view. */
  readonly initialCategory?: string | undefined;
  readonly initialTag?: string | undefined;
  readonly initialSearch?: string | undefined;
  readonly initialSort?: PublicCatalogSort | undefined;
}

function buildQuery(params: {
  category?: string | undefined;
  tag?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}): string {
  const search = new URLSearchParams();
  if (params.category) search.set('category', params.category);
  if (params.tag) search.set('tag', params.tag);
  if (params.search) search.set('search', params.search);
  // `newest` is the server default, so it is left out of the URL rather than spelled out.
  if (params.sort && params.sort !== 'newest') search.set('sort', params.sort);
  const value = search.toString();
  return value.length > 0 ? `?${value}` : '';
}

export function MarketplaceBrowser({
  initial,
  facets,
  initialCategory,
  initialTag,
  initialSearch,
  initialSort = 'newest',
}: MarketplaceBrowserProps) {
  const [category, setCategory] = useState(initialCategory ?? '');
  const [tag, setTag] = useState(initialTag ?? '');
  const [searchInput, setSearchInput] = useState(initialSearch ?? '');
  const [search, setSearch] = useState(initialSearch ?? '');
  const [sort, setSort] = useState<PublicCatalogSort>(initialSort);

  // Debounced so a six-character query is one request, not six.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 320);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const isDefaultView = !category && !tag && !search && sort === 'newest';

  const query = useQuery<PublicCatalogPage>({
    queryKey: ['marketplace', category, tag, search, sort],
    queryFn: () =>
      apiFetch<PublicCatalogPage>(`/public/catalog${buildQuery({ category, tag, search, sort })}`),
    // The unfiltered first page was already rendered on the server.
    initialData: isDefaultView ? initial : undefined,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  // Keep the address bar honest so the view can be shared or reloaded.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = `${window.location.pathname}${buildQuery({ category, tag, search, sort })}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next);
    }
  }, [category, tag, search, sort]);

  const page = query.data ?? initial;
  const items = page.items;

  const clearAll = useCallback(() => {
    setCategory('');
    setTag('');
    setSearchInput('');
    setSearch('');
    setSort('newest');
  }, []);

  const categories = facets?.categories ?? [];
  const showChips = categories.length > 1;

  return (
    <div id="catalogue" className="pt-6">
      <div className="mk-filter">
        <label className="mk-search">
          <span className="mk-sr">Search the catalogue</span>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search models, tags, categories"
          />
        </label>

        {showChips ? (
          <div className="mk-chips" role="group" aria-label="Filter by category">
            <button
              type="button"
              className="mk-chip"
              aria-pressed={category === ''}
              onClick={() => setCategory('')}
            >
              All
            </button>
            {categories.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="mk-chip"
                aria-pressed={category === entry.value}
                onClick={() => setCategory(category === entry.value ? '' : entry.value)}
              >
                {entry.value}
                <span style={{ opacity: 0.55, marginLeft: 6 }}>{entry.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/*
          Sorting re-queries the server rather than reordering the page in memory: the grid is one
          page of a larger catalogue, so sorting client-side would sort the visible rows and call
          that "largest file".
        */}
        <label className="mk-sort">
          <span className="mk-sr">Sort by</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as PublicCatalogSort)}
            aria-label="Sort the catalogue"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <span className="mk-count" aria-live="polite">
          {query.isFetching
            ? 'Searching…'
            : `${formatNumber(page.total)} model${page.total === 1 ? '' : 's'}`}
        </span>
      </div>

      {tag || search ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {tag ? (
            <button type="button" className="mk-tag" onClick={() => setTag('')} title="Remove this filter">
              tag: {tag} <span aria-hidden>×</span>
            </button>
          ) : null}
          {search ? (
            <button
              type="button"
              className="mk-tag"
              onClick={() => {
                setSearchInput('');
                setSearch('');
              }}
              title="Remove this filter"
            >
              “{search}” <span aria-hidden>×</span>
            </button>
          ) : null}
          <button type="button" className="vs-link text-[12.5px]" onClick={clearAll}>
            Clear all
          </button>
        </div>
      ) : null}

      <div className="mt-7">
        {query.isLoading ? (
          <div className="mk-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="mk-card">
                <div className="mk-card-media vs-skeleton" />
                <div className="mk-card-body">
                  <div className="vs-skeleton h-4 w-3/4" />
                  <div className="vs-skeleton h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mk-panel">
            <div className="mk-panel-body px-6 py-16 text-center">
              <div className="mk-h2">Nothing matches that</div>
              <p className="mk-lead mx-auto mt-3 text-[14px]">
                {isDefaultView
                  ? 'The catalogue is empty. A model appears here once it has been reviewed and its licence is minted on chain.'
                  : 'Try a broader search, or clear the filters to see the whole catalogue.'}
              </p>
              {!isDefaultView ? (
                <button type="button" className="vs-btn mt-6" onClick={clearAll}>
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mk-grid">
            {items.map((item) => (
              <MarketCard key={item.assetId} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
