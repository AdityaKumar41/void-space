/**
 * An in-memory stand-in for VOID·SPACE, selected by `VOIDSPACE_CLIENT_MODE=mock` (VS2-SRS-1.0 §9.1).
 *
 * §9.1 is specific about why this exists: an engineer must be able to develop the editor and its
 * AI/generative pipelines **without a running VOID·SPACE instance**, and the full publish flow of
 * §4.14 must still be exercisable. So this is not a stub that returns canned JSON — it models the
 * lifecycle, including the parts a naive mock gets wrong:
 *
 *   - An upload lands as `pending`, not `published`. Publishing is asynchronous on the real
 *     platform (the licence is minted by a worker — SDD §2.6), and a mock that jumps straight to
 *     `published` trains the Studio's status strip on a future it will never see.
 *   - Review moves are **explicit** via `decide()`. A timer-driven mock would make a test's
 *     outcome depend on wall-clock timing; `autoAdvanceMs` is opt-in precisely so demos can have
 *     it and tests need not.
 *   - A licence exists only once the asset is `published`, matching the real invariant that an
 *     asset cannot be marked published without a token (SDD §2.6).
 */
import type {
  AssetDetail,
  AssetListQuery,
  AssetStatus,
  AssetSummary,
  AssetVersionSummary,
  CreateAssetMetadataInput,
  LicenseSummary,
  Paginated,
  PublicCatalogItem,
  PublicCatalogPage,
} from '@void-space/types';

import type { UploadFile } from './client';
import type {
  BrowseParams,
  ReplaceAssetVersionInput,
  UploadAssetInput,
  VoidSpaceGateway,
  WaitForStatusOptions,
} from './gateway';

export interface MockClientOptions {
  readonly creatorId?: string;
  readonly creatorName?: string;
  /**
   * When set, a simulated review decision is taken automatically this many milliseconds after an
   * upload reaches `pending`. Off by default — see the note on `decide` above.
   */
  readonly autoAdvanceMs?: number;
  readonly clock?: () => Date;
}

const DEFAULT_CREATOR = '00000000-0000-4000-8000-0000000000c1';
const DEFAULT_CREATOR_NAME = 'Mock Creator';

/** Statuses from which a poll should stop waiting — mirrors the real client's own list. */
const TERMINAL_STATUSES: readonly AssetStatus[] = [
  'published',
  'rejected',
  'revision',
  'needs_manual_review',
];

interface MockRecord {
  detail: AssetDetail;
  versions: AssetVersionSummary[];
  uploadedBytes: number;
}

export class MockVoidSpaceClient implements VoidSpaceGateway {
  private readonly records = new Map<string, MockRecord>();
  private readonly options: MockClientOptions;
  private sequence = 0;

  constructor(options: MockClientOptions = {}) {
    this.options = options;
  }

  private now(): string {
    return (this.options.clock?.() ?? new Date()).toISOString();
  }

  private nextId(): string {
    this.sequence += 1;
    const suffix = this.sequence.toString().padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  }

  /** Builds a version row that satisfies `AssetVersionSummary`, including the measured extents. */
  private makeVersion(
    assetId: string,
    versionNumber: number,
    input: { readonly format: string; readonly sizeBytes: number; readonly isCurrent: boolean },
    carried?: Partial<AssetVersionSummary>,
  ): AssetVersionSummary {
    return {
      id: `${assetId}-v${versionNumber}`,
      versionNumber,
      format: input.format,
      sizeBytes: input.sizeBytes,
      polycount: carried?.polycount ?? 12_480,
      ipfsCid: `bafymock${assetId.replace(/-/g, '').slice(0, 12)}${versionNumber}`,
      pinStatus: 'pinned',
      sourceTool: carried?.sourceTool ?? 'VOID·STUDIO',
      sourceLicense: carried?.sourceLicense ?? null,
      sourceAttribution: carried?.sourceAttribution ?? null,
      createdAt: this.now(),
      gatewayUrl: null,
      isCurrent: input.isCurrent,
      stats: { vertices: 6_240, materials: 1, textures: 0, animations: 0 },
      dimensions: { x: 1, y: 1, z: 1 },
    };
  }

