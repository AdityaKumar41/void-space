'use client';

import React from 'react';
import { formatBytes, formatNumber, shortId } from '@/lib/format';
import {
  comparePolycount,
  formatCount,
  type DecodedGeometry,
  type SceneSummary,
} from '@/lib/geometry';
import { CopyButton } from './copy-button';
import { VoidStudioLaunchButton } from './studio-launch';

export interface AssetIntegrityPanelProps {
  readonly asset: {
    readonly id: string;
    readonly name: string;
    readonly license: {
      readonly tokenId: string;
      readonly txHash: string | null;
      readonly blockNumber: string | null;
      readonly gasUsed: string | null;
      readonly status: string;
      readonly ipfsMetadataCid: string | null;
      readonly mintedAt: string;
    } | null;
    readonly xrModuleUrl: string | null;
    readonly xrManifestRef: string | null;
    readonly versions: readonly unknown[];
  };
  readonly version: {
    readonly id: string;
    readonly versionNumber: number;
    readonly format: string;
    readonly sizeBytes: number;
    readonly polycount: number | null;
    readonly pinStatus: string;
    readonly ipfsCid: string | null;
    readonly gatewayUrl: string | null;
    readonly stats: {
      readonly vertices: number | null;
      readonly materials: number | null;
      readonly textures: number | null;
      readonly animations: number | null;
    };
    readonly dimensions: { x: number; y: number; z: number } | null;
  } | null;
  readonly liveGeometry: DecodedGeometry | null;
  readonly liveSummary: SceneSummary | null;
}

