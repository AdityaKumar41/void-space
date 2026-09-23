/**
 * Model page — the public listing for one licensed asset (§6.1, FR-9.6).
 *
 * A Server Component. The only interactive part is the studio, so the licence terms, the token id and
 * the transaction hash are present in the initial HTML: those are the facts a buyer came for, and
 * they should not depend on a client bundle running.
 *
 * Layout follows how a technical buyer actually reads a listing: the model large and inspectable,
 * then what the file *is*, then what the licence *is*, with the single most useful action — take the
 * file — pinned in a rail that stays on screen while the specification is read.
 *
 * Everything shown comes from the anonymous catalogue projection. A delisted asset answers 404 — the
 * same answer as one that never existed — so the catalogue cannot be probed for takedowns.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MarketFooter, MarketHeader } from '../../../components/market-shell';
import { ModelStage } from '../../../components/model-stage';
import { formatBytes, formatDateTime, formatNumber, shortCid } from '../../../lib/format';
import {
  browseMarketplace,
  gatewayUrl,
  marketplaceItem,
  thumbnailUrl,
} from '../../../lib/public-api';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: { assetId: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const item = await marketplaceItem(params.assetId);
  if (!item) return { title: 'Model not found — VOID·SPACE' };

  return {
    title: `${item.name} — VOID·SPACE`,
    description:
      item.description ??
      `${item.name}, a licensed 3D asset published by ${item.tenantName} with verifiable on-chain provenance.`,
    openGraph: {
      title: `${item.name} — licensed 3D model`,
      description: item.description ?? `Licensed under ${item.licenseType}.`,
      images: [{ url: thumbnailUrl(item.ipfsCid), width: 1200, height: 900 }],
      type: 'article',
    },
  };
}

/** One label/value row in a specification or provenance panel. */
function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mk-spec-row">
      <span className="mk-spec-key">{label}</span>
      <span className="mk-spec-value">{children}</span>
    </div>
  );
}

