/**
 * Demo asset fixtures for `pnpm db:seed` — one asset in every lifecycle state
 * from Figure 4, so review, licensing, IPFS metadata and audit views all have
 * realistic data to show.
 */
import {
  JobQueue,
  JobStatus,
  LicenseStatus,
  PinStatus,
  Prisma,
  ReviewDecisionKind,
} from '../generated/client';
import { demoCid, demoId, demoTxHash } from './demo-ids';
import { withTenant } from './tenant';

export interface DemoVersionSpec {
  readonly versionNumber: number;
  readonly format: string;
  readonly sizeBytes: number;
  readonly polycount: number;
  readonly derivative?: boolean;
  readonly sourceLicense?: string;
  readonly sourceAttribution?: string;
}

export type DemoAssetStatus =
  | 'draft'
  | 'pending'
  | 'needs_manual_review'
  | 'approved'
  | 'rejected'
  | 'revision'
  | 'published';

export interface DemoAssetSpec {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly status: DemoAssetStatus;
  readonly createdByRole: 'Creator' | 'TenantAdmin';
  readonly versions: readonly DemoVersionSpec[];
  readonly currentVersionNumber: number;
  readonly sourceTool?: string;
  readonly ai?: {
    readonly tags: readonly string[];
    readonly description: string;
    readonly qualityFlags: readonly string[];
    readonly confidence: number;
    readonly needsManualReview?: boolean;
    readonly latencyMs: number;
  };
  readonly decision?: {
    readonly kind: 'approved' | 'rejected' | 'revision';
    readonly comment?: string;
  };
  readonly comments?: readonly {
    readonly body: string;
    readonly authorRole: 'Creator' | 'Assessor';
    readonly reply?: { readonly body: string; readonly authorRole: 'Creator' | 'Assessor' };
  }[];
  readonly license?: {
    readonly tokenId: bigint;
    readonly licenseType: string;
    readonly revoked?: boolean;
    readonly revokedReason?: string;
  };
  readonly jobs?: readonly {
    readonly queue: 'ai_enrichment' | 'ipfs_pin' | 'chain_license' | 'xr_publish';
    readonly status: 'completed' | 'failed' | 'active';
    readonly error?: string;
  }[];
  readonly publishToXr?: boolean;
}

export interface AssetSeedResult {
  readonly assets: number;
  readonly licenses: number;
  readonly auditEntries: number;
}

/**
 * Writes one demo asset and all of its dependent rows inside a single tenant
 * context (so RLS applies exactly as it will for the API).
 */
