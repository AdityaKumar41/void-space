/**
 * The project index and the publish handoff (FR-2.x, FR-14.x).
 *
 * This is where the two products actually meet. Everything else in the Studio is local
 * work; `POST /projects/:id/publish` is the single, deliberate crossing of §3.5.2 — and
 * the only place a Creator's work leaves their machine of its own accord.
 *
 * The ordering below is load-bearing and follows §3.5.2's sequence exactly:
 *
 *   1. validate the export (FR-10.4)        — a hard gate
 *   2. evaluate the publish gate (FR-14.1)  — hard on the export, advisory on the audit
 *   3. require the tenant credential
 *   4. upload to VOID·SPACE (§3.5.2)
 *   5. record the PublishRecord (FR-14.3)
 *
 * The credential is checked *before* the upload rather than at construction, so a
 * Studio with no key can still browse the catalogue and open projects — it just cannot
 * publish, and says so in a sentence that names the fix.
 */
import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  evaluatePublishGate,
  validateExportCandidate,
  type ExportCandidate,
  type PublishAcknowledgment,
  type ReadinessReport,
} from '@void-space/studio-engine';
import { withStudioTenant } from '@void-space/studio-db';

import type { VoidSpaceBridge } from '../lib/gateway';
import { viaUpstream } from '../lib/gateway';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { parseBody, parseParams, parseQuery } from '../lib/http';
import { requirePermission, resolveSession, type StudioSession } from '../lib/session';

const projectParamsSchema = z.object({ projectId: z.string().uuid() });

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  tags: z.array(z.string().min(1).max(40)).max(25).default([]),
  /**
   * Local-first by default (§2.1). A caller has to *ask* for cloud storage, which is the
   * whole point: the default must not be the choice someone else made for them.
   */
  storageMode: z.enum(['local', 'cloud']).default('local'),
});

const listProjectsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

/** The FR-10.3 measurements the exporter reports. Server-validated, never assumed. */
const exportCandidateSchema = z.object({
  extension: z.string().min(1).max(10),
  sizeBytes: z.number().int().nonnegative(),
  polycount: z.number().int().nonnegative(),
  textureResolutions: z.array(z.number().int().positive()).max(64),
  materialCount: z.number().int().nonnegative(),
  gltfHeaderValid: z.boolean(),
  unsupportedMaterialFeatures: z.array(z.string().max(120)).max(64),
});

const publishBodySchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(60),
  description: z.string().max(4000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(25).default([]),
  /** What the editor measured (§7.3), carried with the request — see `PublishRecord`. */
  export: exportCandidateSchema,
  /** The §7.3 audit report. Absent means the audit has not been run, which blocks publish. */
  readiness: z
    .object({
      score: z.number().min(0).max(100),
      passed: z.boolean(),
      threshold: z.number().min(0).max(100),
      issues: z.array(z.record(z.unknown())).max(200).default([]),
      criteria: z.record(z.unknown()).optional(),
      metrics: z.record(z.unknown()).optional(),
    })
    .optional(),
  /** FR-11.10 — an explicit acknowledgment, required only when the audit is below threshold. */
  acknowledgment: z
    .object({ acknowledgedBy: z.string().min(1), acknowledgedAt: z.string() })
    .optional(),
  /**
   * FR-14.4 — when set, re-publish to this existing VOID·SPACE asset as a new version
   * rather than creating a second, disconnected asset.
   */
  republishAssetId: z.string().min(1).max(120).optional(),
  fileBase64: z.string().min(1),
  filename: z.string().min(1).max(255).default('export.glb'),
});

export interface ProjectRoutesOptions {
  readonly bridge: VoidSpaceBridge;
}

