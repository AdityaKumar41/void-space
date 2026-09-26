/**
 * The seam between VOID·STUDIO and VOID·SPACE.
 *
 * Everything that crosses the product boundary is declared here, and nothing else may. Two
 * implementations satisfy it:
 *
 *   - `VoidSpaceClient` — the real HTTP client, talking to a deployed VOID·SPACE.
 *   - `MockVoidSpaceClient` — an in-memory simulation of the publish/review lifecycle.
 *
 * The mock exists because §9.1 requires the full §4.14 publish flow to be exercisable without a
 * running VOID·SPACE instance (`VOIDSPACE_CLIENT_MODE=mock`). That is only possible if the seam is
 * an interface rather than a concrete class, which is why this file exists instead of callers
 * depending on `VoidSpaceClient` directly.
 */
import type {
  AssetDetail,
  AssetListQuery,
  AssetSummary,
  CreateAssetMetadataInput,
  Paginated,
  PublicCatalogPage,
  PublicCatalogSort,
} from '@void-space/types';

import type { UploadFile } from './client';

export interface UploadAssetInput {
  readonly metadata: CreateAssetMetadataInput;
  readonly file: UploadFile;
}

export interface ReplaceAssetVersionInput {
  readonly metadata?: Partial<CreateAssetMetadataInput>;
  readonly file: UploadFile;
}

export interface WaitForStatusOptions {
  readonly until?: (asset: AssetDetail) => boolean;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly onPoll?: (asset: AssetDetail) => void;
}

export interface BrowseParams {
  readonly search?: string;
  readonly category?: string;
  readonly tag?: string;
  readonly licenseType?: string;
  readonly sort?: PublicCatalogSort;
  readonly limit?: number;
  readonly offset?: number;
}

export interface VoidSpaceGateway {
  /** Proves the credential works before a long job is started on the strength of it. */
  verifyCredentials(): Promise<void>;
  uploadAsset(input: UploadAssetInput): Promise<AssetDetail>;
  replaceAssetVersion(assetId: string, input: ReplaceAssetVersionInput): Promise<AssetDetail>;
  getAsset(assetId: string): Promise<AssetDetail>;
  submitAsset(assetId: string): Promise<AssetDetail>;
  listAssets(query?: Partial<AssetListQuery>): Promise<Paginated<AssetSummary>>;
  browsePublicCatalog(params?: BrowseParams): Promise<PublicCatalogPage>;
  waitForAssetStatus(assetId: string, options?: WaitForStatusOptions): Promise<AssetDetail>;
}

/** Which implementation the Studio API and workers should build (§9.1). */
export type VoidSpaceClientMode = 'mock' | 'live';

export function parseClientMode(value: string | undefined, fallback: VoidSpaceClientMode): VoidSpaceClientMode {
  if (value === 'mock' || value === 'live') return value;
  return fallback;
}
