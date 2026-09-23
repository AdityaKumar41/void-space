'use client';

/**
 * A single catalogue card.
 *
 * The media well prefers the pre-rendered render and falls back to the model's own file on the
 * gateway. It does **not** mount a live viewer per card: a grid of ten WebGL contexts is what makes
 * a 3D marketplace feel broken on a laptop, and the interactive view is one click away.
 *
 * Figures are the ones a buyer filters on — triangle count, file size, licence — not marketing copy.
 * The `heavy` note is a genuinely useful warning rather than a badge: a quarter-million-triangle scan
 * will not run on a standalone headset without decimation, and the person who needs to know that is
 * the person scanning the grid.
 */
import Link from 'next/link';
import { useState } from 'react';
import type { PublicCatalogItem } from '@void-space/types';

import { formatBytes, formatNumber } from '../lib/format';
import { gatewayUrl, thumbnailUrl } from '../lib/public-api';

/** Above this, the asset needs a decimation pass before it goes into a headset (FR-3.4 budget). */
const HEAVY_TRIANGLES = 150_000;

export function MarketCard({ item }: { item: PublicCatalogItem }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const heavy = item.polycount !== null && item.polycount > HEAVY_TRIANGLES;

  return (
    <article className="mk-card">
      <Link
        href={`/m/${item.assetId}`}
        className="mk-card-media"
        aria-label={`Open ${item.name}`}
      >
        {thumbnailFailed ? (
          <div className="mk-card-empty">render unavailable</div>
        ) : (
          // A plain <img>, not next/image: these are already correctly sized renders served from our
          // own route handler, so the optimizer would only add a second cache in front of a cache.
          <img
            src={thumbnailUrl(item.ipfsCid)}
            alt={`Render of ${item.name}`}
            loading="lazy"
            width={1200}
            height={900}
            onError={() => setThumbnailFailed(true)}
          />
        )}

        <span className="mk-card-overlay">
          <span>Open in the 3D studio</span>
          <span aria-hidden>→</span>
        </span>
      </Link>

      <div className="mk-card-body">
        <h3 className="mk-card-title">
          <Link href={`/m/${item.assetId}`}>{item.name}</Link>
        </h3>

        <div className="mk-card-sub">
          {item.category} · {item.tenantName}
        </div>

        <div className="mk-card-figures">
          <span className="mk-figure">
            {formatNumber(item.polycount)} <b>tris</b>
          </span>
          <span className="mk-figure">
            {formatBytes(Number(item.sizeBytes))}
          </span>
          <span className="mk-figure">
            <b>token</b> #{item.tokenId ?? '—'}
          </span>
        </div>

        <div className="mk-card-license">
          <span className="vs-chip vs-chip-live">
            <span className="mk-dot-live mr-1.5" aria-hidden />
            {item.licenseType}
          </span>
          {heavy ? (
            <span className="vs-chip" title="High-detail asset: needs decimation for standalone headsets">
              heavy for XR
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Exposed for the detail page's provenance panel, which links content through the same gateway. */
export { gatewayUrl };
