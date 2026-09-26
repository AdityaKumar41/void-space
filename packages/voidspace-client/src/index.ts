/**
 * @void-space/voidspace-client — the typed SDK for VOID·SPACE's `/api/v1` (VS2-SRS-1.0 §3.7).
 *
 * This package is the *only* place VOID·STUDIO is allowed to know VOID·SPACE's HTTP surface.
 * It reuses `@void-space/types` for every payload so the two products cannot drift apart
 * (NFR-MAINT.3), and it depends on neither Next.js nor Fastify so the API, the workers and the
 * editor can all share it (§3.7).
 */
export { VoidSpaceClient, type UploadFile, type VoidSpaceClientOptions } from './client';
export { VoidSpaceError } from './errors';
export {
  parseClientMode,
  type BrowseParams,
  type ReplaceAssetVersionInput,
  type UploadAssetInput,
  type VoidSpaceClientMode,
  type VoidSpaceGateway,
  type WaitForStatusOptions,
} from './gateway';
export { MockVoidSpaceClient, type MockClientOptions } from './mock';
export { buildMultipartBody, type MultipartBody, type MultipartFilePart } from './multipart';