  /** Assembles a full `AssetDetail` from a version list. Status is supplied, never inferred. */
  private makeDetail(input: {
    readonly id: string;
    readonly metadata: Partial<CreateAssetMetadataInput>;
    readonly status: AssetStatus;
    readonly versions: readonly AssetVersionSummary[];
    readonly license: LicenseSummary | null;
    readonly createdAt: string;
  }): AssetDetail {
    const versions = [...input.versions];
    const current = versions.find((version) => version.isCurrent) ?? versions.at(-1) ?? null;
    const published = input.status === 'published';

    return {
      id: input.id,
      name: input.metadata.name ?? 'Untitled',
      description: input.metadata.description ?? null,
      category: input.metadata.category ?? 'Other',
      tags: input.metadata.tags ?? [],
      status: input.status,
      createdAt: input.createdAt,
      updatedAt: this.now(),
      creator: {
        id: this.options.creatorId ?? DEFAULT_CREATOR,
        fullName: this.options.creatorName ?? DEFAULT_CREATOR_NAME,
        email: 'creator@example.test',
      },
      currentVersion: current,
      license: input.license,
      xrModuleUrl: null,
      xrManifestRef: null,
      thumbnailUrl: null,
      // Mirrors the real capability flags: deletion is refused once a licence exists
      // (VS-SRS-2.0 FR-3.6), and only a non-published asset can be published.
      canDelete: !published,
      canPublish: !published,
      canRevoke: published,
      versions,
      aiSuggestion: null,
      decisions: [],
      comments: [],
      jobs: [],
      auditTrail: [
        { id: `${input.id}-a1`, action: 'asset.uploaded', actorId: null, createdAt: input.createdAt, txHash: null },
      ],
    };
  }


  // ------------------------------------------------------------------ gateway impl

  /** Always succeeds: the mock has a credential by construction. */
  async verifyCredentials(): Promise<void> {
    // Intentionally empty. There is no credential to check, but the method exists so that code
    // written against the live client (which calls it before a long export) also works here.
  }

  async uploadAsset(input: UploadAssetInput): Promise<AssetDetail> {
    const folder = input.file.filename.split('/').pop() ?? 'scene.glb';
    const format = folder.includes('.') ? `.${folder.split('.').pop() ?? 'glb'}` : '.glb';
    const id = this.nextId();
    const createdAt = this.now();

    const version = this.makeVersion(id, 1, {
      format,
      sizeBytes: byteLength(input.file),
      isCurrent: true,
    });

    const detail = this.makeDetail({
      id,
      metadata: input.metadata,
      status: 'pending',
      versions: [version],
      license: null,
      createdAt,
    });

    this.records.set(id, { detail, versions: [version], uploadedBytes: version.sizeBytes });
    return detail;
  }

  async replaceAssetVersion(assetId: string, input: ReplaceAssetVersionInput): Promise<AssetDetail> {
    const record = this.require(assetId);
    const nextNumber = record.versions.length + 1;

    // Earlier versions stay immutable and stop being current (FR-14.4). Flipping `isCurrent` on the
    // old rows rather than deleting them is what makes version history in VOID·SPACE meaningful,
    // and it is the behaviour a re-publish depends on.
    const retired = record.versions.map((version) => ({ ...version, isCurrent: false }));
    const incoming = this.makeVersion(
      assetId,
      nextNumber,
      { format: retired[0]?.format ?? '.glb', sizeBytes: byteLength(input.file), isCurrent: true },
      { polycount: retired[0]?.polycount ?? null },
    );
    const versions = [...retired, incoming];

    const detail = this.makeDetail({
      id: assetId,
      // Rebuilt field by field rather than spread: `AssetDetail.tags` is `readonly string[]`
      // while the input expects a mutable `string[]`, and a spread would carry the readonly
      // type straight into the wrong slot.
      metadata: {
        name: record.detail.name,
        category: record.detail.category,
        tags: [...record.detail.tags],
        ...(input.metadata ?? {}),
      },
      status: 'pending',
      versions,
      license: null,
      createdAt: record.detail.createdAt,
    });

    this.records.set(assetId, { detail, versions, uploadedBytes: record.uploadedBytes });
    return detail;
  }

  async getAsset(assetId: string): Promise<AssetDetail> {
    return this.require(assetId).detail;
  }

  async submitAsset(assetId: string): Promise<AssetDetail> {
    return this.applyStatus(assetId, 'pending');
  }

