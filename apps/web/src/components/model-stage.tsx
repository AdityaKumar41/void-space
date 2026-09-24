'use client';

/**
 * The 3D stage.
 *
 * A thin client island around `ModelViewer` — the page around it stays a Server Component, so the
 * listing, the licence terms and the provenance table are readable (and crawlable) without a canvas
 * or any JavaScript beyond this component.
 *
 * There is no caption strip: the studio draws its own footer with the CID and the decoded triangle
 * count, and a second line of instructions underneath it was saying the same thing twice. The
 * wireframe and shading controls are likewise owned by `ModelViewer` alone — two controls for one
 * setting is how a UI starts disagreeing with itself.
 */
import { ModelViewer } from './model-viewer';

export interface ModelStageProps {
  readonly cid: string;
  readonly format: string;
  readonly name: string;
  readonly polycount: number | null;
  readonly dimensions?: { x: number; y: number; z: number } | null;
  /** `hero` gives the canvas more height for the storefront. */
  readonly variant?: 'default' | 'hero';
  /** Turntable until the visitor takes control — used by the storefront hero. */
  readonly autoRotate?: boolean;
  /** Compact drops the toolbar entirely (cards, quick-look). */
  readonly compact?: boolean;
  /** `sphere` normalises apparent size across models — used by the thumbnail render surface. */
  /**
   * Overrides the camera fit. Defaults to the viewer's own choice (`box`), which is the measure
   * that reproduces in the browser what the catalogue renders show.
   */
  readonly frameFit?: 'box' | 'sphere';
  /**
   * Storefront chrome: keeps the model and the orbit hint, hides the inspection studio. Set by the
   * marketplace hero, where the visitor is a buyer looking at a product rather than an artist
   * checking an export. The full studio is one click away on the model page.
   */
  readonly presentation?: boolean;
}

export function ModelStage({
  cid,
  format,
  name,
  polycount,
  dimensions,
  variant = 'default',
  autoRotate = false,
  compact = false,
  frameFit = 'box',
  presentation = false,
}: ModelStageProps) {
  return (
    <div className={variant === 'hero' ? 'mk-stage-bare' : 'mk-stage'}>
      <div className={variant === 'hero' ? 'mk-stage-canvas mk-stage-canvas-hero' : 'mk-stage-canvas'}>
        <ModelViewer
          cid={cid}
          format={format}
          label={name}
          recordedPolycount={polycount}
          dimensions={dimensions ?? null}
          autoRotate={autoRotate}
          compact={compact}
          frameFit={frameFit}
          presentation={presentation}
        />
      </div>
    </div>
  );
}
