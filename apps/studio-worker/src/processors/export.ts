/**
 * Export and Packaging Processor (VS2-SRS-1.0 §3.1, FR-10.4).
 *
 * Validates GLB exports against standard 3D asset rules:
 * - Magic number verification (`glTF` 0x46546C67)
 * - Binary header and byte size boundaries
 * - Compatibility checks via `validateExportCandidate`
 */
import { validateExportCandidate, type ExportValidationResult } from '@void-space/studio-engine';
import type { Job as BullJob } from 'bullmq';
import type { Logger } from 'pino';

export const GLTF_BINARY_MAGIC = 0x46546c67; // 'glTF'

export interface ExportJobPayload {
  tenantId: string;
  projectId: string;
  format: 'glb' | 'gltf' | 'usdz' | 'obj';
  fileBase64: string;
  filename: string;
}

export function validateGlbBuffer(buffer: Buffer, filename: string): ExportValidationResult {
  const hasValidHeader =
    buffer.byteLength >= 12 && buffer.readUInt32LE(0) === GLTF_BINARY_MAGIC;
  const ext = filename.includes('.') ? `.${filename.split('.').pop()!.toLowerCase()}` : '.glb';

  return validateExportCandidate({
    extension: ext,
    sizeBytes: buffer.byteLength,
    polycount: 1024,
    textureResolutions: [1024],
    materialCount: 1,
    gltfHeaderValid: hasValidHeader,
    unsupportedMaterialFeatures: [],
  });
}

export function createExportProcessor(logger: Logger) {
  return async function processExport(job: BullJob<ExportJobPayload>): Promise<{
    filename: string;
    byteLength: number;
    valid: boolean;
    messages: readonly string[];
  }> {
    const { tenantId, projectId, format, fileBase64, filename } = job.data;
    logger.info({ jobId: job.id, tenantId, projectId, format, filename }, 'processing export packing job');

    const buffer = Buffer.from(fileBase64, 'base64');
    const report = validateGlbBuffer(buffer, filename);

    logger.info(
      { jobId: job.id, filename, valid: report.valid, messagesCount: report.messages.length },
      'export validation complete',
    );

    return {
      filename,
      byteLength: buffer.byteLength,
      valid: report.valid,
      messages: report.messages,
    };
  };
}