  async listAssets(query: Partial<AssetListQuery> = {}): Promise<Paginated<AssetSummary>> {
    const all = [...this.records.values()].map((record) => toSummary(record.detail));
    const status = coerceStatus((query as { readonly status?: unknown }).status);
    const filtered = status ? all.filter((asset) => asset.status === status) : all;

    const pageSize = (query.pageSize as number | undefined) ?? 20;
    const page = (query.page as number | undefined) ?? 1;
    const start = (page - 1) * pageSize;

    return {
      items: filtered.slice(start, start + pageSize),
      page,
      pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    };
  }

  async browsePublicCatalog(params: BrowseParams = {}): Promise<PublicCatalogPage> {
    // Only `published` assets are visible to a stranger, exactly as the real projection enforces.
    const items = [...this.records.values()]
      .filter((record) => record.detail.status === 'published')
      .map((record) => toCatalogItem(record.detail));

    const limit = params.limit ?? 24;
    const offset = params.offset ?? 0;
    return { total: items.length, limit, offset, items: items.slice(offset, offset + limit) };
  }

  async waitForAssetStatus(
    assetId: string,
    options: WaitForStatusOptions = {},
  ): Promise<AssetDetail> {
    const settled = options.until ?? ((asset: AssetDetail) => TERMINAL_STATUSES.includes(asset.status));
    const timeoutMs = options.timeoutMs ?? 5 * 60_000;
    const intervalMs = options.intervalMs ?? 10;
    const deadline = Date.now() + timeoutMs;

    let latest = await this.getAsset(assetId);
    while (!settled(latest) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      latest = await this.getAsset(assetId);
      options.onPoll?.(latest);
    }
    return latest;
  }


  // ------------------------------------------------------- simulation-only controls

  /**
   * Records an Assessor decision, the way VOID·SPACE's review queue would (VS-SRS-2.0 FR-4.3–4.5).
   *
   * Call this from a test or a demo to drive FR-14.3 and FR-14.5 without a real reviewer. A comment
   * is required for `revision` and `rejected`, matching the rule the real API enforces, so a demo
   * cannot show a rejection with no reason and teach the UI to render an empty explanation.
   */
  decide(assetId: string, decision: 'approved' | 'rejected' | 'revision', comment: string | null = null): AssetDetail {
    if ((decision === 'rejected' || decision === 'revision') && !comment) {
      throw new Error(`A ${decision} decision requires a comment (VS-SRS-2.0 FR-4.4)`);
    }

    const current = this.require(assetId);
    const base = this.applyStatus(assetId, decision);
    const decisionRow = {
      id: `${assetId}-d${base.decisions.length + 1}`,
      decision,
      comment,
      createdAt: this.now(),
      assessor: { id: '00000000-0000-4000-8000-0000000000e1', fullName: 'Mock Assessor' },
      assetVersionId: base.currentVersion?.id ?? `${assetId}-v1`,
    };

    const detail: AssetDetail = { ...base, decisions: [...base.decisions, decisionRow] };
    this.records.set(assetId, { ...current, detail });
    return detail;
  }

  /**
   * Completes the lifecycle, mirroring the real two-step rule that a licence is minted by a worker
   * *after* approval — so an asset is never `published` without one (SDD §2.6).
   */
  publish(assetId: string): AssetDetail {
    const current = this.require(assetId);
    const base = this.applyStatus(assetId, 'published');
    const detail: AssetDetail = { ...base, license: makeLicense(assetId) };
    this.records.set(assetId, { ...current, detail });
    return detail;
  }

  /** The number of assets the mock knows about — handy for assertions. */
  get size(): number {
    return this.records.size;
  }

  private require(assetId: string): MockRecord {
    const record = this.records.get(assetId);
    if (!record) throw new Error(`MockVoidSpaceClient: no asset ${assetId}`);
    return record;
  }

  /**
   * Rewrites an asset's status in place, preserving its name, category, tags, versions and creation
   * time. Capability flags are recomputed by `makeDetail` from the new status, which is what keeps
   * `canDelete` and `canPublish` honest as the asset moves through the lifecycle.
   */
  private applyStatus(assetId: string, status: AssetStatus): AssetDetail {
    const record = this.require(assetId);
    const detail = this.makeDetail({
      id: assetId,
      metadata: {
        name: record.detail.name,
        category: record.detail.category,
        tags: [...record.detail.tags],
      },
      status,
      versions: record.versions,
      license: status === 'published' ? (record.detail.license ?? makeLicense(assetId)) : null,
      createdAt: record.detail.createdAt,
    });

    // `makeDetail` starts a fresh audit trail; carry the real one forward and append the transition,
    // because FR-13.1's trail is the point of the audit surface.
    const withTrail: AssetDetail = {
      ...detail,
      decisions: record.detail.decisions,
      auditTrail: [
        ...record.detail.auditTrail,
        {
          id: `${assetId}-a${record.detail.auditTrail.length + 1}`,
          action: `asset.${status}`,
          actorId: null,
          createdAt: this.now(),
          txHash: null,
        },
      ],
    };

    this.records.set(assetId, { ...record, detail: withTrail });
    return withTrail;
  }
}