export async function seedAsset(
  tenantId: string,
  spec: DemoAssetSpec,
  userIds: Record<string, string>,
): Promise<AssetSeedResult> {
  const assetId = demoId(`asset:${tenantId}:${spec.key}`);
  const creatorId = userIds[spec.createdByRole === 'Creator' ? 'creator' : 'admin'];
  const assessorId = userIds.assessor;
  if (!creatorId || !assessorId) throw new Error('[seed] creator/assessor user missing');

  let licenses = 0;
  let auditEntries = 0;

  await withTenant(
    tenantId,
    async (db) => {
      const currentVersionId = demoId(
        `assetversion:${tenantId}:${spec.key}:v${spec.currentVersionNumber}`,
      );

      await db.asset.upsert({
        where: { id: assetId },
        update: {
          name: spec.name,
          category: spec.category,
          tags: [...spec.tags],
          status: spec.status,
        },
        create: {
          id: assetId,
          tenantId,
          creatorId,
          name: spec.name,
          category: spec.category,
          tags: [...spec.tags],
          status: spec.status,
        },
      });

      for (const version of spec.versions) {
        const versionId = demoId(`assetversion:${tenantId}:${spec.key}:v${version.versionNumber}`);
        await db.assetVersion.upsert({
          where: { id: versionId },
          update: { pinStatus: PinStatus.pinned },
          create: {
            id: versionId,
            tenantId,
            assetId,
            versionNumber: version.versionNumber,
            format: version.format,
            sizeBytes: BigInt(version.sizeBytes),
            polycount: version.polycount,
            vertices: version.polycount * 2,
            materials: 3,
            animations: 0,
            textures: 4,
            ipfsCid: demoCid(`${spec.key}:v${version.versionNumber}`),
            pinStatus: PinStatus.pinned,
            sourceTool: spec.sourceTool ?? 'Blender',
            sourceLicense: version.sourceLicense ?? null,
            sourceAttribution: version.sourceAttribution ?? null,
            isDerivative: version.derivative ?? false,
            derivativeOfVersionId: version.derivative
              ? demoId(`assetversion:${tenantId}:${spec.key}:v1`)
              : null,
            meshMetadata: { polycount: version.polycount, formats: [version.format] },
            createdById: creatorId,
          },
        });
      }

      await db.asset.update({
        where: { id: assetId },
        data: {
          currentVersionId,
          publishedAt: spec.status === 'published' ? new Date() : null,
          manifestUrl: spec.publishToXr ? `https://eon-reality.local/modules/${spec.key}` : null,
          xrManifestRef: spec.publishToXr ? `eon-manifest-${spec.key}` : null,
        },
      });

      if (spec.ai) {
        await db.aISuggestion.upsert({
          where: { assetVersionId: currentVersionId },
          update: {},
          create: {
            id: demoId(`ai:${tenantId}:${spec.key}`),
            tenantId,
            assetVersionId: currentVersionId,
            suggestedTags: [...spec.ai.tags],
            suggestedDescription: spec.ai.description,
            qualityFlags: [...spec.ai.qualityFlags],
            confidence: spec.ai.confidence,
            modelVersion: 'claude-sonnet-4-5',
            promptVersion: 'v1',
            latencyMs: spec.ai.latencyMs,
            needsManualReview: spec.ai.needsManualReview ?? false,
            rawResponse: { demo: true },
          },
        });
      }

      if (spec.decision) {
        const decisionId = demoId(`decision:${tenantId}:${spec.key}`);
        await db.reviewDecision.upsert({
          where: { id: decisionId },
          update: {},
          create: {
            id: decisionId,
            tenantId,
            assetId,
            assetVersionId: currentVersionId,
            assessorId,
            decision: spec.decision.kind as ReviewDecisionKind,
            comment: spec.decision.comment ?? null,
          },
        });
        auditEntries += 1;
      }

      // FR-4.6 — threaded review comments (one parent, optionally one reply).
      for (const [index, comment] of (spec.comments ?? []).entries()) {
        const parentId = demoId(`comment:${tenantId}:${spec.key}:${index}`);
        await db.reviewComment.upsert({
          where: { id: parentId },
          update: {},
          create: {
            id: parentId,
            tenantId,
            assetId,
            authorId: userIds[comment.authorRole === 'Creator' ? 'creator' : 'assessor'],
            body: comment.body,
          },
        });

        if (comment.reply) {
          const replyId = demoId(`comment:${tenantId}:${spec.key}:${index}:reply`);
          await db.reviewComment.upsert({
            where: { id: replyId },
            update: {},
            create: {
              id: replyId,
              tenantId,
              assetId,
              parentId,
              authorId: userIds[comment.reply.authorRole === 'Creator' ? 'creator' : 'assessor'],
              body: comment.reply.body,
            },
          });
        }
      }

      // FR-9.2/9.5 — the off-chain mirror of the on-chain licence record.
      if (spec.license) {
        const revoked = spec.license.revoked ?? false;
        await db.license.upsert({
          where: { tenantId_tokenId: { tenantId, tokenId: spec.license.tokenId } },
          update: { status: revoked ? LicenseStatus.revoked : LicenseStatus.active },
          create: {
            id: demoId(`license:${tenantId}:${spec.key}`),
            tenantId,
            assetId,
            assetVersionId: currentVersionId,
            approverId: assessorId,
            tokenId: spec.license.tokenId,
            contractAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
            txHash: demoTxHash(`${spec.key}:mint`),
            blockNumber: 42n,
            gasUsed: 118_432n,
            ipfsMetadataCid: demoCid(`license-meta:${spec.key}`),
            licenseTermsHash: demoTxHash(`${spec.key}:terms`),
            licenseType: spec.license.licenseType,
            licenseTerms: `${spec.license.licenseType} — demo licence terms for ${spec.name}`,
            status: revoked ? LicenseStatus.revoked : LicenseStatus.active,
            revokedReason: revoked ? (spec.license.revokedReason ?? 'Takedown requested') : null,
            revokedAt: revoked ? new Date() : null,
            revokedTxHash: revoked ? demoTxHash(`${spec.key}:revoke`) : null,
          },
        });
        licenses += 1;
        auditEntries += 1;
      }

      // §3.10 — durable job mirror, including one deliberately failed job so the
      // job-status UI has a failure to render.
      for (const [index, job] of (spec.jobs ?? []).entries()) {
        const jobId = demoId(`job:${tenantId}:${spec.key}:${index}`);
        await db.job.upsert({
          where: { id: jobId },
          update: { status: job.status as JobStatus },
          create: {
            id: jobId,
            tenantId,
            queue: job.queue as JobQueue,
            status: job.status as JobStatus,
            entityType: 'asset',
            entityId: assetId,
            payload: { assetId, demo: true },
            error: job.error ?? null,
            attempts: job.status === 'failed' ? 2 : 1,
            maxAttempts: 3,
            startedAt: new Date(Date.now() - 60_000),
            finishedAt: job.status === 'active' ? null : new Date(Date.now() - 55_000),
          },
        });
      }

      // FR-13.1 — the audit trail for this asset's demo lifecycle.
      const auditPlan: { action: string; after?: Record<string, unknown>; txHash?: string }[] = [
        { action: 'asset.created' },
        { action: 'asset.version_created' },
      ];
      if (spec.status !== 'draft') {
        auditPlan.push({ action: 'asset.submitted', after: { status: 'pending' } });
      }
      if (spec.ai) auditPlan.push({ action: 'ai.enrichment_completed' });
      if (spec.decision) {
        auditPlan.push({ action: 'asset.status_changed', after: { status: spec.decision.kind } });
      }
      if (spec.license) {
        auditPlan.push({
          action: 'chain.license_minted',
          txHash: demoTxHash(`${spec.key}:mint`),
        });
      }
      if (spec.license?.revoked) {
        auditPlan.push({
          action: 'chain.license_revoked',
          txHash: demoTxHash(`${spec.key}:revoke`),
        });
      }

      for (const [index, entry] of auditPlan.entries()) {
        const auditId = demoId(`audit:${tenantId}:${spec.key}:${index}`);
        const isAutomated = entry.action.startsWith('ai.');
        await db.auditLog.upsert({
          where: { id: auditId },
          update: {},
          create: {
            id: auditId,
            tenantId,
            actorId: isAutomated ? null : creatorId,
            actorLabel: isAutomated ? 'ai-enrichment-worker' : 'Chen Wei',
            action: entry.action,
            entityType: 'asset',
            entityId: assetId,
            beforeState: entry.after ? ({ status: 'pending' } as Prisma.InputJsonValue) : Prisma.JsonNull,
            afterState: entry.after ? (entry.after as Prisma.InputJsonValue) : Prisma.JsonNull,
            txHash: entry.txHash ?? null,
            blockNumber: entry.txHash ? 42n : null,
            gasUsed: entry.txHash ? 118_432n : null,
          },
        });
        auditEntries += 1;
      }

      // FR-11 — a notification aimed at whoever the state most concerns.
      const notificationType =
        spec.status === 'needs_manual_review'
          ? 'asset.needs_manual_review'
          : spec.status === 'draft'
            ? 'asset.submitted'
            : `asset.${spec.status}`;
      await db.notification.upsert({
        where: { id: demoId(`notify:${tenantId}:${spec.key}`) },
        update: {},
        create: {
          id: demoId(`notify:${tenantId}:${spec.key}`),
          tenantId,
          userId:
            spec.status === 'pending' || spec.status === 'needs_manual_review'
              ? assessorId
              : creatorId,
          type: notificationType,
          payload: { assetId, assetName: spec.name, status: spec.status },
        },
      });
    },
    { timeoutMs: 60_000 },
  );

  return { assets: 1, licenses, auditEntries };
}
// ------------------------------------------------------------------ fixtures

