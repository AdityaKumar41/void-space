import { lessonPreview } from './preview';
import { syncLessonListing } from './public';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withTenant, learningStorageRoot } from '@void-space/db';
import {
  lessonPlanSchema,
  lessonPlanRequestSchema,
  lessonReviewSchema,
  learnerLessonPlan,
  learningActionSchema,
  initialLessonActivityState,
  experienceStateSchema,
  type AuthPrincipal,
  type ExperienceState,
  lessonTemplate,
} from '@void-space/types';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../../env';
import type { JobProducer } from '../../lib/jobs';
import { parseBody } from '../../lib/http';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { requirePrivateAuthor, requireTeacher } from '../learning-hub/access';
import { enqueueLearningTask } from '../learning-hub/tasks';
import { advanceLearning } from '../learning-hub/runtime';
import { answerLessonQuestion } from '../learning/mentor';
import { starterActivity } from '../learning-hub/starters';
import {
  accessibleRelease,
  activeLessonShareId,
  digest,
  json,
  lessonAsset,
  ownedPlan,
  parsePlan,
  validatePlan,
} from './service';
const idParams = z.object({ id: z.string().uuid() });
const releaseQuery = z.object({ tenant: z.string().uuid() });
interface StudyState {
  completed: string[];
  currentSection: string;
  activities: Record<string, ExperienceState>;
  events: Record<string, { hash: string; feedback: string }>;
  feedback: string;
}
const freshState = (section: string): StudyState => ({
  completed: [],
  currentSection: section,
  activities: {},
  events: {},
  feedback: '',
});
const publicState = (s: StudyState) => {
  const { events, ...safe } = s;
  return safe;
};
export async function lessonPlanRoutes(
  app: FastifyInstance,
  { env, producer }: { env: ApiEnv; producer: JobProducer },
) {
  const auth = { preHandler: app.authenticate };
  const enqueue = (p: AuthPrincipal, kind: string, input: unknown) =>
    enqueueLearningTask(env, producer, p, kind, input);
  const owned = (p: AuthPrincipal, id: string) =>
    withTenant(p.tenantId, (db) => ownedPlan(db, p, id));
  app.get('/learning/lesson-plans', auth, async (request) => {
    const p = request.principal!;
    const [plans, grants] = await Promise.all([
      withTenant(p.tenantId, (db) =>
        db.lessonPlan.findMany({
          where: { ownerId: p.userId },
          select: {
            id: true,
            title: true,
            revision: true,
            updatedAt: true,
            definition: true,
            releases: {
              select: { id: true, revision: true, reviewed: true, visibility: true },
              orderBy: [{ reviewed: 'desc' }, { revision: 'desc' }],
              take: 1,
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        }),
      ),
      withTenant(p.tenantId, (db) =>
        db.lessonGrant.findMany({
          where: { ownerId: p.userId },
          take: 100,
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ]);
    const shared = [];
    for (const g of grants) {
      try {
        const r = await accessibleRelease(p, g.releaseTenantId, g.releaseId);
        const study = await withTenant(r.tenantId, (db) =>
          db.lessonStudy.findUnique({
            where: { releaseId_ownerId: { releaseId: r.id, ownerId: p.userId } },
          }),
        );
        const def = parsePlan(r.definition);
        shared.push({
          id: r.id,
          tenantId: r.tenantId,
          title: def.title,
          durationMinutes: def.durationMinutes,
          preview: lessonPreview(def),
          completed: (study?.state as unknown as StudyState)?.completed.length ?? 0,
          total: def.sections.length,
        });
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e;
      }
    }
    const legacyLessons = await withTenant(p.tenantId, (db) =>
      db.lesson.findMany({
        where: { OR: [{ createdById: p.userId }, { isPublished: true }] },
        select: { id: true, title: true, isPublished: true },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    );
    return {
      plans: plans.map(({ definition, ...p }) => ({
        ...p,
        preview: lessonPreview(parsePlan(definition)),
      })),
      shared,
      legacyLessons,
    };
  });
  app.post('/learning/lesson-plans/from-lesson/:id', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    requirePrivateAuthor(p);
    const legacy = await withTenant(p.tenantId, (db) =>
      db.lesson.findFirst({
        where: { id, OR: [{ createdById: p.userId }, { isPublished: true }] },
      }),
    );
    if (!legacy) throw new NotFoundError('Earlier lesson');
    const def = lessonTemplate({
      topic: legacy.title,
      audience: 'Learners aged 13+',
      durationMinutes: 30,
      instructions: '',
      sourceIds: [],
    });
    def.summary = legacy.summary;
    def.sections[1]!.body = legacy.narration;
    def.sections[4]!.body = legacy.summary;
    const questions = z
      .array(
        z.object({
          id: z.string(),
          prompt: z.string(),
          options: z.array(z.string()).min(2),
          correctOption: z.number().int().min(0),
          explanation: z.string(),
        }),
      )
      .safeParse(legacy.questions);
    if (!questions.success || questions.data.some((q) => q.correctOption >= q.options.length))
      throw new ValidationError(
        'The original quiz has an invalid answer key. Correct it before copying.',
      );
    if (questions.data.length) {
      const a = def.sections[3]!.activity!;
      a.steps = questions.data.slice(0, 30).map((q, i) => ({
        id: `legacy_${i}`,
        kind: 'choice',
        title: `Knowledge check ${i + 1}`,
        instruction: q.prompt,
        explanation: q.explanation,
        objectiveId: 'evidence',
        weight: 100,
        sourceRefs: [],
        choices: q.options.map((label, n) => ({ id: `option_${n}`, label })),
        correctIds: [`option_${q.correctOption}`],
      }));
      a.objectives = [{ id: 'evidence', label: `Explain the key ideas in ${legacy.title}` }];
    }
    const plan = await withTenant(p.tenantId, (db) =>
      db.lessonPlan.create({
        data: {
          tenantId: p.tenantId,
          ownerId: p.userId,
          title: def.title,
          definition: json(parsePlan(def)),
        },
      }),
    );
    return reply.code(201).send({ plan });
  });
  app.post('/learning/lesson-plans/examples/:key', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const { key } = z
      .object({ key: z.enum(['geometry', 'diagram', 'process']) })
      .parse(request.params);
    const activity = starterActivity(key)!;
    // First-party example text is embedded in the lesson rather than citing a nonexistent upload.
    for (const node of [...activity.blocks, ...activity.targets, ...activity.steps])
      node.sourceRefs = [];
    const def = lessonTemplate(
      {
        topic: activity.title,
        audience: 'Learners aged 13+',
        durationMinutes: 30,
        instructions: '',
        sourceIds: [],
      },
      activity,
    );
    def.summary = activity.summary;
    def.objectives = activity.objectives.map((x) => x.label);
    def.sections[1]!.body = activity.blocks.map((b) => b.text).join('\n\n');
    def.sections[2]!.kind = 'practice';
    def.sections[4]!.body =
      activity.targets.map((t) => `${t.label}: ${t.explanation}`).join('\n') || activity.summary;
    const plan = await withTenant(p.tenantId, (db) =>
      db.lessonPlan.create({
        data: {
          tenantId: p.tenantId,
          ownerId: p.userId,
          title: def.title,
          definition: json(parsePlan(def)),
        },
      }),
    );
    return reply.code(201).send({ plan });
  });
  app.post('/learning/lesson-plans', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const definition = parseBody(lessonPlanSchema, request.body);
    await validatePlan(p, definition);
    const plan = await withTenant(p.tenantId, (db) =>
      db.lessonPlan.create({
        data: {
          tenantId: p.tenantId,
          ownerId: p.userId,
          title: definition.title,
          definition: json(definition),
        },
      }),
    );
    return reply.code(201).send({ plan });
  });
  app.get('/learning/lesson-plans/assets/:id', auth, async (request) => {
    const { id } = idParams.parse(request.params);
    const a = await lessonAsset(request.principal!, id);
    const v = a.currentVersion!;
    return {
      asset: {
        id: a.id,
        name: a.name,
        description: a.description,
        versionId: v.id,
        cid: v.ipfsCid,
        format: v.format,
        polycount: v.polycount,
        meshCount: (v.meshMetadata as { meshCount?: number } | null)?.meshCount ?? null,
        attribution: v.sourceAttribution ?? a.name,
        sourceUrl: v.sourceUrl,
        sourceLicense: v.sourceLicense,
      },
    };
  });
  app.post('/learning/lesson-plans/generate', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const input = parseBody(lessonPlanRequestSchema, request.body);
    const asset = input.assetId ? await lessonAsset(p, input.assetId) : null;
    const sources = await withTenant(p.tenantId, (db) =>
      db.learningSource.count({
        where: { id: { in: input.sourceIds }, ownerId: p.userId, status: 'ready' },
      }),
    );
    if (sources !== new Set(input.sourceIds).size)
      throw new ValidationError('Choose ready private sources.');
    return reply.code(202).send({
      task: await enqueue(p, 'plan_generate', {
        request: input,
        asset: asset
          ? {
              id: asset.id,
              name: asset.name,
              description: asset.description,
              versionId: asset.currentVersion!.id,
              cid: asset.currentVersion!.ipfsCid,
              format: asset.currentVersion!.format,
              polycount: asset.currentVersion!.polycount,
              attribution: asset.currentVersion!.sourceAttribution ?? asset.name,
            }
          : null,
      }),
    });
  });
  app.get('/learning/lesson-plans/:id', auth, async (request) => {
    const p = request.principal!,
      plan = await owned(p, idParams.parse(request.params).id);
    const release = await withTenant(p.tenantId, (db) =>
      db.lessonPlanRelease.findFirst({
        where: { planId: plan.id },
        orderBy: [{ reviewed: 'desc' }, { revision: 'desc' }],
        select: { id: true, tenantId: true, revision: true, reviewed: true, visibility: true },
      }),
    );
    return { plan: { ...plan, release } };
  });
  app.patch('/learning/lesson-plans/:id', auth, async (request) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    requirePrivateAuthor(p);
    const input = parseBody(
      z.object({ revision: z.number().int().min(0), definition: lessonPlanSchema }).strict(),
      request.body,
    );
    await validatePlan(p, input.definition);
    return withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM lesson_plans WHERE id=${id}::uuid FOR UPDATE`;
      const plan = await ownedPlan(db, p, id);
      if (plan.revision !== input.revision)
        throw new ConflictError('This draft changed in another tab. Reload it before saving.');
      return {
        plan: await db.lessonPlan.update({
          where: { id },
          data: {
            definition: json(input.definition),
            title: input.definition.title,
            revision: { increment: 1 },
            review: json({}),
          },
        }),
      };
    });
  });
  app.post('/learning/lesson-plans/:id/study', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params),
      before = await owned(p, id),
      def = parsePlan(before.definition),
      excerpts = await validatePlan(p, def);
    const release = await withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM lesson_plans WHERE id=${id}::uuid FOR UPDATE`;
      const plan = await ownedPlan(db, p, id);
      if (plan.revision !== before.revision)
        throw new ConflictError('Save or reload the draft before starting study.');
      return db.lessonPlanRelease.upsert({
        where: { planId_revision: { planId: id, revision: plan.revision } },
        create: {
          tenantId: p.tenantId,
          ownerId: p.userId,
          planId: id,
          revision: plan.revision,
          definition: json(def),
          sourceExcerpts: json(excerpts),
          reviewed: false,
        },
        update: {},
      });
    });
    return reply.code(201).send({
      release: { id: release.id, tenantId: release.tenantId, revision: release.revision },
    });
  });
  app.post('/learning/lesson-plans/:id/revise', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    requirePrivateAuthor(p);
    const input = parseBody(
      z
        .object({
          revision: z.number().int().min(0),
          instruction: z.string().trim().min(5).max(3000),
          sectionId: z.string().max(80).optional(),
        })
        .strict(),
      request.body,
    );
    const plan = await owned(p, id);
    if (plan.revision !== input.revision)
      throw new ConflictError('Save or reload the current draft first.');
    if (
      input.sectionId &&
      !parsePlan(plan.definition).sections.some((s) => s.id === input.sectionId)
    )
      throw new ValidationError('Choose a lesson section.');
    return reply.code(202).send({
      task: await enqueue(p, 'plan_generate', {
        planId: id,
        baseRevision: plan.revision,
        instruction: input.instruction,
        sectionId: input.sectionId,
        definition: plan.definition,
      }),
    });
  });
  app.post('/learning/lesson-plans/:id/apply', auth, async (request) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    requirePrivateAuthor(p);
    const input = parseBody(
      z.object({ taskId: z.string().uuid(), revision: z.number().int().min(0) }).strict(),
      request.body,
    );
    const task = await withTenant(p.tenantId, (db) =>
      db.learningTask.findFirst({
        where: {
          id: input.taskId,
          ownerId: p.userId,
          kind: { in: ['plan_generate', 'agent_turn'] },
          status: 'completed',
        },
      }),
    );
    const result = task?.result as {
      definition?: unknown;
      planId?: string;
      baseRevision?: number;
    } | null;
    if (!result || result.planId !== id || result.baseRevision !== input.revision)
      throw new ValidationError('This proposal does not apply to the current draft.');
    const def = parsePlan(result.definition);
    await validatePlan(p, def);
    return withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM lesson_plans WHERE id=${id}::uuid FOR UPDATE`;
      const plan = await ownedPlan(db, p, id);
      if (plan.revision !== input.revision)
        throw new ConflictError('This draft changed. Generate a fresh proposal.');
      return {
        plan: await db.lessonPlan.update({
          where: { id },
          data: {
            definition: json(def),
            title: def.title,
            revision: { increment: 1 },
            review: json({}),
          },
        }),
      };
    });
  });
  app.post('/learning/lesson-plans/:id/publish', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    requirePrivateAuthor(p);
    const input = parseBody(
      z
        .object({
          revision: z.number().int().min(0),
          review: lessonReviewSchema,
          visibility: z.enum(['private', 'institution', 'public']).default('private'),
        })
        .strict(),
      request.body,
    );
    if (input.visibility === 'institution') requireTeacher(p);
    const before = await owned(p, id),
      def = parsePlan(before.definition),
      excerpts = await validatePlan(p, def);
    const release = await withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM lesson_plans WHERE id=${id}::uuid FOR UPDATE`;
      const plan = await ownedPlan(db, p, id);
      if (plan.revision !== input.revision || plan.revision !== before.revision)
        throw new ConflictError('The draft changed. Review the latest version.');
      const existing = await db.lessonPlanRelease.findUnique({
        where: { planId_revision: { planId: id, revision: plan.revision } },
      });
      if (existing?.reviewed) {
        const r = await db.lessonPlanRelease.update({
          where: { id: existing.id },
          data: { visibility: input.visibility },
        });
        await syncLessonListing(db, r);
        return r;
      }
      const releaseRevision = existing ? plan.revision + 1 : plan.revision;
      await db.lessonPlan.update({
        where: { id },
        data: { review: json(input.review), revision: releaseRevision },
      });
      const created = await db.lessonPlanRelease.create({
        data: {
          tenantId: p.tenantId,
          ownerId: p.userId,
          planId: id,
          revision: releaseRevision,
          definition: json(def),
          sourceExcerpts: json(excerpts),
          reviewed: true,
          visibility: input.visibility,
        },
      });
      await syncLessonListing(db, created);
      return created;
    });
    return reply.code(201).send({
      release: { id: release.id, tenantId: release.tenantId, revision: release.revision },
    });
  });
  app.get('/learning/lesson-plans/releases/:id', auth, async (request) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params),
      { tenant } = releaseQuery.parse(request.query);
    const r = await accessibleRelease(p, tenant, id),
      def = parsePlan(r.definition),
      owner = r.ownerId === p.userId;
    if ((request.query as { present?: string }).present === 'true' && !owner)
      throw new ForbiddenError('Presentation notes are available only to the lesson owner.');
    const study = await withTenant(tenant, (db) =>
      db.lessonStudy.findUnique({
        where: { releaseId_ownerId: { releaseId: id, ownerId: p.userId } },
      }),
    );
    return {
      release: {
        id,
        tenantId: tenant,
        owner,
        reviewed: r.reviewed,
        visibility: r.visibility,
        definition:
          owner && z.object({ present: z.literal('true') }).safeParse(request.query).success
            ? def
            : learnerLessonPlan(def),
        sourceExcerpts: r.sourceExcerpts,
      },
      progress: study
        ? { revision: study.revision, state: publicState(study.state as unknown as StudyState) }
        : { revision: 0, state: publicState(freshState(def.sections[0]!.id)) },
    };
  });
  app.post('/learning/lesson-plans/releases/:id/shares', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    requirePrivateAuthor(p);
    const r = await accessibleRelease(p, p.tenantId, id);
    if (r.ownerId !== p.userId || !r.reviewed)
      throw new ForbiddenError('Publish a reviewed lesson before sharing.');
    const secret = randomBytes(24).toString('hex');
    const share = await withTenant(p.tenantId, (db) =>
      db.lessonShare.create({
        data: { tenantId: p.tenantId, ownerId: p.userId, releaseId: id, tokenHash: digest(secret) },
      }),
    );
    return reply.code(201).send({ shareId: share.id, code: `${p.tenantId}.${share.id}.${secret}` });
  });
  app.get('/learning/lesson-plans/releases/:id/shares', auth, async (request) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    const r = await accessibleRelease(p, p.tenantId, id);
    if (r.ownerId !== p.userId) throw new ForbiddenError();
    return {
      shares: await withTenant(p.tenantId, (db) =>
        db.lessonShare.findMany({
          where: { releaseId: id, ownerId: p.userId },
          select: { id: true, revokedAt: true, createdAt: true },
        }),
      ),
    };
  });
  app.delete('/learning/lesson-plans/shares/:id', auth, async (request) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    const result = await withTenant(p.tenantId, (db) =>
      db.lessonShare.updateMany({
        where: { id, ownerId: p.userId },
        data: { revokedAt: new Date() },
      }),
    );
    if (!result.count) throw new NotFoundError('Lesson link');
    return { revoked: true };
  });
  app.post(
    '/learning/lesson-plans/join',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const p = request.principal!;
      const { code } = parseBody(z.object({ code: z.string().max(160) }).strict(), request.body);
      const parts = code.trim().split('.');
      const [tenant, shareId, secret] = z
        .tuple([z.string().uuid(), z.string().uuid(), z.string().regex(/^[a-f0-9]{48}$/)])
        .parse(parts);
      const share = await withTenant(tenant, async (db) => {
        await db.$queryRaw`SELECT id FROM lesson_shares WHERE id=${shareId}::uuid FOR UPDATE`;
        const s = await db.lessonShare.findFirst({
          where: { id: shareId, tokenHash: digest(secret), revokedAt: null },
        });
        if (!s) throw new NotFoundError('Active lesson link');
        const release = await db.lessonPlanRelease.findUniqueOrThrow({
          where: { id: s.releaseId },
        });
        if (release.visibility === 'institution' && p.tenantId !== tenant)
          throw new NotFoundError('Institution membership');
        return s;
      });
      await withTenant(p.tenantId, (db) =>
        db.lessonGrant.upsert({
          where: { ownerId_shareId: { ownerId: p.userId, shareId } },
          create: {
            tenantId: p.tenantId,
            ownerId: p.userId,
            releaseTenantId: tenant,
            releaseId: share.releaseId,
            shareId,
          },
          update: {},
        }),
      );
      return { releaseId: share.releaseId, tenantId: tenant };
    },
  );
  app.get('/learning/lesson-plans/releases/:id/visual', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params),
      { tenant, section } = z
        .object({ tenant: z.string().uuid(), section: z.string() })
        .parse(request.query);
    const release = await accessibleRelease(p, tenant, id),
      a = parsePlan(release.definition).sections.find((s) => s.id === section)?.activity;
    const imageId =
      a?.scene.kind === 'diagram'
        ? a.scene.imageSourceId
        : a?.scene.kind === 'model'
          ? a.scene.privateModelId
          : undefined;
    if (!imageId) throw new NotFoundError('Lesson visual');
    const source = await withTenant(tenant, (db) =>
      db.learningSource.findFirst({
        where: { id: imageId, ownerId: release.ownerId, status: 'ready' },
      }),
    );
    if (
      !source?.storagePath ||
      !['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary'].includes(source.mime) ||
      !resolve(source.storagePath).startsWith(learningStorageRoot(env.STAGING_DIR) + '/')
    )
      throw new NotFoundError('Lesson visual');
    return reply
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .type(source.mime)
      .send(await readFile(source.storagePath));
  });
  app.post('/learning/lesson-plans/releases/:id/events', auth, async (request) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params),
      { tenant } = releaseQuery.parse(request.query);
    const r = await accessibleRelease(p, tenant, id),
      def = parsePlan(r.definition);
    const input = parseBody(
      z
        .object({
          eventKey: z.string().uuid(),
          revision: z.number().int().min(0),
          sectionId: z.string().max(80),
          kind: z.enum(['complete', 'activity']),
          action: learningActionSchema.optional(),
        })
        .strict(),
      request.body,
    );
    const section = def.sections.find((s) => s.id === input.sectionId);
    if (!section) throw new ValidationError('Unknown lesson section');
    const activeShare =
      r.ownerId !== p.userId && r.visibility === 'private'
        ? await activeLessonShareId(p, tenant, id)
        : null;
    return withTenant(tenant, async (db) => {
      // Serialize the first creation and subsequent updates, including submissions from stale tabs.
      await db.$queryRaw`SELECT id FROM lesson_plan_releases WHERE id=${id}::uuid FOR SHARE`;
      const live = await db.lessonPlanRelease.findUniqueOrThrow({ where: { id } });
      if (
        live.ownerId !== p.userId &&
        !(live.reviewed && live.visibility === 'institution' && p.tenantId === tenant) &&
        !(
          live.reviewed &&
          live.visibility === 'public' &&
          (await db.publicLessonEntry.findUnique({ where: { id } }))
        )
      ) {
        if (activeShare)
          await db.$queryRaw`SELECT id FROM lesson_shares WHERE id=${activeShare}::uuid FOR SHARE`;
        if (
          live.visibility !== 'private' ||
          !activeShare ||
          !(await db.lessonShare.findFirst({ where: { id: activeShare, revokedAt: null } }))
        )
          throw new NotFoundError('Active lesson access');
      }
      await db.lessonStudy.upsert({
        where: { releaseId_ownerId: { releaseId: id, ownerId: p.userId } },
        create: {
          tenantId: tenant,
          ownerId: p.userId,
          releaseId: id,
          state: json(freshState(def.sections[0]!.id)),
        },
        update: {},
      });
      await db.$queryRaw`SELECT id FROM lesson_studies WHERE release_id=${id}::uuid AND owner_id=${p.userId}::uuid FOR UPDATE`;
      const study = await db.lessonStudy.findUniqueOrThrow({
          where: { releaseId_ownerId: { releaseId: id, ownerId: p.userId } },
        }),
        state = study.state as unknown as StudyState,
        hash = digest(JSON.stringify({ ...input, revision: 0 }));
      const seen = state.events[input.eventKey];
      if (seen) {
        if (seen.hash !== hash)
          throw new ConflictError('An event key cannot be reused for another answer.');
        return { revision: study.revision, state: publicState(state), duplicate: true };
      }
      if (study.revision !== input.revision)
        throw new ConflictError('Progress changed in another tab. Reload to continue.');
      if (Object.keys(state.events).length >= 2000)
        throw new ConflictError(
          'This lesson has reached its saved interaction limit. Contact the author.',
        );
      state.currentSection = section.id;
      if (input.kind === 'activity') {
        if (!section.activity || !input.action)
          throw new ValidationError('This section has no activity action.');
        const previous = experienceStateSchema.parse(
          state.activities[section.id] ?? initialLessonActivityState(),
        );
        const next = advanceLearning(section.activity, previous, input.action, 'practice');
        state.activities[section.id] = next.state;
        state.feedback = next.state.feedback;
      } else {
        if (
          ['quiz', 'practice'].includes(section.kind) &&
          state.activities[section.id]?.status !== 'completed'
        )
          throw new ValidationError('Complete the inline activity before finishing this section.');
        if (!state.completed.includes(section.id)) state.completed.push(section.id);
        const next = def.sections[def.sections.findIndex((s) => s.id === section.id) + 1];
        if (next) state.currentSection = next.id;
        state.feedback = next
          ? 'Section saved. Continue with the next part.'
          : 'Lesson saved. Your recap is ready.';
      }
      state.events[input.eventKey] = { hash, feedback: state.feedback };
      const saved = await db.lessonStudy.update({
        where: { id: study.id },
        data: { revision: { increment: 1 }, state: json(state) },
      });
      return { revision: saved.revision, state: publicState(state) };
    });
  });
  app.post('/learning/lesson-plans/releases/:id/mentor', auth, async (request) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params),
      { tenant } = releaseQuery.parse(request.query),
      r = await accessibleRelease(p, tenant, id),
      def = parsePlan(r.definition);
    const input = parseBody(
      z
        .object({
          sectionId: z.string(),
          targetId: z.string().optional(),
          question: z.string().trim().min(3).max(1000),
        })
        .strict(),
      request.body,
    );
    const s = def.sections.find((s) => s.id === input.sectionId);
    if (!s) throw new ValidationError('Unknown section');
    const study = await withTenant(tenant, (db) =>
      db.lessonStudy.findUnique({
        where: { releaseId_ownerId: { releaseId: id, ownerId: p.userId } },
      }),
    );
    const state = study?.state as unknown as StudyState | undefined;
    const complete = state?.activities[s.id]?.status === 'completed';
    if (s.kind === 'quiz' && !complete)
      throw new ForbiddenError('Finish the quiz before asking for an explanation.');
    const target = s.activity?.targets.find((t) => t.id === input.targetId);
    if (input.targetId && !target) throw new ValidationError('Unknown component');
    const refs = [...s.sourceRefs, ...(target?.sourceRefs ?? [])];
    const excerpts = (
      r.sourceExcerpts as { sourceId: string; passageId: string; text: string }[]
    ).filter((x) => refs.some((y) => y.sourceId === x.sourceId && y.passageId === x.passageId));
    return answerLessonQuestion(
      {
        title: def.title,
        summary: def.summary,
        narration: [
          s.body,
          target?.explanation,
          ...(complete
            ? (s.activity?.steps.map((q) => `${q.instruction}: ${q.explanation}`) ?? [])
            : []),
          ...excerpts.map((x) => x.text),
        ]
          .filter(Boolean)
          .join('\n'),
        outline: def.objectives,
      },
      input.question,
      env,
    );
  });
  app.post('/learning/lesson-plans/releases/:id/exports', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params),
      { tenant } = releaseQuery.parse(request.query),
      r = await accessibleRelease(p, tenant, id);
    const input = parseBody(
      z
        .object({
          format: z.enum(['pdf', 'pptx']),
          audience: z.enum(['student', 'teacher']).default('student'),
        })
        .strict(),
      request.body,
    );
    if ((input.audience === 'teacher' || input.format === 'pptx') && r.ownerId !== p.userId)
      throw new ForbiddenError('Teacher exports require lesson ownership.');
    const study = await withTenant(tenant, (db) =>
      db.lessonStudy.findUnique({
        where: { releaseId_ownerId: { releaseId: id, ownerId: p.userId } },
      }),
    );
    return reply.code(202).send({
      task: await enqueue(p, 'plan_export', {
        releaseId: id,
        releaseTenantId: tenant,
        shareId:
          r.ownerId === p.userId || r.visibility !== 'private'
            ? null
            : await activeLessonShareId(p, tenant, id),
        ...input,
        progress: study ? publicState(study.state as unknown as StudyState) : null,
      }),
    });
  });
  app.get('/learning/lesson-plans/exports/:id/file', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = idParams.parse(request.params);
    const t = await withTenant(p.tenantId, (db) =>
      db.learningTask.findFirst({
        where: { id, ownerId: p.userId, kind: 'plan_export', status: 'completed' },
      }),
    );
    if (!t) throw new NotFoundError('Lesson export');
    const input = t.input as { releaseId: string; releaseTenantId: string };
    await accessibleRelease(p, input.releaseTenantId, input.releaseId);
    const result = t.result as { path: string; format: 'pdf' | 'pptx' };
    const root = resolve(learningStorageRoot(env.STAGING_DIR), p.tenantId, 'exports');
    if (!resolve(result.path).startsWith(root + '/')) throw new NotFoundError('Export file');
    reply
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `attachment; filename="void-space-lesson.${result.format}"`);
    return reply
      .type(
        result.format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      )
      .send(await readFile(result.path));
  });
}