export async function projectRoutes(
  app: FastifyInstance,
  options: ProjectRoutesOptions,
): Promise<void> {
  const { bridge } = options;

  /** Resolves and caches the caller on the request. */
  const session = async (request: FastifyRequest): Promise<StudioSession> => {
    if (request.session) return request.session;
    const resolved = await resolveSession(app, request);
    request.session = resolved;
    return resolved;
  };

  app.get('/projects', async (request: FastifyRequest) => {
    const me = await session(request);
    // Parsed through the shared helper rather than by calling `parse` here, so a bad query produces
    // the same error envelope as every other route.
    const query = parseQuery(listProjectsQuerySchema, request.query ?? {});

    const projects = await withStudioTenant(me.tenantId, (db) =>
      db.project.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.search
            ? { name: { contains: query.search, mode: 'insensitive' as const } }
            : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          name: true,
          tags: true,
          status: true,
          storageMode: true,
          createdAt: true,
          updatedAt: true,
          publishes: {
            where: { supersededAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              voidspaceAssetId: true,
              status: true,
              lastSyncedAt: true,
              syncError: true,
            },
          },
        },
      }),
    );

    return {
      items: projects.map((project) => {
        const active = project.publishes[0];
        return {
          ...project,
          /** The link back into VOID·SPACE, so a project row is navigable to its asset. */
          publish: active
            ? {
                ...active,
                url: bridge.links.assetUrl(active.voidspaceAssetId),
                lastSyncedAt: active.lastSyncedAt.toISOString(),
              }
            : null,
        };
      }),
      links: bridge.links,
    };
  });

  app.post('/projects', async (request: FastifyRequest) => {
    const me = await session(request);
    const body = parseBody(createProjectSchema, request.body);
    /*
     * `asset:upload-own`, never `asset:publish`.
     *
     * §3.5.2 is explicit that the Studio "adds no shortcut and no parallel approval
     * path": submitting work to VOID·SPACE is an *upload*, and what happens next is
     * VOID·SPACE's review. `asset:publish` in the §3.6 matrix means "publish an approved
     * asset (mint licence + push to EoN)" — an Assessor/TenantAdmin action. Requiring it
     * here would make the Studio a second way to approve something, which is precisely
     * the guarantee VS-SRS-2.0 FR-7.6 exists to protect.
     */
    requirePermission(me, 'asset:upload-own');

    const project = await withStudioTenant(me.tenantId, (db) =>
      db.project.create({
        data: {
          tenantId: me.tenantId,
          ownerId: me.userId,
          name: body.name,
          tags: body.tags,
          storageMode: body.storageMode,
        },
        select: { id: true, name: true, storageMode: true, createdAt: true },
      }),
    );

    return { project };
  });

  app.get('/projects/:projectId', async (request: FastifyRequest) => {
    const me = await session(request);
    const { projectId } = parseParams(projectParamsSchema, request.params);

    const project = await withStudioTenant(me.tenantId, (db) =>
      db.project.findUnique({
        where: { id: projectId },
        include: {
          publishes: { orderBy: { createdAt: 'desc' }, take: 10 },
        },
      }),
    );
    if (!project) throw new NotFoundError('Project');

    return {
      project,
      links: {
        ...bridge.links,
        /** Follow a publish through to the platform that owns its licence (§3.5.2). */
        publishUrls: Object.fromEntries(
          project.publishes.map((record) => [
            record.id,
            bridge.links.assetUrl(record.voidspaceAssetId),
          ]),
        ),
      },
    };
  });

  /**
   * FR-14.1–14.4 — export, validate, gate, hand off, record.
   *
   * The JSON body carries the file as base64 rather than multipart. That is a
   * deliberate simplification of §2.4's multipart rule *for this hop*: multipart's
   * advantage is streaming a large file without buffering it, and the editor already
   * holds the export in memory as a Blob, so going through multipart here would add a
   * parser and change nothing about peak memory. The §2.4 requirement is honoured on
   * the hop that matters — Studio API to VOID·SPACE — by `packages/voidspace-client`,
   * which sends the metadata fields *before* the file so the far end can reject a bad
   * request before streaming 200 MB.
   */
  app.post('/projects/:projectId/publish', async (request: FastifyRequest) => {
    const me = await session(request);
    const { projectId } = parseParams(projectParamsSchema, request.params);
    const body = parseBody(publishBodySchema, request.body);
    requirePermission(me, 'asset:upload-own');

    const project = await withStudioTenant(me.tenantId, (db) =>
      db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } }),
    );
    if (!project) throw new NotFoundError('Project');

    // 1. FR-10.4 — a hard gate. If VOID·SPACE would refuse the file, publishing it can
    //    only produce a rejected upload and an error attributed to the wrong system.
    const exportValidation = validateExportCandidate(body.export satisfies ExportCandidate);
    const fileBytes = Buffer.from(body.fileBase64, 'base64');

    // The declared size is checked against the bytes actually received: a client that
    // under-reports would otherwise pass a size gate it should fail.
    if (fileBytes.byteLength !== body.export.sizeBytes) {
      throw new ValidationError(
        `The uploaded file is ${fileBytes.byteLength} bytes but the export metadata declares ` +
          `${body.export.sizeBytes}. Re-export and try again.`,
        { declared: body.export.sizeBytes, received: fileBytes.byteLength },
      );
    }
    if (fileBytes.byteLength > bridge.maxUploadBytes) {
      throw new ValidationError(
        `The export is larger than this Studio accepts (${fileBytes.byteLength} bytes).`,
        { limit: bridge.maxUploadBytes },
      );
    }

    // 2. FR-14.1 / FR-11.10 — the gate: hard on the export, advisory on the audit.
    const gate = evaluatePublishGate({
      exportValidation,
      readiness: body.readiness as ReadinessReport | undefined,
      acknowledgment: body.acknowledgment
        ? ({
            ...body.acknowledgment,
            readinessScore: body.readiness?.score ?? 0,
          } satisfies PublishAcknowledgment)
        : undefined,
    });

    if (!gate.allowed) {
      /*
       * Returned as a 409 carrying the gate's own reason, not a generic validation
       * error: the UI has to distinguish "your file is unreadable" from "run the
       * pre-publish check first" from "confirm you want to publish below the threshold",
       * because the three have different next actions and only the last is a choice.
       */
      throw new ConflictError(gate.message, `PUBLISH_BLOCKED_${gate.blockedBy}`, {
        blockedBy: gate.blockedBy,
        exportValidation,
      });
    }

    // 3. Only now check the credential: browsing works without one, so failing earlier
    //    would have produced the wrong message for a read-only deployment.
    bridge.requirePublishCredential();

    // 4. FR-14.2 (upload) / FR-14.4 (re-publish as a new version of the *same* asset).
    const metadata = {
      name: body.name,
      category: body.category,
      description: body.description,
      tags: body.tags,
      sourceTool: 'VOID·STUDIO' as const,
      submitForReview: true,
      // FR-14.2 — "a reference back to the originating VOID·STUDIO project", so the
      // asset's provenance in VOID·SPACE names where it came from.
      metadata: { studioProjectId: project.id, studioProjectName: project.name },
    };

    const file = {
      filename: body.filename,
      contentType: 'model/gltf-binary',
      data: fileBytes,
    };

    const asset = body.republishAssetId
      ? await viaUpstream('replace the asset version (FR-14.4)', () =>
          bridge.gateway.replaceAssetVersion(body.republishAssetId as string, { metadata, file }),
        )
      : await viaUpstream('upload the asset (FR-14.2)', () =>
          bridge.gateway.uploadAsset({ metadata, file }),
        );

    // 5. FR-14.3 — the link record, carrying the gate's evidence (§2.1: this is what
    //    makes the gate auditable for a project whose authoring state is local).
    const record = await withStudioTenant(me.tenantId, async (db) => {
      // One active record per publish lineage (§5.2): supersede the previous link.
      await db.publishRecord.updateMany({
        where: { projectId: project.id, supersededAt: null },
        data: { supersededAt: new Date() },
      });

      return db.publishRecord.create({
        data: {
          tenantId: me.tenantId,
          projectId: project.id,
          voidspaceAssetId: asset.id,
          voidspaceAssetVersionId: body.republishAssetId ?? null,
          status: normalizeStatus(asset.status),
          voidspaceRawStatus: asset.status,
          createdById: me.userId,
          acknowledgedById: body.acknowledgment ? me.userId : null,
          acknowledgedAt: body.acknowledgment ? new Date() : null,
          acknowledgedScore: body.acknowledgment ? (body.readiness?.score ?? null) : null,
          warnings: gate.warnings,
          readinessScore: body.readiness?.score ?? null,
          readinessPassed: body.readiness?.passed ?? null,
          readinessReport: (body.readiness ?? null) as never,
          exportValidation: exportValidation as never,
          exportSha256: createHash('sha256').update(fileBytes).digest('hex'),
          exportSizeBytes: BigInt(fileBytes.byteLength),
        },
        select: { id: true, status: true, voidspaceAssetId: true, exportSha256: true },
      });
    });

    return {
      publish: {
        ...record,
        /** The destination, so the Creator can follow the asset into VOID·SPACE. */
        url: bridge.links.assetUrl(asset.id),
      },
      gate: { warnings: gate.warnings },
      exportValidation,
      /** FR-14.3 — the UI polls this until the review decision lands. */
      pollUrl: `/studio/api/v1/projects/${project.id}/publish-status`,
    };
  });

  /**
   * FR-14.3/FR-14.5 — mirror VOID·SPACE's status and review decision back.
   *
   * Reads through the gateway and writes what it learned, so a Creator sees "pending /
   * approved / rejected / revision" inside the Studio, together with the Assessor's
   * comments, without switching tools.
   */
  app.get('/projects/:projectId/publish-status', async (request: FastifyRequest) => {
    const me = await session(request);
    const { projectId } = parseParams(projectParamsSchema, request.params);

    const record = await withStudioTenant(me.tenantId, (db) =>
      db.publishRecord.findFirst({
        where: { projectId, supersededAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (!record) throw new NotFoundError('Publish record');

    let synced = record;
    try {
      const asset = await bridge.gateway.getAsset(record.voidspaceAssetId);
      synced = await withStudioTenant(me.tenantId, (db) =>
        db.publishRecord.update({
          where: { id: record.id },
          data: {
            status: normalizeStatus(asset.status),
            voidspaceRawStatus: asset.status,
            lastSyncedAt: new Date(),
            syncError: null,
          },
        }),
      );
    } catch (error) {
      /*
       * A failed poll is recorded and reported, never thrown. A status that cannot be
       * refreshed is still the last known status, and a Creator is better served by
       * "approved, as of ten minutes ago, and VOID·SPACE is unreachable" than by a 502
       * that discards the good news along with the bad.
       */
      const message = error instanceof Error ? error.message : String(error);
      synced = await withStudioTenant(me.tenantId, (db) =>
        db.publishRecord.update({
          where: { id: record.id },
          data: { syncError: message.slice(0, 500), lastSyncedAt: new Date() },
        }),
      );
    }

    return {
      status: synced.status,
      rawStatus: synced.voidspaceRawStatus,
      reviewDecision: synced.reviewDecision,
      reviewComments: synced.reviewComments,
      reviewDecisionAt: synced.reviewDecisionAt,
      lastSyncedAt: synced.lastSyncedAt,
      syncError: synced.syncError,
      warnings: synced.warnings,
      exportSha256: synced.exportSha256,
      url: bridge.links.assetUrl(synced.voidspaceAssetId),
    };
  });
}

/**
 * Maps VOID·SPACE's asset status onto the Studio's mirror enum.
 *
 * An unknown value becomes `pending` rather than being guessed at: VOID·SPACE adding a
 * status the Studio does not model must never cause the Studio to claim an asset is
 * approved. The raw upstream string is stored beside it, so nothing is lost.
 */
function normalizeStatus(
  status: string,
): 'pending' | 'needs_manual_review' | 'approved' | 'rejected' | 'revision' | 'published' {
  switch (status) {
    case 'needs_manual_review':
    case 'approved':
    case 'rejected':
    case 'revision':
    case 'published':
      return status;
    default:
      return 'pending';
  }
}