const GLB = 'glb';
const BLEND = 'blend';

/** Aurora: one asset in every lifecycle state, plus a revoked licence. */
const AURORA_ASSETS: readonly DemoAssetSpec[] = [
  {
    key: 'draft-conveyor-belt',
    name: 'Conveyor Belt Section A',
    category: 'Machinery',
    tags: ['conveyor', 'industrial', 'lowpoly'],
    status: 'draft',
    createdByRole: 'Creator',
    sourceTool: 'Blender',
    versions: [{ versionNumber: 1, format: GLB, sizeBytes: 4_812_544, polycount: 18_420 }],
    currentVersionNumber: 1,
    jobs: [{ queue: 'ipfs_pin', status: 'completed' }],
  },
  {
    key: 'pending-excavator',
    name: 'Hydraulic Excavator 320',
    category: 'Machinery',
    tags: ['excavator', 'heavy-equipment', 'vehicle'],
    status: 'pending',
    createdByRole: 'Creator',
    sourceTool: 'Blender',
    versions: [{ versionNumber: 1, format: GLB, sizeBytes: 18_204_672, polycount: 74_310 }],
    currentVersionNumber: 1,
    ai: {
      tags: ['excavator', 'construction', 'hydraulics', 'heavy-machinery'],
      description:
        'A tracked hydraulic excavator with an articulated boom, bucket and operator cab. Suitable for construction-site safety training modules.',
      qualityFlags: ['polycount-above-xr-budget'],
      confidence: 0.86,
      latencyMs: 3_940,
    },
    jobs: [
      { queue: 'ipfs_pin', status: 'completed' },
      { queue: 'ai_enrichment', status: 'completed' },
    ],
  },
  {
    key: 'manual-review-harness',
    name: 'Full-Body Safety Harness',
    category: 'Safety Equipment',
    tags: ['harness', 'ppe', 'fall-protection'],
    status: 'needs_manual_review',
    createdByRole: 'Creator',
    sourceTool: 'ZBrush',
    versions: [{ versionNumber: 1, format: GLB, sizeBytes: 9_331_200, polycount: 42_880 }],
    currentVersionNumber: 1,
    ai: {
      tags: [],
      description: '',
      qualityFlags: ['schema-validation-failed'],
      confidence: 0,
      needsManualReview: true,
      latencyMs: 6_120,
    },
    jobs: [
      { queue: 'ipfs_pin', status: 'completed' },
      {
        queue: 'ai_enrichment',
        status: 'failed',
        error: 'Claude response was not valid JSON after the stricter retry (FR-7.3)',
      },
    ],
  },
  {
    key: 'approved-crane',
    name: 'Tower Crane Assembly',
    category: 'Machinery',
    tags: ['crane', 'lifting', 'worksite'],
    status: 'approved',
    createdByRole: 'Creator',
    sourceTool: 'Maya',
    versions: [
      { versionNumber: 1, format: GLB, sizeBytes: 31_457_280, polycount: 128_400 },
      { versionNumber: 2, format: GLB, sizeBytes: 6_291_456, polycount: 46_200, derivative: true },
    ],
    currentVersionNumber: 1,
    ai: {
      tags: ['crane', 'lifting-operations', 'construction', 'rigging'],
      description:
        'A tower crane with jib, counter-jib, trolley and hook block, modelled for worksite lifting-procedure training.',
      qualityFlags: [],
      confidence: 0.91,
      latencyMs: 2_870,
    },
    decision: {
      kind: 'approved',
      comment: 'Geometry and scale verified against the site reference sheet.',
    },
    comments: [
      {
        body: 'Blender-optimised derivative (v2) is attached as a separate version for XR use.',
        authorRole: 'Creator',
        reply: {
          body: 'Noted — the approved licence will reference v1; v2 stays available as a derivative.',
          authorRole: 'Assessor',
        },
      },
    ],
    jobs: [
      { queue: 'ipfs_pin', status: 'completed' },
      { queue: 'ai_enrichment', status: 'completed' },
    ],
  },
  {
    key: 'revision-scaffold',
    name: 'Modular Scaffolding Kit',
    category: 'Environment',
    tags: ['scaffolding', 'modular', 'worksite'],
    status: 'revision',
    createdByRole: 'Creator',
    sourceTool: 'Blender',
    versions: [{ versionNumber: 1, format: GLB, sizeBytes: 12_582_912, polycount: 61_750 }],
    currentVersionNumber: 1,
    ai: {
      tags: ['scaffolding', 'modular-kit', 'construction'],
      description:
        'A modular scaffolding kit with uprights, ledgers, transoms and base plates for assembly training.',
      qualityFlags: ['missing-uv-on-two-meshes'],
      confidence: 0.74,
      latencyMs: 4_310,
    },
    decision: {
      kind: 'revision',
      comment:
        'Two uprights are missing UVs, which will break texturing in the XR module. Please fix and resubmit.',
    },
    comments: [
      {
        body: 'Requesting a revision: upright meshes 3 and 7 have no UV layer.',
        authorRole: 'Assessor',
        reply: { body: 'Thanks — fixing the UVs and re-uploading as version 2 today.', authorRole: 'Creator' },
      },
    ],
    jobs: [
      { queue: 'ipfs_pin', status: 'completed' },
      { queue: 'ai_enrichment', status: 'completed' },
    ],
  },
  {
    key: 'rejected-signage',
    name: 'Emergency Exit Signage Set',
    category: 'Prop',
    tags: ['signage', 'emergency', 'exit'],
    status: 'rejected',
    createdByRole: 'Creator',
    sourceTool: 'Cinema 4D',
    versions: [{ versionNumber: 1, format: GLB, sizeBytes: 1_204_224, polycount: 3_120 }],
    currentVersionNumber: 1,
    decision: {
      kind: 'rejected',
      comment:
        'Signage legend does not match the ISO 7010 pictogram used on site. Not usable for compliance training.',
    },
    comments: [
      {
        body: 'Rejecting: the pictogram must match ISO 7010 for the compliance module.',
        authorRole: 'Assessor',
      },
    ],
    jobs: [{ queue: 'ipfs_pin', status: 'completed' }],
  },
  {
    key: 'published-drill',
    name: 'Cordless Impact Drill',
    category: 'Tooling',
    tags: ['drill', 'power-tool', 'handheld'],
    status: 'published',
    createdByRole: 'Creator',
    sourceTool: 'Blender',
    versions: [{ versionNumber: 1, format: GLB, sizeBytes: 7_864_320, polycount: 28_640 }],
    currentVersionNumber: 1,
    ai: {
      tags: ['power-tool', 'drill', 'handheld', 'maintenance'],
      description:
        'A cordless impact drill with battery pack, chuck and trigger, modelled for tool-safety training.',
      qualityFlags: [],
      confidence: 0.93,
      latencyMs: 2_180,
    },
    decision: { kind: 'approved', comment: 'Approved — meets the XR polycount budget.' },
    license: { tokenId: 1n, licenseType: 'CC0' },
    publishToXr: true,
    jobs: [
      { queue: 'ipfs_pin', status: 'completed' },
      { queue: 'chain_license', status: 'completed' },
      { queue: 'xr_publish', status: 'completed' },
    ],
  },
  {
    key: 'published-imported-cone',
    name: 'Traffic Cone (imported)',
    category: 'Prop',
    tags: ['traffic-cone', 'cc0', 'imported', 'worksite'],
    status: 'published',
    createdByRole: 'Creator',
    sourceTool: 'Poly Pizza',
    versions: [
      {
        versionNumber: 1,
        format: GLB,
        sizeBytes: 524_288,
        polycount: 1_204,
        sourceLicense: 'CC0',
        sourceAttribution: 'Poly Pizza — “Traffic cone” by Poly by Google',
      },
    ],
    currentVersionNumber: 1,
    decision: {
      kind: 'approved',
      comment: 'CC0 provenance confirmed; licence retained in metadata (NFR-COMP.1).',
    },
    /* Revoked afterwards: demonstrates a takedown that keeps the history (FR-9.5). */
    license: {
      tokenId: 2n,
      licenseType: 'Commercial-Use',
      revoked: true,
      revokedReason: 'Takedown requested by the original author',
    },
    publishToXr: false,
    jobs: [{ queue: 'ipfs_pin', status: 'completed' }],
  },
];

