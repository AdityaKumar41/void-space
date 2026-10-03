/**
 * The pre-publish readiness audit route (VS2-SRS-1.0 §7.3, FR-11.10).
 *
 * §7.3 asks Claude to review an export candidate and return issues; this service runs that, but the
 * *score* is computed locally by `@void-space/studio-engine` — a deliberate deviation, recorded in
 * the package and in `docs/VOID-STUDIO.md` §3, because §7.3 also requires the report to be stored
 * against the `ProjectVersion` and a score that varies between two identical runs makes the stored
 * value uninterpretable.
 *
 * Two rules shape this route, and both are about the audit *not* being a gate:
 *
 *   - **It is advisory.** It returns a report; it refuses nothing. The publish gate is what decides,
 *     and it allows a below-threshold publish once acknowledged (FR-11.10).
 *   - **It must work with AI switched off.** §7.5 requires every AI feature to be disableable
 *     tenant-wide *and* the whole toolset to keep working, while FR-11.10 makes a completed audit a
 *     prerequisite for publishing. So when there is no provider, or the tenant has the feature off,
 *     this degrades to the deterministic measurements — which are what the score is computed from
 *     anyway — rather than failing. The response names which of those happened, so a report with no
 *     model narrative is explained rather than looking like a model call that broke.
 */
import { withStudioTenant } from '@void-space/studio-db';
import { InMemoryInvocationSink, runReadinessAudit } from '@void-space/studio-ai';
import type { ReadinessCriteria, SceneMetrics } from '@void-space/studio-engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { tenantHasAiFeature, type StudioAi } from '../lib/ai';
import { NotFoundError } from '../lib/errors';
import { parseBody, parseParams } from '../lib/http';
import { requirePermission, resolveSession, type StudioSession } from '../lib/session';
import { summarizeInvocation } from './copilot';

const projectParamsSchema = z.object({ projectId: z.string().uuid() });

/** §7.3's measurements, validated rather than trusted — the score is computed from these. */
const sceneMetricsSchema = z.object({
  totalPolycount: z.number().int().nonnegative(),
  objectCount: z.number().int().nonnegative(),
  materialCount: z.number().int().nonnegative(),
  textureResolutions: z.array(z.number().int().positive()).max(256),
  maxHierarchyDepth: z.number().int().nonnegative(),
  unnamedObjects: z.number().int().nonnegative(),
  meshesWithoutUvs: z.number().int().nonnegative(),
});

/** FR-18.1's per-tenant targets. All optional: `evaluateReadiness` supplies its own defaults. */
const criteriaSchema = z.object({
  maxPolycount: z.number().int().positive(),
  maxTextureResolution: z.number().int().positive(),
  maxMaterialCount: z.number().int().positive(),
  maxHierarchyDepth: z.number().int().positive(),
  requireObjectNames: z.boolean(),
  requireUvs: z.boolean(),
});

const auditBodySchema = z.object({
  metrics: sceneMetricsSchema,
  criteria: criteriaSchema.partial().optional(),
  threshold: z.number().min(0).max(100).optional(),
  /** Asks for the local-only path explicitly. The route may still choose it — see the header. */
  metricsOnly: z.boolean().default(false),
  /** §7.3 — write the report onto the project's latest version when one exists. */
  persist: z.boolean().default(true),
});

export interface AuditRoutesOptions {
  readonly ai: StudioAi;
}

/** Why the audit ran without a model, so the UI explains the report rather than apologising for it. */
export type AuditModelSkipReason = 'requested' | 'no_ai_provider' | 'feature_disabled' | null;

export async function auditRoutes(
  app: FastifyInstance,
  options: AuditRoutesOptions,
): Promise<void> {
  const { ai } = options;

  const session = async (request: FastifyRequest): Promise<StudioSession> => {
    if (request.session) return request.session;
    const resolved = await resolveSession(app, request);
    request.session = resolved;
    return resolved;
  };

  app.post('/projects/:projectId/audit', async (request: FastifyRequest) => {
    const me = await session(request);
    const { projectId } = parseParams(projectParamsSchema, request.params);
    const body = parseBody(auditBodySchema, request.body);
    requirePermission(me, 'asset:upload-own');

    const project = await withStudioTenant(me.tenantId, (db) =>
      db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } }),
    );
    if (!project) throw new NotFoundError('Project');

    // Read per request, never cached (§7.5, FR-18.1).
    const tenant = await withStudioTenant(me.tenantId, (db) =>
      db.tenant.findUnique({ where: { id: me.tenantId }, select: { aiFeatureFlags: true } }),
    );
    const flags = tenant?.aiFeatureFlags ?? {};

    const featureOn = tenantHasAiFeature(flags, 'readinessAudit');

    const skipReason: AuditModelSkipReason = body.metricsOnly
      ? 'requested'
      : !ai.configured
        ? 'no_ai_provider'
        : !featureOn
          ? 'feature_disabled'
          : null;
    const metricsOnly = skipReason !== null;

    const sink = new InMemoryInvocationSink();

    const result = await runReadinessAudit(metricsOnly ? undefined : ai.claudeFor(sink), {
      tenantId: me.tenantId,
      userId: me.userId,
      metrics: body.metrics satisfies SceneMetrics,
      ...(body.criteria === undefined ? {} : { criteria: body.criteria as ReadinessCriteria }),
      ...(body.threshold === undefined ? {} : { threshold: body.threshold }),
      metricsOnly,
    });

    /*
     * §7.3 stores the report against the `ProjectVersion`. For a `local` project there is no version
     * — §2.1 makes that a supported state, not an oversight — so nothing is written and the response
     * says so. The report still reaches the record that matters on that path: the publish handoff
     * writes the same report onto the `PublishRecord`, which is what makes the gate auditable for a
     * project whose authoring state never left the Creator's machine.
     */
    let storedOn: { readonly versionId: string; readonly versionNumber: number } | null = null;

    if (body.persist) {
      storedOn = await withStudioTenant(me.tenantId, async (db) => {
        const latest = await db.projectVersion.findFirst({
          where: { projectId: project.id },
          orderBy: { versionNumber: 'desc' },
          select: { id: true, versionNumber: true },
        });
        if (!latest) return null;

        await db.projectVersion.update({
          where: { id: latest.id },
          data: {
            readinessScore: result.report.score,
            readinessThreshold: result.report.threshold,
            readinessPassed: result.report.passed,
            readinessReport: result.report as never,
            readinessRunAt: new Date(),
          },
        });

        return { versionId: latest.id, versionNumber: latest.versionNumber };
      });
    }

    return {
      report: result.report,
      narrative: result.narrative,
      modelIssues: result.modelIssues,
      usedModel: result.usedModel,
      modelCalls: result.modelCalls,
      /** Null when a model reviewed the asset; otherwise why it did not. */
      modelSkippedBecause: skipReason,
      storedOn,
      invocation: summarizeInvocation(sink.entries),
      /** What this workspace may use, so the panel renders the truth without probing. */
      capability: {
        provider: ai.configured,
        readinessAudit: featureOn,
        copilot: tenantHasAiFeature(flags, 'copilot'),
        generativeMesh: tenantHasAiFeature(flags, 'generativeMesh'),
        generativeTexture: tenantHasAiFeature(flags, 'generativeTexture'),
      },
    };
  });
}
