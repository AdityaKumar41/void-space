/**
 * Marketplace — the public front door (§6.1 "Public Catalog", FR-5.2, FR-5.3).
 *
 * This route deliberately does **not** render the application shell and does not ask who is calling.
 * It served a console until now, which meant the root URL of a marketplace behaved like a staff tool:
 * a session check, a holding screen, then a redirect to sign-in. Nothing about that is what a visitor
 * following a shared link should get, and it also contradicted §6.1's own "Public Catalog".
 *
 * Rendered per request because it states a live fact — which licences are active right now — and a
 * takedown must take effect on the next request rather than when an ISR window expires. The content
 * comes from the anonymous API, which reads the publish-time projection rather than tenant tables, so
 * no tenant context is established at any point.
 */
import type { Metadata } from 'next';

import { HeroShowcase } from '../components/hero-showcase';
import { MarketFooter, MarketHeader } from '../components/market-shell';
import { MarketplaceBrowser } from '../components/marketplace-browser';
import { formatBytes, formatNumber } from '../lib/format';
import {
  browseMarketplace,
  marketplaceFacets,
  marketplaceStats,
  SORT_OPTIONS,
} from '../lib/public-api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'VOID·SPACE — licensed 3D asset catalogue',
  description:
    'Browse licensed 3D models with verifiable provenance. Every asset carries an ERC-721 licence and content-addressed storage on IPFS.',
};

interface PageProps {
  readonly searchParams: { category?: string; tag?: string; q?: string; sort?: string };
}

/** One of the three things that happen to an asset before it is listed. */
function Step({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mk-step-index">{index}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-2.5 text-[13.5px] leading-relaxed" style={{ color: 'var(--vs-fg-dim)' }}>
        {children}
      </p>
    </div>
  );
}

export default async function MarketplacePage({ searchParams }: PageProps) {
  const category = searchParams.category?.trim() || undefined;
  const tag = searchParams.tag?.trim() || undefined;
  const search = searchParams.q?.trim() || undefined;
  // Ignore an unknown `?sort=` rather than erroring: a stale bookmark should open the catalogue,
  // not a validation failure.
  const sort = SORT_OPTIONS.find((option) => option.value === searchParams.sort)?.value ?? 'newest';

  // One round trip each, in parallel: the grid, the facet counts and the headline figures.
  const [page, facets, stats] = await Promise.all([
    browseMarketplace({ category, tag, search, sort, limit: 24 }),
    marketplaceFacets(),
    marketplaceStats(),
  ]);

  return (
    <div className="mk-page">
      <MarketHeader current="catalogue" />

      <main id="main" className="flex-1">
        {/* ------------------------------------------------------------------------ hero */}
        <section className="mk-hero">
          <div className="mk-shell">
            <div className="mk-hero-split">
              <div>
                <span className="mk-eyebrow">Licensed 3D catalogue</span>

                <h1 className="mk-h1 mt-5">
                  Models you can <em>verify</em>, not just download.
                </h1>

                <p className="mk-lead mt-6">
                  Every asset here was reviewed by a person, stored by content hash, and licensed as an
                  ERC-721 token. The token id, the contract address and the transaction that minted it
                  are printed on the listing — so provenance is something you check rather than
                  something you accept.
                </p>

                <dl className="mk-figures-strip">
                  <div>
                    <dt>models licensed</dt>
                    <dd>{formatNumber(stats?.published ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>triangles indexed</dt>
                    <dd>{formatNumber(stats?.polygons ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>pinned to IPFS</dt>
                    <dd>{formatBytes(Number(stats?.bytes ?? 0))}</dd>
                  </div>
                  <div>
                    <dt>categories</dt>
                    <dd>{formatNumber(stats?.categories ?? 0)}</dd>
                  </div>
                </dl>
              </div>

              {/*
                A real licence, turning, above the fold. The catalogue below is a list of the same
                kind of thing — this is the one place a visitor can confirm that in a single gesture
                rather than by taking our word for it.
              */}
              <HeroShowcase items={page.items} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------- catalogue */}
        <section className="mk-shell pb-20">
          <MarketplaceBrowser
            initial={page}
            facets={facets}
            initialCategory={category}
            initialTag={tag}
            initialSearch={search}
            initialSort={sort}
          />
        </section>

        {/* ------------------------------------------------------------------ provenance */}
        <section id="provenance" style={{ borderTop: '1px solid var(--vs-line)', background: '#0a0a0c' }}>
          <div className="mk-shell py-16">
            <span className="mk-eyebrow">Why these listings can be checked</span>
            <h2 className="mk-h2 mt-4 max-w-2xl">
              Three things happen to an asset before it appears here.
            </h2>

            <div className="mk-steps mt-12">
              <Step index="01" title="A person reviews it">
                An assessor approves the asset, sends it back for revision, or rejects it — and the
                decision, the comment and the file version are written to an append-only ledger that no
                role can edit afterwards.
              </Step>
              <Step index="02" title="It is pinned by hash">
                The file is stored on IPFS and its content address is printed on the listing. The bytes
                you preview in the viewer are the bytes that address commits to, and the viewer measures
                the geometry it decoded so you can see the record and the file agree.
              </Step>
              <Step index="03" title="Its licence is minted">
                Publishing mints an ERC-721 licence carrying the content hash and the licence terms. The
                token id, contract and transaction are on the listing, so the terms travel with the
                asset instead of living in a database you have to trust.
              </Step>
            </div>
          </div>
        </section>
      </main>

      <MarketFooter />
    </div>
  );
}
