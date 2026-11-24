import type { Metadata } from 'next';

import Link from 'next/link';
import { Box, ArrowUpRight } from 'lucide-react';
import { MarketFooter, MarketHeader } from '../../components/market-shell';
import { MarketplaceBrowser } from '../../components/marketplace-browser';
import { browseMarketplace, marketplaceFacets, SORT_OPTIONS } from '../../lib/public-api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Catalogue — licensed 3D assets · VOID·SPACE',
  description:
    'Browse licensed 3D models with verifiable provenance. Every asset carries an ERC-721 licence and content-addressed storage on IPFS.',
};

interface PageProps {
  readonly searchParams: Promise<{
    category?: string;
    tag?: string;
    q?: string;
    search?: string;
    sort?: string;
  }>;
}

export default async function CatalogPage({ searchParams: pendingSearchParams }: PageProps) {
  const searchParams = await pendingSearchParams;
  const category = searchParams.category?.trim() || undefined;
  const tag = searchParams.tag?.trim() || undefined;
  const search = (searchParams.search ?? searchParams.q)?.trim() || undefined;
  // Ignore an unknown `?sort=` rather than erroring: a stale bookmark should open the catalogue, not a
  // validation failure.
  const sort = SORT_OPTIONS.find((option) => option.value === searchParams.sort)?.value ?? 'newest';

  // One round trip each, in parallel: the grid, the facet counts and the headline figures.
  const [page, facets] = await Promise.all([
    browseMarketplace({ category, tag, search, sort, limit: 24 }),
    marketplaceFacets(),
  ]);

  return (
    <div className="public-marketplace">
      <MarketHeader current="catalog" />
      <main id="main" className="public-marketplace-main">
        <header className="marketplace-heading">
          <div>
            <p className="marketplace-eyebrow">
              <Box size={16} />
              3D model marketplace
            </p>
            <h1>A new way to see what you’re learning.</h1>
            <p>
              Find a model, explore it in 3D and check the licence before using it. Your personal
              models stay in your private library.
            </p>
          </div>
          <Link className="agent-pill" href="/console/learn/library">
            My library
            <ArrowUpRight size={16} />
          </Link>
        </header>
        <MarketplaceBrowser
          initial={page}
          facets={facets}
          initialCategory={category}
          initialTag={tag}
          initialSearch={search}
          initialSort={sort}
        />
      </main>
      <MarketFooter />
    </div>
  );
}