/** A licence only exists on a published asset; the token id is derived so assertions can pin it. */
function makeLicense(assetId: string): LicenseSummary {
  return {
    id: `${assetId}-license`,
    tokenId: '1',
    contractAddress: '0x0000000000000000000000000000000000000000',
    txHash: null,
    blockNumber: null,
    gasUsed: null,
    ipfsMetadataCid: `bafymocklicence${assetId.replace(/-/g, '').slice(0, 10)}`,
    licenseTermsHash: `0x${'ab'.repeat(32)}`,
    status: 'active',
    revokedReason: null,
    revokedAt: null,
    mintedAt: new Date(0).toISOString(),
    tokenUri: null,
  };
}


/**
 * The uploaded size, measured without reading the payload.
 *
 * A `Blob` reports its own `size`; anything already in memory reports its length. This is only ever
 * called so the mock can quote a plausible `sizeBytes`, so it deliberately never buffers a Blob to
 * find out — a mock that reads 200 MB to report a number is a mock that makes tests slow.
 */
function byteLength(file: UploadFile): number {
  const data = file.data;
  if (data instanceof Uint8Array) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.size;
}

/** Narrows whatever the caller put in `status` to a real `AssetStatus`, ignoring anything else. */
function coerceStatus(value: unknown): AssetStatus | undefined {
  if (typeof value !== 'string') return undefined;
  return ASSET_STATUS_LOOKUP.has(value) ? (value as AssetStatus) : undefined;
}

const ASSET_STATUS_LOOKUP: ReadonlySet<string> = new Set<string>([
  'draft',
  'pending',
  'needs_manual_review',
  'approved',
  'rejected',
  'revision',
  'published',
]);

/** Projects a full detail onto the summary shape the library list returns (VS-SRS-2.0 FR-3.5). */
function toSummary(detail: AssetDetail): AssetSummary {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    category: detail.category,
    tags: detail.tags,
    status: detail.status,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    creator: detail.creator,
    currentVersion: detail.currentVersion,
    license: detail.license,
    xrModuleUrl: detail.xrModuleUrl,
    xrManifestRef: detail.xrManifestRef,
    thumbnailUrl: detail.thumbnailUrl,
    canDelete: detail.canDelete,
    canPublish: detail.canPublish,
    canRevoke: detail.canRevoke,
  };
}

/**
 * Projects a published asset onto the anonymous catalogue payload.
 *
 * The field list is an allow-list, mirroring the real `public_catalog_entries` projection: the mock
 * deliberately drops `creator` and the audit trail, so code developed against the mock cannot
 * accidentally depend on a field the real anonymous endpoint will never return.
 */
function toCatalogItem(detail: AssetDetail): PublicCatalogItem {
  const version = detail.currentVersion ?? null;
  return {
    assetId: detail.id,
    name: detail.name,
    description: detail.description,
    category: detail.category,
    tags: detail.tags,
    tenantName: 'Mock Workspace',
    format: version?.format ?? '.glb',
    // Bytes travel as a string on the wire — `BigInt` does not survive JSON (see the type's note).
    sizeBytes: String(version?.sizeBytes ?? 0),
    polycount: version?.polycount ?? null,
    vertices: version?.stats.vertices ?? null,
    materials: version?.stats.materials ?? null,
    textures: version?.stats.textures ?? null,
    animations: version?.stats.animations ?? null,
    ipfsCid: version?.ipfsCid ?? '',
    licenseType: 'Commercial',
    licenseTerms: null,
    tokenId: detail.license?.tokenId ?? null,
    contractAddress: detail.license?.contractAddress ?? null,
    txHash: detail.license?.txHash ?? null,
    licenseMetadataCid: detail.license?.ipfsMetadataCid ?? null,
    xrManifestRef: detail.xrManifestRef,
    sourceLicense: version?.sourceLicense ?? null,
    sourceAttribution: version?.sourceAttribution ?? null,
    sourceUrl: null,
    publishedAt: detail.updatedAt,
  };
}