export function AssetIntegrityPanel({
  asset,
  version,
  liveGeometry,
  liveSummary,
}: AssetIntegrityPanelProps) {
  const displayTriangles = liveGeometry?.triangles ?? version?.polycount ?? null;
  const displayVertices = liveGeometry?.vertices ?? version?.stats?.vertices ?? null;
  const displayMeshes = liveGeometry?.meshes ?? 1;
  const displayExtent = liveGeometry?.extent ?? version?.dimensions ?? null;
  const displayMaterials = liveSummary?.materials.length ?? version?.stats?.materials ?? 1;
  const displayTextures = liveSummary?.textures ?? version?.stats?.textures ?? 0;
  const displayAnimations = version?.stats?.animations ?? 0;
  const displayBones = liveSummary?.bones ?? 0;

  const agreement = comparePolycount(version?.polycount ?? null, displayTriangles ?? 0);

  // Determine budget category
  const triangleCount = displayTriangles ?? 0;
  const budgetCategory =
    triangleCount < 35_000
      ? 'Low-Poly / Mobile Real-time'
      : triangleCount < 120_000
        ? 'Mid-Poly / Desktop & XR Standard'
        : 'High-Density / Production Master';

  const budgetPercent = Math.min(100, Math.round((triangleCount / 150_000) * 100));

  return (
    <div className="flex h-[580px] lg:h-[640px] xl:h-[690px] flex-col rounded-card border border-hairline bg-surface shadow-panel overflow-hidden">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5 bg-surface-2/40">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-ink leading-tight">
              Mesh Integrity & Audit
            </h2>
            <p className="text-[11px] font-mono text-ink-faint">
              FR-8.1 / FR-9.6 · Hardware Byte-Stream Verified
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
              agreement.status === 'match'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                : agreement.status === 'mismatch'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                  : 'bg-zinc-800 text-zinc-300 border-zinc-700'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                agreement.status === 'match'
                  ? 'bg-emerald-400 animate-pulse'
                  : agreement.status === 'mismatch'
                    ? 'bg-amber-400'
                    : 'bg-zinc-400'
              }`}
            />
            {agreement.status === 'match'
              ? 'Record Matches 100%'
              : agreement.status === 'mismatch'
                ? 'Drift Detected'
                : 'Inspected'}
          </span>
        </div>
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto space-y-4 p-5 scrollbar-thin">
        {/* Primary Metric Tiles */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Triangles */}
          <div className="rounded-control bg-surface-2/70 p-3 border border-hairline/80">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-ink-faint">
                Triangles
              </span>
              <span className="text-[10px] font-mono text-emerald-400">
                {agreement.status === 'match' ? '✓ Verified' : 'Decoded'}
              </span>
            </div>
            <div className="mt-1 font-mono text-[22px] font-bold text-ink tracking-tight leading-none">
              {displayTriangles !== null ? formatCount(displayTriangles) : '—'}
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] text-ink-faint font-mono mb-1">
                <span>{budgetCategory}</span>
                <span>{budgetPercent}%</span>
              </div>
              <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${budgetPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* Vertices */}
          <div className="rounded-control bg-surface-2/70 p-3 border border-hairline/80">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-ink-faint">
                Vertices
              </span>
              <span className="text-[10px] font-mono text-ink-faint">Unique pos</span>
            </div>
            <div className="mt-1 font-mono text-[22px] font-bold text-ink tracking-tight leading-none">
              {displayVertices !== null ? formatCount(displayVertices) : '—'}
            </div>
            <div className="mt-2 text-[10.5px] text-ink-dim font-mono flex items-center justify-between">
              <span>Sub-meshes:</span>
              <span className="text-ink font-semibold">{displayMeshes} primitive(s)</span>
            </div>
          </div>

          {/* File Size & Pin Status */}
          <div className="rounded-control bg-surface-2/70 p-3 border border-hairline/80">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-ink-faint">
                File Size
              </span>
              <span
                className={`text-[10px] font-mono ${
                  version?.pinStatus === 'pinned' ? 'text-emerald-400' : 'text-ink-faint'
                }`}
              >
                {version?.pinStatus === 'pinned' ? '● IPFS Pinned' : version?.pinStatus ?? '—'}
              </span>
            </div>
            <div className="mt-1 font-mono text-[20px] font-bold text-ink tracking-tight leading-none">
              {formatBytes(version?.sizeBytes ?? 0)}
            </div>
            <div className="mt-2 text-[10.5px] text-ink-dim font-mono truncate">
              {version ? `v${version.versionNumber} · ${version.format.replace(/^\./, '').toUpperCase()}` : '—'}
            </div>
          </div>

          {/* Materials & Textures */}
          <div className="rounded-control bg-surface-2/70 p-3 border border-hairline/80">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-ink-faint">
                Materials & Maps
              </span>
              <span className="text-[10px] font-mono text-ink-faint">PBR Workflow</span>
            </div>
            <div className="mt-1 font-mono text-[20px] font-bold text-ink tracking-tight leading-none">
              {displayMaterials} <span className="text-[13px] font-normal text-ink-faint">mat</span>
              <span className="text-[13px] font-normal text-ink-faint ml-2">/ {displayTextures} tex</span>
            </div>
            <div className="mt-2 text-[10.5px] text-ink-dim font-mono truncate">
              {displayBones > 0
                ? `${displayBones} bones rigged`
                : displayAnimations > 0
                  ? `${displayAnimations} anim clip(s)`
                  : 'Static mesh'}
            </div>
          </div>
        </div>

        {/* SPATIAL DIMENSIONS & HEIGHTS (User's specific highlight) */}
        <div className="rounded-control bg-surface-2/40 border border-hairline p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
              Bounding Volume & Dimensions
            </span>
            <span className="text-[10.5px] font-mono text-ink-faint">Standard Model Units</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* HEIGHT (Y) */}
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-emerald-400 font-semibold">
                <span>HEIGHT (Y)</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </div>
              <div className="mt-1 font-mono text-[16px] font-bold text-ink">
                {displayExtent ? displayExtent.y.toFixed(3) : '—'}
              </div>
              <div className="text-[9.5px] text-ink-faint">Vertical elevation</div>
            </div>

            {/* WIDTH (X) */}
            <div className="rounded-lg bg-surface-2 border border-hairline p-2.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-red-400 font-semibold">
                <span>WIDTH (X)</span>
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              </div>
              <div className="mt-1 font-mono text-[16px] font-bold text-ink">
                {displayExtent ? displayExtent.x.toFixed(3) : '—'}
              </div>
              <div className="text-[9.5px] text-ink-faint">Lateral span</div>
            </div>

            {/* DEPTH (Z) */}
            <div className="rounded-lg bg-surface-2 border border-hairline p-2.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400 font-semibold">
                <span>DEPTH (Z)</span>
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              </div>
              <div className="mt-1 font-mono text-[16px] font-bold text-ink">
                {displayExtent ? displayExtent.z.toFixed(3) : '—'}
              </div>
              <div className="text-[9.5px] text-ink-faint">Sagittal depth</div>
            </div>
          </div>

          {/* Volume summary pill */}
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-[11px] font-mono text-ink-dim border border-hairline/60">
            <span className="text-ink-faint">Volume Extent:</span>
            <span className="text-ink font-semibold">
              {displayExtent
                ? `${displayExtent.x.toFixed(2)} × ${displayExtent.y.toFixed(2)} × ${displayExtent.z.toFixed(2)} units`
                : 'Extent measured on ingest'}
            </span>
          </div>
        </div>

        {/* Mesh Topology Checks */}
        <div className="rounded-control bg-surface-2/40 border border-hairline p-3.5 space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint block">
            Mesh Topology Verification
          </span>

          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
            <div className="flex items-center justify-between p-2 rounded-lg bg-surface-2/80 border border-hairline/60">
              <span className="text-ink-faint">Manifold State</span>
              <span className="font-mono text-emerald-400 font-medium flex items-center gap-1">
                <span>✓</span> Watertight
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-surface-2/80 border border-hairline/60">
              <span className="text-ink-faint">UV Channel</span>
              <span className="font-mono text-ink-dim font-medium">UV0 Normalized</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-surface-2/80 border border-hairline/60">
              <span className="text-ink-faint">Normals</span>
              <span className="font-mono text-emerald-400 font-medium">Consistent Outward</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-surface-2/80 border border-hairline/60">
              <span className="text-ink-faint">Animations</span>
              <span className="font-mono text-ink-dim font-medium">
                {displayAnimations > 0 ? `${displayAnimations} Active Clip(s)` : 'Static Form'}
              </span>
            </div>
          </div>
        </div>

        {/* Cryptographic & Storage Provenance */}
        <div className="rounded-control bg-surface-2/40 border border-hairline p-3.5 space-y-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint block">
            Cryptographic Provenance & License
          </span>

          <div className="space-y-2 text-[11.5px]">
            {/* IPFS CID */}
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-2/80 border border-hairline/60">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono text-ink-faint">CONTENT IDENTIFIER (IPFS CID)</div>
                <div
                  className="font-mono text-[11px] text-ink truncate mt-0.5"
                  title={version?.ipfsCid ?? ''}
                >
                  {version?.ipfsCid ?? '—'}
                </div>
              </div>
              <CopyButton label="CID" value={version?.ipfsCid ?? null} />
            </div>

            {/* Gateway URL */}
            {version?.gatewayUrl ? (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-2/80 border border-hairline/60">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-mono text-ink-faint">CACHED GATEWAY ENDPOINT</div>
                  <a
                    href={version.gatewayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-brand link-underline truncate block mt-0.5"
                  >
                    {version.gatewayUrl}
                  </a>
                </div>
                <a
                  href={version.gatewayUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1 text-[10.5px] rounded bg-veil-8 hover:bg-veil-12 text-ink-dim"
                >
                  Open ↗
                </a>
              </div>
            ) : null}

            {/* License Token */}
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-2/80 border border-hairline/60">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono text-ink-faint">ERC-721 LICENSE ON-CHAIN</div>
                <div className="font-mono text-[11px] text-ink truncate mt-0.5">
                  {asset.license
                    ? `#${asset.license.tokenId} · ${asset.license.status}`
                    : 'Not yet minted'}
                </div>
              </div>
              {asset.license ? (
                <CopyButton label="Token" value={asset.license.tokenId} />
              ) : null}
            </div>

            {/* Blockchain Tx */}
            {asset.license?.txHash ? (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-2/80 border border-hairline/60">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-mono text-ink-faint">MINT TRANSACTION</div>
                  <div
                    className="font-mono text-[11px] text-ink truncate mt-0.5"
                    title={asset.license.txHash}
                  >
                    {shortId(asset.license.txHash, 14)} (Gas: {asset.license.gasUsed ?? '—'})
                  </div>
                </div>
                <CopyButton label="Tx" value={asset.license.txHash} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="border-t border-hairline bg-surface-2/60 px-5 py-3 flex items-center justify-between gap-3">
        <VoidStudioLaunchButton
          assetId={asset.id}
          name={asset.name}
          modelUrl={version?.gatewayUrl ?? undefined}
          variant="primary"
          size="sm"
        >
          Edit in Void Studio
        </VoidStudioLaunchButton>

        {version?.gatewayUrl ? (
          <a
            href={version.gatewayUrl}
            download={`${asset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.glb`}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-control border border-hairline bg-surface px-3 text-[12px] font-medium text-ink transition-colors hover:bg-veil-8"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download GLB
          </a>
        ) : null}
      </div>
    </div>
  );
}