/** A claim the listing makes, with the evidence for it. */
function Verified({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk-verify-row">
      <span className="mk-tick" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export default async function ModelPage({ params }: PageProps) {
  const item = await marketplaceItem(params.assetId);
  if (!item) notFound();

  // "More like this": the same category, minus the model being viewed.
  const related = await browseMarketplace({ category: item.category, limit: 5 });
  const relatedItems = related.items.filter((entry) => entry.assetId !== item.assetId).slice(0, 4);

  const explorer = process.env.NEXT_PUBLIC_CHAIN_EXPLORER_URL ?? '';

  return (
    <div className="mk-page">
      <MarketHeader current="catalogue" />

      <main id="main" className="mk-shell flex-1 py-8">
        <nav className="mb-6 flex items-center gap-2 text-[13px]" aria-label="Breadcrumb">
          <Link href="/" className="vs-link">
            Catalogue
          </Link>
          <span aria-hidden style={{ color: 'var(--vs-fg-faint)' }}>
            /
          </span>
          <Link href={`/?category=${encodeURIComponent(item.category)}`} className="vs-link">
            {item.category}
          </Link>
        </nav>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_368px]">
          {/* ------------------------------------------------------------- viewer column */}
          <div className="min-w-0">
            <ModelStage
              cid={item.ipfsCid}
              format={item.format}
              name={item.name}
              polycount={item.polycount}
            />

            <h1 className="mk-h2 mt-8">{item.name}</h1>

            <div
              className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]"
              style={{ color: 'var(--vs-fg-faint)' }}
            >
              <span>{item.tenantName}</span>
              <span aria-hidden>·</span>
              <span>{item.category}</span>
              <span aria-hidden>·</span>
              <span>published {formatDateTime(item.publishedAt).slice(0, 10)}</span>
            </div>

            {item.description ? (
              <p className="mk-lead mt-6">{item.description}</p>
            ) : (
              <p className="mk-lead mt-6" style={{ fontStyle: 'italic', opacity: 0.7 }}>
                No summary was published for this asset.
              </p>
            )}

            {item.tags.length > 0 ? (
              <div className="mk-tags mt-6">
                {item.tags.map((value) => (
                  <Link key={value} href={`/?tag=${encodeURIComponent(value)}`} className="mk-tag">
                    {value}
                  </Link>
                ))}
              </div>
            ) : null}

            {/* ------------------------------------------------------------ specification */}
            <div className="mk-panel mt-10">
              <div className="mk-panel-head">The file</div>
              <div className="mk-panel-body">
                <SpecRow label="Format">{item.format.replace(/^\./, '').toUpperCase()}</SpecRow>
                <SpecRow label="Triangles">{formatNumber(item.polycount)}</SpecRow>
                <SpecRow label="Vertices">{formatNumber(item.vertices)}</SpecRow>
                <SpecRow label="Materials">{formatNumber(item.materials)}</SpecRow>
                <SpecRow label="Texture maps">{formatNumber(item.textures)}</SpecRow>
                <SpecRow label="Animation clips">
                  {item.animations && item.animations > 0
                    ? formatNumber(item.animations)
                    : 'None — static geometry'}
                </SpecRow>
                <SpecRow label="File size">{formatBytes(Number(item.sizeBytes))}</SpecRow>
                <SpecRow label="Content address">
                  <a
                    className="vs-link"
                    href={gatewayUrl(item.ipfsCid)}
                    target="_blank"
                    rel="noreferrer"
                    title={item.ipfsCid}
                  >
                    <span className="vs-data">{shortCid(item.ipfsCid)}</span>
                  </a>{' '}
                  <span style={{ color: 'var(--vs-fg-faint)' }}>· open the raw file</span>
                </SpecRow>
              </div>
            </div>

            {/* -------------------------------------------------------------- provenance */}
            <div className="mk-panel mt-6">
              <div className="mk-panel-head">
                Licence provenance
                <span className="vs-chip vs-chip-live">on chain</span>
              </div>
              <div className="mk-panel-body">
                <SpecRow label="Licence">{item.licenseType}</SpecRow>
                <SpecRow label="Token id">
                  <span className="vs-data">#{item.tokenId ?? '—'}</span>
                </SpecRow>
                <SpecRow label="Contract">
                  {item.contractAddress ? (
                    explorer ? (
                      <a
                        className="vs-link vs-data"
                        href={`${explorer}/address/${item.contractAddress}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.contractAddress}
                      </a>
                    ) : (
                      <span className="vs-data">{item.contractAddress}</span>
                    )
                  ) : (
                    '—'
                  )}
                </SpecRow>
                <SpecRow label="Mint transaction">
                  {item.txHash ? (
                    explorer ? (
                      <a
                        className="vs-link vs-data"
                        href={`${explorer}/tx/${item.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        title={item.txHash}
                      >
                        {shortCid(item.txHash)}
                      </a>
                    ) : (
                      <span className="vs-data" title={item.txHash}>
                        {shortCid(item.txHash)}
                      </span>
                    )
                  ) : (
                    '—'
                  )}
                </SpecRow>
                {item.licenseMetadataCid ? (
                  <SpecRow label="Licence metadata">
                    <a
                      className="vs-link vs-data"
                      href={gatewayUrl(item.licenseMetadataCid)}
                      target="_blank"
                      rel="noreferrer"
                      title={item.licenseMetadataCid}
                    >
                      {shortCid(item.licenseMetadataCid)}
                    </a>
                  </SpecRow>
                ) : null}
                {item.xrManifestRef ? (
                  <SpecRow label="XR module">
                    <span className="vs-data">{item.xrManifestRef}</span>
                  </SpecRow>
                ) : null}
                {item.sourceLicense || item.sourceUrl ? (
                  <SpecRow label="Upstream source">
                    {item.sourceUrl ? (
                      <a className="vs-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
                        {item.sourceAttribution ?? item.sourceUrl}
                      </a>
                    ) : (
                      (item.sourceAttribution ?? item.sourceLicense)
                    )}
                    {item.sourceLicense ? (
                      <span style={{ color: 'var(--vs-fg-faint)' }}> · {item.sourceLicense}</span>
                    ) : null}
                  </SpecRow>
                ) : null}
              </div>
            </div>

            {/* ------------------------------------------------------------------ terms */}
            <div className="mk-panel mt-6">
              <div className="mk-panel-head">Licence terms</div>
              <div className="mk-panel-body">
                <p className="mk-terms">{item.licenseTerms ?? 'No additional terms were recorded.'}</p>
              </div>
            </div>
          </div>

          {/* --------------------------------------------------------------------- rail */}
          <aside className="mk-rail">
            <div className="mk-rail-card">
              <div className="flex items-center justify-between gap-3">
                <span className="vs-chip vs-chip-live">
                  <span className="mk-dot-live mr-1.5" aria-hidden />
                  listed
                </span>
                <span className="mk-id">token #{item.tokenId ?? '—'}</span>
              </div>

              <div className="mt-4 text-[13.5px]" style={{ color: 'var(--vs-fg-dim)' }}>
                Licensed under {item.licenseType}. The registry entry travels with the file, so these
                terms remain checkable after this page changes.
              </div>

              <a
                className="vs-btn vs-btn-primary mt-5 flex w-full justify-center"
                href={gatewayUrl(item.ipfsCid)}
                download
              >
                Download the model
              </a>

              <div className="mt-2 flex gap-2">
                <a
                  className="vs-btn flex-1 justify-center"
                  href={gatewayUrl(item.ipfsCid)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Preview raw
                </a>
                <Link className="vs-btn flex-1 justify-center" href={`/console/assets/${item.assetId}`}>
                  Console
                </Link>
              </div>

              <p className="mt-4 text-[12px] leading-relaxed" style={{ color: 'var(--vs-fg-faint)' }}>
                Downloading fetches the exact bytes the content address commits to. Nothing is served
                from a mutable store.
              </p>
            </div>

            <div className="mk-rail-card">
              <div className="mk-eyebrow">What this listing claims</div>
              <div className="mk-verify mt-4">
                <Verified>
                  <b>Pinned, not stored.</b> The file resolves from content address{' '}
                  <span className="vs-data">{shortCid(item.ipfsCid)}</span>.
                </Verified>
                <Verified>
                  <b>Measured in the viewer.</b> The studio counts the geometry it actually decoded, so
                  the record above can be checked against the file rather than trusted.
                </Verified>
                <Verified>
                  <b>Licence on chain.</b>{' '}
                  {item.tokenId ? (
                    <>Minted as ERC-721 token #{item.tokenId}</>
                  ) : (
                    <>Registered in the licence registry</>
                  )}
                  {item.txHash ? ' with its terms committed alongside.' : '.'}
                </Verified>
              </div>
            </div>

            {relatedItems.length > 0 ? (
              <div className="mk-rail-card">
                <div className="mk-eyebrow">More in {item.category}</div>
                <div className="mt-4 flex flex-col gap-2.5">
                  {relatedItems.map((entry) => (
                    <Link key={entry.assetId} href={`/m/${entry.assetId}`} className="mk-mini">
                      <img src={thumbnailUrl(entry.ipfsCid)} alt="" width={52} height={52} loading="lazy" />
                      <span className="min-w-0">
                        <span className="mk-mini-name block truncate">{entry.name}</span>
                        <span className="mk-mini-sub block">
                          {formatNumber(entry.polycount)} tris · {entry.licenseType}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </main>

      <MarketFooter />
    </div>
  );
}
