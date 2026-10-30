'use client';

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

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-1 font-mono text-lg tabular-nums tracking-tight text-ink">{value}</dd>
      {note ? <dd className="mt-1 text-xs leading-relaxed text-ink-dim">{note}</dd> : null}
    </div>
  );
}

export function AssetIntegrityPanel({
  asset,
  version,
  liveGeometry,
  liveSummary,
}: AssetIntegrityPanelProps) {
  const triangles = liveGeometry?.triangles ?? version?.polycount ?? null;
  const vertices = liveGeometry?.vertices ?? version?.stats?.vertices ?? null;
  const meshes = liveGeometry?.meshes ?? null;
  const extent = liveGeometry?.extent ?? version?.dimensions ?? null;
  const materials = liveSummary?.materials.length ?? version?.stats?.materials ?? null;
  const textures = liveSummary?.textures ?? version?.stats?.textures ?? null;
  const animations = version?.stats?.animations ?? 0;
  const agreement = comparePolycount(version?.polycount ?? null, triangles ?? 0);
  const filename = `${asset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${
    version?.format ? (version.format.startsWith('.') ? version.format : `.${version.format}`) : '.glb'
  }`;

  return (
    <aside className="overflow-hidden rounded-card border border-hairline bg-surface">
      <header className="border-b border-hairline px-5 py-4">
        <h2 className="text-base font-semibold text-ink">Model record</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-dim">
          {agreement.reason}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 py-5">
        <Fact
          label="Triangles"
          value={triangles !== null ? formatCount(triangles) : '—'}
          note={meshes !== null ? `${formatNumber(meshes)} mesh${meshes === 1 ? '' : 'es'}` : undefined}
        />
        <Fact label="Vertices" value={vertices !== null ? formatCount(vertices) : '—'} />
        <Fact
          label="File"
          value={formatBytes(version?.sizeBytes ?? 0)}
          note={
            version
              ? `Version ${version.versionNumber} · ${version.format.replace(/^\./, '').toUpperCase()}`
              : undefined
          }
        />
        <Fact
          label="Storage"
          value={version?.pinStatus === 'pinned' ? 'Pinned' : (version?.pinStatus ?? '—')}
          note={version?.pinStatus === 'pinned' ? 'Available from the content address' : undefined}
        />
        <Fact label="Materials" value={materials !== null ? formatNumber(materials) : '—'} />
        <Fact
          label="Textures"
          value={textures !== null ? formatNumber(textures) : '—'}
          note={animations > 0 ? `${animations} animation clip${animations === 1 ? '' : 's'}` : 'No animation clips'}
        />
      </dl>

      <div className="border-t border-hairline px-5 py-4">
        <p className="text-xs text-ink-faint">Extent</p>
        <p className="mt-1 font-mono text-sm tabular-nums text-ink">
          {extent
            ? `${extent.x.toFixed(3)} × ${extent.y.toFixed(3)} × ${extent.z.toFixed(3)}`
            : 'Measured when the file is opened'}
        </p>
        <p className="mt-1 text-xs text-ink-dim">Width, height, and depth in the model’s own units.</p>
      </div>

      <dl className="space-y-3 border-t border-hairline px-5 py-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <dt className="text-xs text-ink-faint">Content address</dt>
            <dd className="mt-1 truncate font-mono text-xs text-ink" title={version?.ipfsCid ?? ''}>
              {version?.ipfsCid ?? 'Not pinned yet'}
            </dd>
          </div>
          <CopyButton label="address" value={version?.ipfsCid ?? null} />
        </div>
        {version?.gatewayUrl ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs text-ink-faint">File link</dt>
            <dd>
              <a
                href={version.gatewayUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand underline"
              >
                Open
              </a>
            </dd>
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <dt className="text-xs text-ink-faint">Licence</dt>
            <dd className="mt-1 text-sm text-ink">
              {asset.license ? `Token ${asset.license.tokenId} · ${asset.license.status}` : 'No licence minted'}
            </dd>
            {asset.license?.txHash ? (
              <dd className="mt-1 truncate font-mono text-xs text-ink-dim" title={asset.license.txHash}>
                {shortId(asset.license.txHash, 14)}
              </dd>
            ) : null}
          </div>
          {asset.license ? <CopyButton label="token" value={asset.license.tokenId} /> : null}
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-4">
        <VoidStudioLaunchButton
          assetId={asset.id}
          name={asset.name}
          format={version?.format}
          filename={filename}
          modelUrl={version?.gatewayUrl ?? undefined}
          variant="primary"
          size="sm"
        >
          Edit in Void Studio
        </VoidStudioLaunchButton>
        {version?.gatewayUrl ? (
          <a
            href={version.gatewayUrl}
            download={filename}
            className="inline-flex h-8 items-center rounded-control border border-hairline bg-surface px-3 text-[12px] font-medium text-ink hover:bg-veil-8"
          >
            Download
          </a>
        ) : null}
      </div>
    </aside>
  );
}
