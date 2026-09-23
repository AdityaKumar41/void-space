'use client';

/**
 * The storefront hero: one real licence, turning, from the actual catalogue.
 *
 * The point of putting a live model above the fold is that the page's central claim — "the bytes you
 * preview are the bytes the hash commits to" — becomes something a visitor confirms by dragging,
 * rather than something they read. A static render would be a photograph of a 3D asset, which is
 * exactly the thing being argued against.
 *
 * The switcher exists because one hero model says "here is a model"; three say "here is a
 * catalogue". Only the featured model is ever mounted, so the page still holds exactly one WebGL
 * context.
 */
import Link from 'next/link';
import { useState } from 'react';
import type { PublicCatalogItem } from '@void-space/types';

import { formatNumber } from '../lib/format';
import { thumbnailUrl } from '../lib/public-api';
import { ModelStage } from './model-stage';
import { ModelStageFallback } from './model-stage-fallback';

/** Only the first few are offered as a switcher; beyond that the grid below is the right tool. */
const MAX_SWITCHER = 4;

export function HeroShowcase({ items }: { readonly items: readonly PublicCatalogItem[] }) {
  const [index, setIndex] = useState(0);
  const options = items.slice(0, MAX_SWITCHER);
  const featured = options[index] ?? options[0];

  if (!featured) {
    return (
      <div className="mk-hero-stage">
        <ModelStageFallback
          title="No models are listed yet"
          body="A model appears here once it has been reviewed and its licence has been minted on chain."
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mk-hero-stage">
        <ModelStage
          cid={featured.ipfsCid}
          format={featured.format}
          name={featured.name}
          polycount={featured.polycount}
          variant="hero"
          autoRotate
          presentation
        />

        <div className="mk-hero-stage-name">
          <div className="min-w-0">
            <div className="mk-card-title truncate">{featured.name}</div>
            <div className="mk-card-sub mt-1">
              {featured.category} · {formatNumber(featured.polycount)} tris ·{' '}
              {featured.licenseType} · token #{featured.tokenId ?? '—'}
            </div>
          </div>
          <Link href={`/m/${featured.assetId}`} className="vs-btn vs-btn-primary shrink-0">
            Open
          </Link>
        </div>
      </div>

      {options.length > 1 ? (
        /*
          A fixed four-column grid rather than a flex row of `flex-1` items. Flex items refuse to
          shrink below their content width, so four tiles each holding a 52px render plus a name
          overflowed the hero column and clipped the last one. A grid column can be narrower than its
          content, and `min-w-0` on the tile lets the name truncate instead of pushing the row wider.
        */
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group" aria-label="Featured models">
          {options.map((item, position) => (
            <button
              key={item.assetId}
              type="button"
              onClick={() => setIndex(position)}
              className="mk-mini min-w-0"
              style={
                position === index
                  ? { borderColor: 'var(--vs-line-strong)', background: 'var(--vs-surface-2)' }
                  : undefined
              }
              aria-pressed={position === index}
              title={`Show ${item.name}`}
            >
              <img src={thumbnailUrl(item.ipfsCid)} alt="" width={52} height={52} loading="lazy" />
              <span className="min-w-0">
                <span className="mk-mini-name block truncate">{item.name}</span>
                <span className="mk-mini-sub block truncate">
                  {formatNumber(item.polycount)} tris
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
