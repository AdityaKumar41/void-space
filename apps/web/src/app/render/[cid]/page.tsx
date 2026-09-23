'use client';

/**
 * Headless render surface for thumbnail generation.
 *
 * Deliberately outside the authenticated console: it renders one model, full-bleed, with no
 * navigation, no session and no chrome, so a screenshot of it is exactly the asset.
 *
 * `scripts/render-thumbnails.mjs` drives this page with a real browser and saves the canvas, which is
 * how the marketplace gets genuine preview images instead of decorative placeholders. Rendering is a
 * build-time step, not a request-time one: a card must never cost a 13 MB download.
 */
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { ModelViewer } from '../../../components/model-viewer';

function RenderSurface() {
  const params = useParams<{ cid: string }>();
  const search = useSearchParams();
  const format = search.get('format') ?? '.glb';

  return (
    <div className="fixed inset-0">
      <ModelViewer
        cid={params.cid}
        format={format}
        compact
        // Fill more of the frame than the interactive viewer: a thumbnail has no toolbar to dodge.
        fill={0.84}
      />
    </div>
  );
}

export default function RenderPage() {
  return (
    <Suspense fallback={null}>
      <RenderSurface />
    </Suspense>
  );
}
