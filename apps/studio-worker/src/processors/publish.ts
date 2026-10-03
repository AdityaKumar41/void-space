/**
 * Publish Processor (VS2-SRS-1.0 §3.5.2, FR-14.x).
 *
 * Executes asynchronous publishing from VOID·STUDIO to VOID·SPACE:
 * 1. Evaluates publish gate using pre-computed audit and export validation.
 * 2. Authenticates with VOID·SPACE using the tenant's Developer API key.
 * 3. Uploads the GLB payload via multipart/form-data to POST /api/v1/assets (or versions).
 * 4. Records the publish lineage in `PublishRecord` and updates the `Job` row.
 */
import {
  evaluatePublishGate,
  type ExportValidationResult,
  type ReadinessReport,
} from '@void-space/studio-engine';
import { withStudioTenant } from '@void-space/studio-db';
import { VoidSpaceClient, MockVoidSpaceClient } from '@void-space/voidspace-client';
import type { Job as BullJob } from 'bullmq';
import type { Logger } from 'pino';

export interface PublishJobPayload {
  tenantId: string;
  projectId: string;
  userId?: string;
  metadata: {
    name: string;
    category: string;
    licenseType?: string;
    tags?: string[];
  };
  file: {
    base64: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  };
  exportValidation: ExportValidationResult;
  audit?: ReadinessReport;
  confirmedBelowThreshold?: boolean;
  republishAssetId?: string;
}

export function createPublishProcessor(logger: Logger) {
  const mode = process.env.VOIDSPACE_CLIENT_MODE ?? 'mock';
  const apiKey = process.env.STUDIO_VOIDSPACE_API_KEY;
  const baseUrl = process.env.STUDIO_VOIDSPACE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

  const client =
    mode === 'live' && apiKey
      ? new VoidSpaceClient({ baseUrl, apiKey })
      : new MockVoidSpaceClient();

  return async function processPublish(job: BullJob<PublishJobPayload>): Promise<{
    assetId: string;
    publishRecordId: string;
    status: string;
  }> {
    const {
      tenantId,
      projectId,
      userId,
      metadata,
      file,
      exportValidation,
      audit,
      confirmedBelowThreshold,
      republishAssetId,
    } = job.data;

    logger.info({ jobId: job.id, projectId, tenantId }, 'processing async publish job');

    // 1. Evaluate the publish gate
    const gate = evaluatePublishGate({
      exportValidation,
      readiness: audit,
      acknowledgment: confirmedBelowThreshold
        ? {
            acknowledgedBy: userId ?? 'creator',
            acknowledgedAt: new Date().toISOString(),
            readinessScore: audit?.score ?? 0,
          }
        : undefined,
    });

    if (!gate.allowed) {
      throw new Error(`Publish gate failed: ${gate.message}`);
    }

    // 2. Decode the file buffer
    const fileBuffer = Buffer.from(file.base64, 'base64');
    const uploadPayload = {
      metadata: {
        name: metadata.name,
        category: metadata.category,
        licenseType: metadata.licenseType ?? 'commercial',
        sourceTool: 'VOID·STUDIO' as const,
        tags: metadata.tags ?? ['void-studio'],
        submitForReview: true,
      },
      file: {
        filename: file.filename,
        contentType: file.mimeType,
        data: fileBuffer,
      },
    };

    // 3. Upload to VOID·SPACE
    const uploadedAsset = republishAssetId
      ? await client.replaceAssetVersion(republishAssetId, uploadPayload)
      : await client.uploadAsset(uploadPayload);

    // 4. Record the lineage in studio-db inside tenant transaction
    const record = await withStudioTenant(tenantId, async (db) => {
      // Supersede any active publish record
      await db.publishRecord.updateMany({
        where: { projectId, supersededAt: null },
        data: { supersededAt: new Date() },
      });

      return db.publishRecord.create({
        data: {
          tenantId,
          projectId,
          createdById: userId ?? '00000000-0000-0000-0000-000000000000',
          voidspaceAssetId: uploadedAsset.id,
          voidspaceAssetVersionId: republishAssetId ?? null,
          status: 'pending',
          readinessScore: audit?.score ?? null,
          readinessReport: (audit ?? null) as any,
          exportValidation: exportValidation as any,
          exportSizeBytes: BigInt(file.sizeBytes),
          exportSha256: file.sha256,
        },
      });
    });

    logger.info(
      { jobId: job.id, assetId: uploadedAsset.id, publishRecordId: record.id },
      'async publish completed successfully',
    );

    return {
      assetId: uploadedAsset.id,
      publishRecordId: record.id,
      status: 'pending',
    };
  };
}
