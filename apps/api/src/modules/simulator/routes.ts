/**
 * Genesis Simulator-style evidence loop. Scenario authors supply a weighted,
 * auditable rubric; clients submit only observed evidence. Scores and the pass
 * result are calculated here so an XR, web, or headset client cannot award a
 * credential by sending a fabricated score.
 */
import { recordAudit, withTenant, type Prisma } from '@void-space/db';
import {
  createScenarioSchema,
  scenarioRubricItemSchema,
  submitScenarioAttemptSchema,
  storedExperienceSchema,
} from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';

const paramsSchema = z.object({ id: z.string().uuid() });
const rubricSchema = z.array(scenarioRubricItemSchema).min(1);
const interactiveFormats = new Set(['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply']);

function scenarioView(scenario: {
  id: string;
  title: string;
  description: string;
  status: string;
  lessonId: string | null;
  twinId: string | null;
  rubric: unknown;
  experience?: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  const stored = storedExperienceSchema.safeParse(scenario.experience);
  return {
    ...scenario,
    experience: undefined,
    interactive: stored.success,
    media: stored.success ? stored.data.media : null,
    taskCount: stored.success ? stored.data.definition.steps.length : 0,
    rubric: rubricSchema.parse(scenario.rubric),
  };
}

export async function simulatorRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/simulations',
    { preHandler: app.requirePermission('learning:manage') },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new ForbiddenError('Authentication required', 'UNAUTHENTICATED');
      const input = parseBody(createScenarioSchema, request.body);
      const scenario = await withTenant(principal.tenantId, async (db) => {
        if (input.lessonId) {
          const lesson = await db.lesson.findFirst({
            where: { id: input.lessonId, tenantId: principal.tenantId, isPublished: true },
            select: { id: true },
          });
          if (!lesson)
            throw new ValidationError('Simulations require a published lesson', {
              lessonId: input.lessonId,
            });
        }
        if (input.twinId) {
          const twin = await db.digitalTwin.findFirst({
            where: { id: input.twinId, tenantId: principal.tenantId },
            select: { id: true },
          });
          if (!twin) throw new ValidationError('Digital twin not found', { twinId: input.twinId });
        }
        let experience: Prisma.InputJsonValue | undefined;
        if (input.experience) {
          const asset = await db.asset.findFirst({
            where: {
              id: input.experience.assetId,
              tenantId: principal.tenantId,
              status: { in: ['approved', 'published'] },
            },
            include: { currentVersion: true },
          });
          if (!asset?.currentVersion?.ipfsCid)
            throw new ValidationError('Select an approved asset with a ready 3D preview');
          if (!interactiveFormats.has(asset.currentVersion.format.toLowerCase().replace(/^\./, '')))
            throw new ValidationError(
              'This source format does not support interactive scene previews',
            );
          experience = {
            definition: input.experience,
            media: {
              versionId: asset.currentVersion.id,
              cid: asset.currentVersion.ipfsCid,
              format: asset.currentVersion.format,
              name: asset.name,
              polycount: asset.currentVersion.polycount,
            },
          } as Prisma.InputJsonValue;
        }
        const created = await db.simulationScenario.create({
          data: {
            tenantId: principal.tenantId,
            title: input.title,
            description: input.description,
            lessonId: input.lessonId,
            twinId: input.twinId,
            experience,
            rubric: (input.experience
              ? input.experience.steps.map((step) => ({
                  id: step.id,
                  label: step.title,
                  weight: step.weight,
                }))
              : input.rubric) as Prisma.InputJsonValue,
            createdById: principal.userId,
          },
        });
        await recordAudit(
          {
            action: 'simulation.scenario_created',
            entityType: 'simulation_scenario',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { lessonId: created.lessonId, twinId: created.twinId },
          },
          db,
        );
        return created;
      });
      return reply.status(201).send({ scenario: scenarioView(scenario) });
    },
  );

  app.patch(
    '/simulations/:id',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const { id } = paramsSchema.parse(request.params);
      const p = request.principal!;
      const input = parseBody(createScenarioSchema, request.body);
      const updated = await withTenant(p.tenantId, async (db) => {
        const existing = await db.simulationScenario.findFirst({
          where: { id, tenantId: p.tenantId },
        });
        if (!existing) throw new NotFoundError('Scenario');
        if (existing.status !== 'draft')
          throw new ConflictError(
            'Published experiences are immutable. Create another draft to revise them.',
          );
        if (!input.experience)
          throw new ValidationError(
            'Use the spatial authoring workspace to define the scene and tasks',
          );
        const asset = await db.asset.findFirst({
          where: {
            id: input.experience.assetId,
            tenantId: p.tenantId,
            status: { in: ['approved', 'published'] },
          },
          include: { currentVersion: true },
        });
        if (!asset?.currentVersion?.ipfsCid)
          throw new ValidationError('Select an approved asset with a ready preview');
        if (!interactiveFormats.has(asset.currentVersion.format.toLowerCase().replace(/^\./, '')))
          throw new ValidationError(
            'This source format does not support interactive scene previews',
          );
        const experience = {
          definition: input.experience,
          media: {
            versionId: asset.currentVersion.id,
            cid: asset.currentVersion.ipfsCid,
            format: asset.currentVersion.format,
            name: asset.name,
            polycount: asset.currentVersion.polycount,
          },
        };
        const result = await db.simulationScenario.update({
          where: { id },
          data: {
            title: input.title,
            description: input.description,
            experience: experience as Prisma.InputJsonValue,
            rubric: input.experience.steps.map((step) => ({
              id: step.id,
              label: step.title,
              weight: step.weight,
            })),
          },
        });
        await recordAudit(
          {
            action: 'simulation.scenario_updated',
            entityType: 'simulation_scenario',
            entityId: id,
            actorId: p.userId,
            actorLabel: p.fullName,
          },
          db,
        );
        return result;
      });
      return { scenario: scenarioView(updated) };
    },
  );

  app.get(
    '/simulations/:id/author',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const { id } = paramsSchema.parse(request.params);
      const p = request.principal!;
      const scenario = await withTenant(p.tenantId, (db) =>
        db.simulationScenario.findFirst({ where: { id, tenantId: p.tenantId } }),
      );
      if (!scenario) throw new NotFoundError('Scenario');
      return {
        scenario: {
          ...scenarioView(scenario),
          definition: storedExperienceSchema.safeParse(scenario.experience).success
            ? storedExperienceSchema.parse(scenario.experience).definition
            : null,
        },
      };
    },
  );
  app.post(
    '/simulations/:id/publish',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const scenario = await withTenant(principal.tenantId, async (db) => {
        const existing = await db.simulationScenario.findFirst({
          where: { id, tenantId: principal.tenantId },
        });
        if (!existing) throw new NotFoundError('Simulation scenario not found');
        // Validate persisted JSON before release too: it protects existing data
        // should future imports or migrations bypass the request schema.
        rubricSchema.parse(existing.rubric);
        if (existing.experience) {
          const stored = storedExperienceSchema.parse(existing.experience);
          const source = await db.asset.findFirst({
            where: {
              id: stored.definition.assetId,
              tenantId: principal.tenantId,
              status: { in: ['approved', 'published'] },
              currentVersionId: stored.media.versionId,
            },
            select: { id: true },
          });
          if (!source)
            throw new ConflictError(
              'The source asset changed. Review the scene against its current approved version.',
            );
        }
        const updated = await db.simulationScenario.update({
          where: { id },
          data: { status: 'published' },
        });
        await recordAudit(
          {
            action: 'simulation.scenario_published',
            entityType: 'simulation_scenario',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return updated;
      });
      return { scenario: scenarioView(scenario) };
    },
  );

  app.get('/simulations', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const includeDrafts =
      z.object({ includeDrafts: z.enum(['true', 'false']).optional() }).parse(request.query)
        .includeDrafts === 'true' && principal.permissions.includes('learning:manage');
    const scenarios = await withTenant(principal.tenantId, (db) =>
      db.simulationScenario.findMany({
        where: {
          tenantId: principal.tenantId,
          ...(!includeDrafts ? { status: 'published' as const } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    return { scenarios: scenarios.map(scenarioView) };
  });

  app.get('/simulations/:id', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const { id } = paramsSchema.parse(request.params);
    const scenario = await withTenant(principal.tenantId, (db) =>
      db.simulationScenario.findFirst({
        where: { id, tenantId: principal.tenantId, status: 'published' },
      }),
    );
    if (!scenario) throw new NotFoundError('Simulation scenario not found');
    return { scenario: scenarioView(scenario) };
  });

  app.post(
    '/simulations/:id/attempts',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const input = parseBody(submitScenarioAttemptSchema, request.body);
      const attempt = await withTenant(principal.tenantId, async (db) => {
        const scenario = await db.simulationScenario.findFirst({
          where: { id, tenantId: principal.tenantId, status: 'published' },
        });
        if (!scenario) throw new NotFoundError('Simulation scenario not found');
        if (scenario.experience)
          throw new ConflictError(
            'Interactive assessments accept scene actions through a run, not self-reported checkbox evidence.',
          );
        const rubric = rubricSchema.parse(scenario.rubric);
        const possible = rubric.reduce((total, item) => total + item.weight, 0);
        const earned = rubric.reduce(
          (total, item) => total + (input.evidence[item.id] === true ? item.weight : 0),
          0,
        );
        const score = Math.round((earned / possible) * 100);
        const passed = score >= 80;
        const created = await db.scenarioAttempt.create({
          data: {
            tenantId: principal.tenantId,
            scenarioId: scenario.id,
            learnerId: principal.userId,
            evidence: input.evidence as Prisma.InputJsonValue,
            score,
            passed,
          },
        });
        await recordAudit(
          {
            action: 'simulation.assessment_completed',
            entityType: 'scenario_attempt',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { scenarioId: scenario.id, score, passed, earned, possible },
          },
          db,
        );
        return created;
      });
      return reply.status(201).send({
        attempt: {
          id: attempt.id,
          score: attempt.score,
          passed: attempt.passed,
          completedAt: attempt.completedAt.toISOString(),
        },
      });
    },
  );
}