/** Northwind: a second tenant, so cross-tenant isolation is visible in the UI. */
const NORTHWIND_ASSETS: readonly DemoAssetSpec[] = [
  {
    key: 'nw-pending-ladder',
    name: 'Extension Ladder 3-Section',
    category: 'Safety Equipment',
    tags: ['ladder', 'access', 'work-at-height'],
    status: 'pending',
    createdByRole: 'TenantAdmin',
    sourceTool: 'Blender',
    versions: [{ versionNumber: 1, format: GLB, sizeBytes: 5_242_880, polycount: 22_140 }],
    currentVersionNumber: 1,
    ai: {
      tags: ['ladder', 'work-at-height', 'access-equipment'],
      description:
        'A three-section extension ladder with stabiliser feet and rung locks, for working-at-height training.',
      qualityFlags: [],
      confidence: 0.88,
      latencyMs: 3_120,
    },
    jobs: [
      { queue: 'ipfs_pin', status: 'completed' },
      { queue: 'ai_enrichment', status: 'completed' },
    ],
  },
  {
    key: 'nw-published-anchor',
    name: 'Fall-Arrest Anchor Point',
    category: 'Safety Equipment',
    tags: ['anchor-point', 'fall-arrest', 'roof'],
    status: 'published',
    createdByRole: 'TenantAdmin',
    sourceTool: '3ds Max',
    versions: [{ versionNumber: 1, format: GLB, sizeBytes: 3_145_728, polycount: 12_880 }],
    currentVersionNumber: 1,
    decision: { kind: 'approved', comment: 'Approved for the roof-safety module.' },
    license: { tokenId: 1n, licenseType: 'Internal-Only' },
    publishToXr: true,
    jobs: [
      { queue: 'ipfs_pin', status: 'completed' },
      { queue: 'chain_license', status: 'completed' },
      { queue: 'xr_publish', status: 'completed' },
    ],
  },
];

export const DEMO_ASSETS = {
  aurora: AURORA_ASSETS,
  northwind: NORTHWIND_ASSETS,
} as const;

/** Seeds every fixture for one tenant and aggregates the counters. */
export async function seedTenantAssets(
  tenantId: string,
  specs: readonly DemoAssetSpec[],
  userIds: Record<string, string>,
): Promise<AssetSeedResult> {
  const totals = { assets: 0, licenses: 0, auditEntries: 0 };
  for (const spec of specs) {
    const result = await seedAsset(tenantId, spec, userIds);
    totals.assets += result.assets;
    totals.licenses += result.licenses;
    totals.auditEntries += result.auditEntries;
  }
  return totals;
}


