'use client';

/**
 * Quick-look dialog: inspect a model without leaving the catalogue.
 *
 * Why a dialog rather than a canvas per card: the bundled whale skeleton is 13.6 MB with 28
 * textures. A grid that mounted a live viewer per card would pull hundreds of megabytes and freeze
 * the page — the single most common way 3D marketplaces become unusable. One canvas, opened on
 * demand, lazy-loaded, and reused for every card.
 *
 * Accessibility is not optional for a modal: focus is trapped while it is open, Escape closes it,
 * the background is made inert to screen readers, and focus returns to the control that opened it.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ModelViewer } from './model-viewer';
import { CopyButton } from './copy-button';

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface QuickLookAsset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly currentVersion: {
    readonly format: string;
    readonly sizeBytes: number;
    readonly polycount: number | null;
    readonly ipfsCid: string | null;
    readonly dimensions: { x: number; y: number; z: number } | null;
    readonly stats: {
      readonly vertices: number | null;
      readonly materials: number | null;
      readonly textures: number | null;
      readonly animations: number | null;
    };
  } | null;
  readonly license: {
    readonly tokenId: string;
    readonly status: string;
    readonly txHash: string | null;
  } | null;
  readonly xrModuleUrl: string | null;
}

function bytes(value: number | null | undefined): string {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2" style={{ borderColor: 'var(--vs-line)' }}>
      <dt className="vs-label">{label}</dt>
      <dd className="vs-data truncate text-right">{children}</dd>
    </div>
  );
}

export function AssetQuickLook({
  asset,
  onClose,
}: {
  asset: QuickLookAsset;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);
  const [showDetails, setShowDetails] = useState(true);

  // Remember where focus came from, so closing puts the user back where they were.
  useEffect(() => {
    restoreTo.current = document.activeElement;
    panel.current?.focus();
    return () => (restoreTo.current as HTMLElement | null)?.focus?.();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      // Focus trap: cycle within the dialog rather than escaping to the page behind it.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const version = asset.currentVersion;
  const licence = asset.license;

  return (
    <div
      className="fixed inset-0 z-[9400] flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(5,5,5,0.86)' }}
      onMouseDown={(event) => {
        // Click-outside closes, but only when the press started on the backdrop itself.
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${asset.name} — 3D preview`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="vs-panel flex max-h-full w-full max-w-6xl flex-col"
      >
        <div className="vs-panel-head">
          <span className="truncate">[ {asset.name} ]</span>
          <div className="flex items-center gap-2">
            <span className="vs-data opacity-70">{asset.category}</span>
            <button type="button" className="vs-btn vs-btn-ghost" onClick={onClose} aria-label="Close preview">
              CLOSE ✕
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[1.7fr_1fr]">
          {/* The preview well. min-h keeps the canvas usable on a short laptop screen. */}
          <div className="relative min-h-[320px] border-b lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--vs-line-strong)' }}>
            <ModelViewer
              cid={version?.ipfsCid ?? null}
              format={version?.format ?? '.glb'}
              label={asset.name}
              dimensions={version?.dimensions ?? null}
              recordedPolycount={version?.polycount ?? null}
            />
          </div>

          <aside className="min-h-0 overflow-y-auto p-4">
            <div className="flex flex-wrap gap-1">
              {asset.tags.slice(0, 8).map((tag) => (
                <span
                  key={tag}
                  className="vs-data border px-1.5 py-[2px]"
                  style={{ borderColor: 'var(--vs-line-strong)', color: 'var(--vs-fg-dim)' }}
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="vs-label">Geometry</span>
              <button
                type="button"
                className="vs-data opacity-60 hover:opacity-100"
                aria-expanded={showDetails}
                onClick={() => setShowDetails((value) => !value)}
              >
                {showDetails ? 'HIDE' : 'SHOW'}
              </button>
            </div>

            {showDetails ? (
              <dl className="mt-1">
                <Row label="Format">{version?.format.toUpperCase() ?? '—'}</Row>
                <Row label="Triangles">{version?.polycount?.toLocaleString() ?? '—'}</Row>
                <Row label="Vertices">{version?.stats.vertices?.toLocaleString() ?? '—'}</Row>
                <Row label="Materials">{version?.stats.materials ?? '—'}</Row>
                <Row label="Textures">{version?.stats.textures ?? '—'}</Row>
                <Row label="File size">{bytes(version?.sizeBytes)}</Row>
                <Row label="Extent">
                  {version?.dimensions
                    ? `${version.dimensions.x} × ${version.dimensions.y} × ${version.dimensions.z}`
                    : '—'}
                </Row>
              </dl>
            ) : null}

            <div className="mt-4 vs-label">Provenance</div>
            <dl className="mt-1">
              <Row label="Licence token">
                {licence ? `#${licence.tokenId}` : 'NOT LICENSED'}
              </Row>
              <Row label="Status">
                <span style={{ color: licence?.status === 'active' ? 'var(--vs-signal)' : 'var(--vs-accent)' }}>
                  {(licence?.status ?? 'unpublished').toUpperCase()}
                </span>
              </Row>
              <Row label="Content id">
                {version?.ipfsCid ? `${version.ipfsCid.slice(0, 16)}…` : '—'}
              </Row>
            </dl>

            <div className="mt-3 flex flex-wrap gap-2">
              <CopyButton label="CID" value={version?.ipfsCid} />
              <CopyButton label="Transaction hash" value={licence?.txHash ?? null} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: 'var(--vs-line)' }}>
              <Link href={`/assets/${asset.id}`} className="vs-btn vs-btn-primary">
                OPEN FULL RECORD
              </Link>
              {asset.xrModuleUrl ? (
                <a className="vs-btn" href={asset.xrModuleUrl} target="_blank" rel="noreferrer">
                  XR MODULE
                </a>
              ) : null}
              {version?.ipfsCid ? (
                <a className="vs-btn vs-btn-quiet" href={`/ipfs/${version.ipfsCid}`} target="_blank" rel="noreferrer">
                  RAW FILE
                </a>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
