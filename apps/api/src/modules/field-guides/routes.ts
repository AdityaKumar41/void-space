/**
 * Field IQ delivery: a reviewed lesson/asset becomes a compact guidance packet
 * that a mobile, QR or AR client can cache and complete against. Completion is
 * persisted as server-timestamped evidence, never a client-owned progress flag.
 */
import { recordAudit, withTenant, type Prisma } from '@void-space/db';
import {
  completeFieldGuideSchema,
  createFieldGuideSchema,
  fieldGuideStepSchema,
} from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';

const paramsSchema = z.object({ id: z.string().uuid() });
const stepsSchema = z.array(fieldGuideStepSchema).min(1);

function guideView(guide: {
  id: string;
  title: string;
  description: string;
  status: string;
  lessonId: string | null;
  assetId: string | null;
  steps: unknown;
  updatedAt: Date;
}) {
  return {
    ...guide,
    steps: stepsSchema.parse(guide.steps),
    updatedAt: guide.updatedAt.toISOString(),
  };
}

export async function fieldGuideRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/field-guides',
    { preHandler: app.requirePermission('learning:manage') },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new ForbiddenError('Authentication required', 'UNAUTHENTICATED');
      const input = parseBody(createFieldGuideSchema, request.body);
      const guide = await withTenant(principal.tenantId, async (db) => {
        if (input.lessonId) {
          const lesson = await db.lesson.findFirst({
            where: { id: input.lessonId, tenantId: principal.tenantId, isPublished: true },
            select: { id: true },
          });
          if (!lesson)
            throw new ValidationError('Field guides require a published lesson', {
              lessonId: input.lessonId,
            });
        }
        if (input.assetId) {
          const asset = await db.asset.findFirst({
            where: {
              id: input.assetId,
              tenantId: principal.tenantId,
              status: { in: ['approved', 'published'] },
            },
            select: { id: true },
          });
          if (!asset)
            throw new ValidationError('Field guides require an approved asset', {
              assetId: input.assetId,
            });
        }
        const stepAssetIds = input.steps.flatMap((step) => (step.assetId ? [step.assetId] : []));
        if (stepAssetIds.length) {
          const count = await db.asset.count({
            where: {
              id: { in: stepAssetIds },
              tenantId: principal.tenantId,
              status: { in: ['approved', 'published'] },
            },
          });
          if (count !== new Set(stepAssetIds).size)
            throw new ValidationError('Every step asset must be approved in this workspace');
        }
        const created = await db.fieldGuide.create({
          data: {
            tenantId: principal.tenantId,
            title: input.title,
            description: input.description,
            lessonId: input.lessonId,
            assetId: input.assetId,
            steps: input.steps as Prisma.InputJsonValue,
            createdById: principal.userId,
          },
        });
        await recordAudit(
          {
            action: 'field.guide_created',
            entityType: 'field_guide',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { lessonId: created.lessonId, assetId: created.assetId },
          },
          db,
        );
        return created;
      });
      return reply.status(201).send({ guide: guideView(guide) });
    },
  );

  app.patch(
    '/field-guides/:id',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const p = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const input = parseBody(createFieldGuideSchema, request.body);
      const guide = await withTenant(p.tenantId, async (db) => {
        const current = await db.fieldGuide.findFirst({ where: { id, tenantId: p.tenantId } });
        if (!current) throw new NotFoundError('Field guide');
        if (current.status !== 'draft')
          throw new ConflictError(
            'Published field guides are immutable. Create a new draft for changes.',
          );
        if (
          input.lessonId &&
          !(await db.lesson.findFirst({
            where: { id: input.lessonId, tenantId: p.tenantId, isPublished: true },
            select: { id: true },
          }))
        )
          throw new ValidationError('Select a published lesson in this workspace');
        if (
          input.assetId &&
          !(await db.asset.findFirst({
            where: {
              id: input.assetId,
              tenantId: p.tenantId,
              status: { in: ['approved', 'published'] },
            },
            select: { id: true },
          }))
        )
          throw new ValidationError('Select an approved asset in this workspace');
        const updated = await db.fieldGuide.update({
          where: { id },
          data: {
            title: input.title,
            description: input.description,
            lessonId: input.lessonId ?? null,
            assetId: input.assetId ?? null,
            steps: input.steps as Prisma.InputJsonValue,
          },
        });
        await recordAudit(
          {
            action: 'field.guide_updated',
            entityType: 'field_guide',
            entityId: id,
            actorId: p.userId,
            actorLabel: p.fullName,
          },
          db,
        );
        return updated;
      });
      return { guide: guideView(guide) };
    },
  );

  app.post(
    '/field-guides/:id/publish',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const guide = await withTenant(principal.tenantId, async (db) => {
        const current = await db.fieldGuide.findFirst({
          where: { id, tenantId: principal.tenantId },
        });
        if (!current) throw new NotFoundError('Field guide not found');
        stepsSchema.parse(current.steps);
        const updated = await db.fieldGuide.update({
          where: { id },
          data: { status: 'published' },
        });
        await recordAudit(
          {
            action: 'field.guide_published',
            entityType: 'field_guide',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return updated;
      });
      return { guide: guideView(guide) };
    },
  );

  app.get('/field-guides', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const guides = await withTenant(principal.tenantId, (db) =>
      db.fieldGuide.findMany({
        where: {
          tenantId: principal.tenantId,
          ...(principal.permissions.includes('learning:manage') ? {} : { status: 'published' }),
        },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    return { guides: guides.map(guideView) };
  });

  app.get('/field-guides/:id', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const { id } = paramsSchema.parse(request.params);
    const guide = await withTenant(principal.tenantId, (db) =>
      db.fieldGuide.findFirst({
        where: {
          id,
          tenantId: principal.tenantId,
          ...(principal.permissions.includes('learning:manage') ? {} : { status: 'published' }),
        },
      }),
    );
    if (!guide) throw new NotFoundError('Field guide not found');
    return { guide: guideView(guide) };
  });

  app.post('/field-guides/:id/runs', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = request.principal!;
    const { id } = paramsSchema.parse(request.params);
    const input = parseBody(completeFieldGuideSchema, request.body);
    const run = await withTenant(principal.tenantId, async (db) => {
      const guide = await db.fieldGuide.findFirst({
        where: { id, tenantId: principal.tenantId, status: 'published' },
      });
      if (!guide) throw new NotFoundError('Field guide not found');
      const stepIds = new Set(stepsSchema.parse(guide.steps).map((step) => step.id));
      const completed = [...new Set(input.completedStepIds)];
      if (completed.length !== stepIds.size || completed.some((stepId) => !stepIds.has(stepId))) {
        throw new ValidationError(
          'A field guide run must contain every published step exactly once',
        );
      }
      const created = await db.fieldGuideRun.create({
        data: {
          tenantId: principal.tenantId,
          guideId: guide.id,
          userId: principal.userId,
          completedSteps: completed as Prisma.InputJsonValue,
          device: input.device,
        },
      });
      await recordAudit(
        {
          action: 'field.guide_completed',
          entityType: 'field_guide_run',
          entityId: created.id,
          actorId: principal.userId,
          actorLabel: principal.fullName,
          afterState: { guideId: guide.id, device: created.device },
        },
        db,
      );
      return created;
    });
    return reply.status(201).send({
      run: { id: run.id, completedAt: run.completedAt.toISOString(), device: run.device },
    });
  });
}
