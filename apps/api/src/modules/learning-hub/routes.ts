import { enqueueLearningTask } from './tasks';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { learningStorageRoot, isLearningStoragePath, withTenant, verifyPassword, recordAudit, type Prisma } from '@void-space/db';
import {
  learningActivitySchema,
  learningProgramUnitSchema,
  type AuthPrincipal,
  type LearningActivity,
} from '@void-space/types';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../../env';
import type { JobProducer } from '../../lib/jobs';
import { parseBody } from '../../lib/http';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import {
  isTeacher,
  requireTeacher,
  requirePrivateAuthor,
  readableActivity,
  validateActivitySources,
  publicActivity,
} from './access';
import { unitProgress, syncLearningPrograms } from './progress';
import { starterCatalog, starterActivity } from './starters';
import { answerLessonQuestion } from '../learning/mentor';
const uuid = z.string().uuid();
const params = z.object({ id: uuid });
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const title = z.string().trim().min(3).max(200);
const generation = z
  .object({
    title,
    sourceIds: z.array(uuid).min(1).max(5),
    kind: z.enum(['diagram', 'process', 'none', 'model']),
    scope: z.enum(['private', 'workspace']).default('private'),
  })
  .strict();
export async function learningHubRoutes(
  app: FastifyInstance,
  { env, producer }: { env: ApiEnv; producer: JobProducer },
) {
  const auth = { preHandler: app.authenticate };
  const root = learningStorageRoot(env.STAGING_DIR);
  const enqueue = (p: AuthPrincipal, kind: string, input: unknown) => enqueueLearningTask(env, producer, p, kind, input);
  app.get('/learning/catalog', async () => ({ items: starterCatalog }));
  app.get('/learning/sources', auth, async (request) => ({
    sources: await withTenant(request.principal!.tenantId, (db) =>
      db.learningSource.findMany({
        where: { ownerId: request.principal!.userId },
        select: {
          id: true,
          title: true,
          mime: true,
          status: true,
          passages: true,
          error: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ),
  }));
  app.post('/learning/sources', auth, async (request, reply) => {
    requirePrivateAuthor(request.principal!);
    const input = parseBody(
      z.object({ title, text: z.string().trim().min(20).max(100000) }).strict(),
      request.body,
    );
    const p = request.principal!;
    const paragraphs = input.text
      .split(/\n\s*\n|\n/)
      .filter(Boolean)
      .flatMap((line) => line.match(/[\s\S]{1,2500}/g) ?? [])
      .slice(0, 100)
      .map((text, i) => ({ id: `p${i + 1}`, page: 1, text }));
    const source = await withTenant(p.tenantId, (db) =>
      db.learningSource.create({
        data: {
          tenantId: p.tenantId,
          ownerId: p.userId,
          title: input.title,
          mime: 'text/plain',
          passages: paragraphs,
        },
      }),
    );
    return reply.code(201).send({ source });
  });
  app.post('/learning/sources/:id/retry',auth,async(request,reply)=>{
    const p=request.principal!;requirePrivateAuthor(p);const {id}=params.parse(request.params);
    const source=await withTenant(p.tenantId,db=>db.learningSource.findFirst({where:{id,ownerId:p.userId,mime:'application/pdf',status:'failed'}}));
    if(!source)throw new NotFoundError('Failed private PDF');
    const changed=await withTenant(p.tenantId,db=>db.learningSource.updateMany({where:{id,ownerId:p.userId,status:'failed'},data:{status:'extracting',error:null}}));
    if(!changed.count)throw new ConflictError('This source is already being processed.');
    try {
      const task=await enqueue(p,'extract',{sourceId:id});
      if(task.status==='failed')await withTenant(p.tenantId,db=>db.learningSource.update({where:{id},data:{status:'failed',error:task.error}}));
      return reply.code(202).send({task});
    }catch(error){await withTenant(p.tenantId,db=>db.learningSource.update({where:{id},data:{status:'failed',error:'Extraction could not start. Try again after pending jobs finish.'}}));throw error;}
  });
  app.post('/learning/sources/upload', auth, async (request, reply) => {
    requirePrivateAuthor(request.principal!);
    const p = request.principal!;
    const part = await request.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    if (!part) throw new ValidationError('Choose a text PDF, PNG, JPEG or WebP file');
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(part.mimetype))
      throw new ValidationError('Use a text PDF, PNG, JPEG or WebP file');
    const bytes = await part.toBuffer();
    if (part.file.truncated) throw new ValidationError('Source exceeds 10 MB');
    const signatures: Record<string, boolean> = {
      'application/pdf': bytes.subarray(0, 5).toString() === '%PDF-',
      'image/png': bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'image/jpeg': bytes[0] === 255 && bytes[1] === 216,
      'image/webp':
        bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
    };
    if (!signatures[part.mimetype])
      throw new ValidationError('File contents do not match the selected source format');
    const id = randomUUID(),
      directory = join(root, p.tenantId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, id);
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    try {
      const source = await withTenant(p.tenantId, (db) =>
        db.learningSource.create({
          data: {
            id,
            tenantId: p.tenantId,
            ownerId: p.userId,
            title: part.filename.slice(0, 200),
            mime: part.mimetype,
            status: part.mimetype === 'application/pdf' ? 'extracting' : 'ready',
            storagePath: path,
            passages: [],
          },
        }),
      );
      const task =
        part.mimetype === 'application/pdf' ? await enqueue(p, 'extract', { sourceId: id }) : null;
      if(task?.status==='failed')await withTenant(p.tenantId,db=>db.learningSource.update({where:{id},data:{status:'failed',error:task.error}}));
      return reply.code(201).send({ source: { ...source, ...(task?.status==='failed'?{status:'failed',error:task.error}:{}), storagePath: undefined }, task });
    } catch (e) {
      const saved=await withTenant(p.tenantId,db=>db.learningSource.updateMany({where:{id,ownerId:p.userId},data:{status:'failed',error:'Source saved, but processing could not start. Retry extraction.'}}));
      if(!saved.count)await rm(path, { force: true });
      throw e;
    }
  });
  app.get('/learning/sources/:id/file', auth, async (request, reply) => {
    const { id } = params.parse(request.params),
      p = request.principal!;
    const source = await withTenant(p.tenantId, (db) =>
      db.learningSource.findFirst({ where: { id, ownerId: p.userId } }),
    );
    if (!source?.storagePath || !isLearningStoragePath(source.storagePath,env.STAGING_DIR))
      throw new NotFoundError('Private source');
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type(source.mime)
      .send(await readFile(source.storagePath));
  });
  app.get('/learning/activities', auth, async (request) => {
    const p = request.principal!;
    const rows = await withTenant(p.tenantId, (db) =>
      db.simulationScenario.findMany({
        where: {
          OR: [{ createdById: p.userId }, { status: 'published', learningScope: 'workspace' }],
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    );
    return {
      activities: rows.flatMap((row) => {
        const a = learningActivitySchema.safeParse(row.experience);
        return a.success
          ? [
              {
                id: row.id,
                title: a.data.title,
                summary: a.data.summary,
                kind: a.data.scene.kind,
                level: a.data.level,
                estimatedMinutes: a.data.estimatedMinutes,
                status: row.status,
                scope: row.learningScope,
                owned: row.createdById === p.userId,
              },
            ]
          : [];
      }),
    };
  });
  app.post('/learning/starters/:key/import', auth, async (request, reply) => {
    const p = request.principal!,
      key = z.object({ key: z.string() }).parse(request.params).key,
      a = starterActivity(key);
    if (!a) throw new NotFoundError('Starter activity');
    const row = await withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM users WHERE id=${p.userId}::uuid FOR UPDATE`;
      const existing = await db.simulationScenario.findFirst({
        where: { createdById: p.userId, title: a.title, learningScope: 'private' },
      });
      if (existing) return existing;
      const source = await db.learningSource.create({
        data: {
          tenantId: p.tenantId,
          ownerId: p.userId,
          title: `Void Space first-party source: ${a.title}`,
          mime: 'text/plain',
          passages: a.blocks.map((b, i) => ({ id: `p${i + 1}`, page: 1, text: b.text })),
        },
      });
      const ref = { sourceId: source.id, passageId: 'p1' };
      const reviewed = {
        ...a,
        blocks: a.blocks.map((b) => ({ ...b, sourceRefs: [ref] })),
        targets: a.targets.map((t) => ({ ...t, sourceRefs: [ref] })),
        steps: a.steps.map((s) => ({ ...s, sourceRefs: [ref] })),
      };
      return db.simulationScenario.create({
        data: {
          tenantId: p.tenantId,
          createdById: p.userId,
          title: a.title,
          description: a.summary,
          status: 'draft',
          learningScope: 'private',
          rubric: [],
          experience: json(reviewed),
        },
      });
    });
    return reply.code(201).send({ activity: { id: row.id } });
  });
  app.get('/learning/activities/:id', auth, async (request) => {
    const p = request.principal!,
      { id } = params.parse(request.params);
    return withTenant(p.tenantId, async (db) => {
      const row = await readableActivity(db, p, id),
        a = learningActivitySchema.parse(row.experience);
      const sourceIds = [
        ...new Set(
          [...a.blocks, ...a.targets, ...a.steps].flatMap((x) =>
            x.sourceRefs.map((r) => r.sourceId),
          ),
        ),
      ];
      const sources = await db.learningSource.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, title: true, passages: true },
      });
      return {
        activity: {
          id: row.id,
          status: row.status,
          scope: row.learningScope,
          owned: row.createdById === p.userId,
          definition: publicActivity(a),
          sources: sources.map((source) => ({
            ...source,
            passages: (source.passages as { id: string }[]).filter((passage) =>
              [...a.blocks, ...a.targets, ...a.steps].some((x) =>
                x.sourceRefs.some(
                  (ref) => ref.sourceId === source.id && ref.passageId === passage.id,
                ),
              ),
            ),
          })),
        },
      };
    });
  });
  app.get('/learning/activities/:id/visual', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = params.parse(request.params);
    const source = await withTenant(p.tenantId, async (db) => {
      const row = await readableActivity(db, p, id),
        a = learningActivitySchema.parse(row.experience);
      if (a.scene.kind !== 'diagram' || !a.scene.imageSourceId)
        throw new NotFoundError('Activity visual');
      return db.learningSource.findFirst({
        where: {
          id: a.scene.imageSourceId,
          ownerId: row.createdById,
          mime: { in: ['image/png', 'image/jpeg', 'image/webp'] },
          status: 'ready',
        },
      });
    });
    if (!source?.storagePath || !isLearningStoragePath(source.storagePath,env.STAGING_DIR))
      throw new NotFoundError('Reviewed activity visual');
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type(source.mime)
      .send(await readFile(source.storagePath));
  });
  app.get('/learning/activities/:id/author', auth, async (request) => {
    const p = request.principal!,
      { id } = params.parse(request.params);
    const row = await withTenant(p.tenantId, (db) =>
      db.simulationScenario.findFirst({ where: { id, createdById: p.userId } }),
    );
    if (!row) throw new NotFoundError('Own learning draft');
    return {
      activity: {
        id: row.id,
        status: row.status,
        scope: row.learningScope,
        definition: learningActivitySchema.parse(row.experience),
      },
    };
  });
  const draftSchema = z
    .object({
      definition: learningActivitySchema,
      scope: z.enum(['private', 'workspace']).default('private'),
    })
    .strict();
  app.post('/learning/activities', auth, async (request, reply) => {
    requirePrivateAuthor(request.principal!);
    const p = request.principal!,
      input = parseBody(draftSchema, request.body);
    if (input.scope === 'workspace') requireTeacher(p);
    const activity = await withTenant(p.tenantId, async (db) => {
      await validateActivitySources(db, p, input.definition);
      return db.simulationScenario.create({
        data: {
          tenantId: p.tenantId,
          createdById: p.userId,
          title: input.definition.title,
          description: input.definition.summary,
          learningScope: input.scope,
          rubric: [],
          experience: json({ ...input.definition, reviewed: false }),
        },
      });
    });
    return reply.code(201).send({ activity: { id: activity.id } });
  });
  app.patch('/learning/activities/:id', auth, async (request) => {
    const p = request.principal!,
      { id } = params.parse(request.params),
      input = parseBody(draftSchema, request.body);
    if (input.scope === 'workspace') requireTeacher(p);
    return withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM simulation_scenarios WHERE id=${id}::uuid FOR UPDATE`;
      const row = await db.simulationScenario.findFirst({ where: { id, createdById: p.userId } });
      if (!row) throw new NotFoundError('Own activity');
      if (row.status === 'published')
        throw new ConflictError('Published releases are immutable. Make a new draft to revise.');
      await validateActivitySources(db, p, input.definition);
      return {
        activity: await db.simulationScenario.update({
          where: { id },
          data: {
            title: input.definition.title,
            description: input.definition.summary,
            learningScope: input.scope,
            experience: json(input.definition),
          },
        }),
      };
    });
  });
  app.post('/learning/activities/:id/revise', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = params.parse(request.params);
    const row = await withTenant(p.tenantId, async (db) => {
      const old = await readableActivity(db, p, id);
      if (old.createdById !== p.userId)
        throw new ForbiddenError('Only the author may revise this release');
      return db.simulationScenario.create({
        data: {
          tenantId: p.tenantId,
          createdById: p.userId,
          title: old.title,
          description: old.description,
          learningScope: old.learningScope,
          rubric: [],
          experience: json({ ...learningActivitySchema.parse(old.experience), reviewed: false }),
        },
      });
    });
    return reply.code(201).send({ activity: { id: row.id } });
  });
  app.post('/learning/activities/:id/publish', auth, async (request) => {
    const p = request.principal!;
    requireTeacher(p);
    const { id } = params.parse(request.params);
    return withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM simulation_scenarios WHERE id=${id}::uuid FOR UPDATE`;
      const row = await db.simulationScenario.findFirst({ where: { id, createdById: p.userId } });
      if (!row) throw new NotFoundError('Own draft');
      const a = learningActivitySchema.parse(row.experience);
      if (!a.reviewed)
        throw new ValidationError(
          'Confirm source facts, every answer key and each visual target before publication',
        );
      await validateActivitySources(db, p, a);
      if (a.steps.some((s) => !s.sourceRefs.length) || a.targets.some((t) => !t.sourceRefs.length))
        throw new ValidationError('Published tasks and targets need source references');
      const activity = await db.simulationScenario.update({
        where: { id },
        data: { status: 'published', learningScope: 'workspace' },
      });
      await recordAudit(
        {
          action: 'learning.activity_published',
          entityType: 'simulation_scenario',
          entityId: id,
          actorId: p.userId,
          actorLabel: p.fullName,
        },
        db,
      );
      return { activity: { id: activity.id, status: activity.status } };
    });
  });
  app.post('/learning/rooms/:id/recap-draft', auth, async (request, reply) => {
    const p = request.principal!;
    requireTeacher(p);
    const { id } = params.parse(request.params);
    const input = await withTenant(p.tenantId, async (db) => {
      const room = await db.spatialRoom.findFirst({ where: { id, status: 'live' } });
      if (!room) throw new NotFoundError('Live room');
      const state = room.learningState as {
        focus?: { activityId: string };
        questions?: { text: string; resolved: boolean }[];
      } | null;
      const row = state?.focus
        ? await db.simulationScenario.findFirst({
            where: { id: state.focus.activityId, status: 'published', learningScope: 'workspace' },
          })
        : null;
      const activity = learningActivitySchema.safeParse(row?.experience);
      return {
        roomId: id,
        title: room.title,
        material: activity.success
          ? activity.data.blocks
              .map((b) => b.text)
              .join('\n')
              .slice(0, 12000)
          : '',
        questions:
          state?.questions?.map((q) => ({ text: q.text, discussed: q.resolved })).slice(0, 30) ??
          [],
      };
    });
    return reply.code(202).send({ task: await enqueue(p, 'recap', input) });
  });
  app.post('/learning/generate', auth, async (request, reply) => {
    requirePrivateAuthor(request.principal!);
    const p = request.principal!,
      input = parseBody(generation, request.body);
    if (input.scope === 'workspace') requireTeacher(p);
    const sources = await withTenant(p.tenantId, (db) =>
      db.learningSource.count({
        where: { id: { in: input.sourceIds }, ownerId: p.userId, status: 'ready' },
      }),
    );
    if (sources !== new Set(input.sourceIds).size)
      throw new ValidationError('Choose ready sources you own');
    return reply.code(202).send({ task: await enqueue(p, 'generate', input) });
  });
  app.get('/learning/tasks/:id', auth, async (request) => {
    const { id } = params.parse(request.params),
      p = request.principal!;
    const task = await withTenant(p.tenantId, (db) =>
      db.learningTask.findFirst({ where: { id, ownerId: p.userId } }),
    );
    if (!task) throw new NotFoundError('Own learning task');
    return { task };
  });
  app.post('/learning/activities/:id/mentor', auth, async (request) => {
    const p = request.principal!,
      { id } = params.parse(request.params),
      input = parseBody(
        z.object({
          question: z.string().trim().min(2).max(1500),
          targetId: z.string().max(80).optional(),
          runId: uuid.optional(),
        }),
        request.body,
      );
    const context = await withTenant(p.tenantId, async (db) => {
      const row = await readableActivity(db, p, id),
        a = learningActivitySchema.parse(row.experience);
      if (
        await db.experienceRun.findFirst({
          where: { scenarioId: id, learnerId: p.userId, mode: 'assessment', status: 'active' },
        })
      )
        throw new ForbiddenError('Finish the assessment before requesting coaching');
      let history = '';
      if (input.runId) {
        const run = await db.experienceRun.findFirst({
          where: { id: input.runId, scenarioId: id, learnerId: p.userId },
          include: { events: { orderBy: { sequence: 'desc' }, take: 3 } },
        });
        if (!run) throw new NotFoundError('Own learning run');
        if (run.mode === 'assessment')
          throw new ForbiddenError(
            'Contextual hints are available in exploration and guided practice, not assessment',
          );
        history = run.events
          .map((e) => JSON.stringify(e.outcome))
          .join('\n')
          .slice(0, 3000);
      }
      const target = a.targets.find((t) => t.id === input.targetId);
      return {
        title: a.title,
        summary: a.summary,
        narration: [
          ...a.blocks.map((b) => b.text),
          target ? `${target.label}: ${target.explanation}` : '',
          history,
        ]
          .join('\n')
          .slice(0, 15000),
        outline: a.objectives.map((o) => o.label),
      };
    });
    return answerLessonQuestion(context, input.question, env);
  });
  app.get('/learning/classes', auth, async (request) => {
    const p = request.principal!;
    return {
      classes: await withTenant(p.tenantId, (db) =>
        db.learningClass.findMany({
          where: isTeacher(p) ? {} : { members: { some: { userId: p.userId } } },
          include: { _count: { select: { members: true } }, assignments: true },
          orderBy: { createdAt: 'desc' },
        }),
      ).then((rows) => rows.map(({ tokenHash, ...row }) => row)),
    };
  });
  app.post('/learning/classes', auth, async (request, reply) => {
    const p = request.principal!;
    requireTeacher(p);
    const input = parseBody(z.object({ title }), request.body);
    const classroom = await withTenant(p.tenantId, (db) =>
      db.learningClass.create({
        data: { tenantId: p.tenantId, ownerId: p.userId, title: input.title },
      }),
    );
    return reply.code(201).send({ classroom });
  });
  app.post('/learning/classes/:id/invite', auth, async (request) => {
    const p = request.principal!;
    requireTeacher(p);
    const { id } = params.parse(request.params);
    const secret = randomBytes(24).toString('hex');
    const classroom = await withTenant(p.tenantId, async (db) => {
      const row = await db.learningClass.findFirst({ where: { id, ownerId: p.userId } });
      if (!row) throw new NotFoundError('Own class');
      return db.learningClass.update({
        where: { id },
        data: { tokenHash: hash(secret), tokenExpiresAt: new Date(Date.now() + 7 * 86400000) },
      });
    });
    return { code: `${p.tenantId}:${id}:${secret}`, expiresAt: classroom.tokenExpiresAt };
  });
  app.delete('/learning/classes/:id/invite', auth, async (request) => {
    const p = request.principal!;
    requireTeacher(p);
    const { id } = params.parse(request.params);
    const result = await withTenant(p.tenantId, (db) =>
      db.learningClass.updateMany({
        where: { id, ownerId: p.userId },
        data: { tokenHash: null, tokenExpiresAt: null },
      }),
    );
    if (!result.count) throw new NotFoundError('Own class');
    return { revoked: true };
  });
  app.post(
    '/learning/classes/join',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const p = request.principal!,
        input = parseBody(
          z.object({ code: z.string().max(200), password: z.string().max(200).optional() }),
          request.body,
        );
      const parts = input.code.split(':');
      if (
        parts.length !== 3 ||
        !uuid.safeParse(parts[0]).success ||
        !uuid.safeParse(parts[1]).success ||
        !/^[a-f0-9]{48}$/.test(parts[2]!)
      )
        throw new ValidationError('Use the complete class invitation code');
      const actor = await withTenant(p.tenantId, (db) =>
        db.user.findUniqueOrThrow({ where: { id: p.userId } }),
      );
      const [targetTenant, classId, secret] = parts as [string, string, string];
      const joined = await withTenant(targetTenant, async (db) => {
        await db.$queryRaw`SELECT id FROM learning_classes WHERE id=${classId}::uuid FOR UPDATE`;
        const classroom = await db.learningClass.findFirst({ where: { id: classId } });
        if (
          !classroom?.tokenHash ||
          !classroom.tokenExpiresAt ||
          classroom.tokenExpiresAt.getTime() < Date.now() ||
          !timingSafeEqual(
            Buffer.from(classroom.tokenHash, 'hex'),
            Buffer.from(hash(secret), 'hex'),
          )
        )
          throw new NotFoundError('Valid class invitation');
        let member = await db.user.findUnique({
          where: { tenantId_email: { tenantId: targetTenant, email: p.email } },
        });
        if (member && member.id !== actor.id) {
          const linkedGoogle = Boolean(actor.googleId && actor.googleId === member.googleId);
          const sameCredential = Boolean(
            actor.passwordHash && actor.passwordHash === member.passwordHash,
          );
          if (
            !linkedGoogle &&
            !sameCredential &&
            !(
              input.password &&
              member.passwordHash &&
              (await verifyPassword(input.password, member.passwordHash))
            )
          )
            throw new ConflictError(
              'An account already exists in that class workspace. Verify its password to join; matching email alone is insufficient.',
              'CLASS_IDENTITY_PROOF_REQUIRED',
            );
        }
        if (!member) {
          member = await db.user.create({
            data: {
              tenantId: targetTenant,
              email: actor.email,
              fullName: actor.fullName,
              passwordHash: actor.passwordHash,
              googleId: actor.googleId,
              learningProfile: actor.learningProfile ?? {},
              status: 'active',
            },
          });
          const role = await db.role.findUniqueOrThrow({ where: { name: 'Learner' } });
          await db.userRole.create({
            data: { tenantId: targetTenant, userId: member.id, roleId: role.id },
          });
        }
        const profile = (member.learningProfile ?? {}) as Record<string, Prisma.InputJsonValue>;
        const peers = Array.isArray(profile.verifiedLearningPeers)
          ? profile.verifiedLearningPeers
          : [];
        await db.user.update({
          where: { id: member.id },
          data: {
            learningProfile: {
              ...profile,
              verifiedLearningPeers: [...new Set([...peers, actor.id])],
            },
          },
        });
        if (member.status !== 'active') throw new ForbiddenError('This membership is inactive');
        await db.learningClassMember.upsert({
          where: { classId_userId: { classId, userId: member.id } },
          create: { tenantId: targetTenant, classId, userId: member.id },
          update: {},
        });
        await recordAudit(
          {
            action: 'learning.class_joined',
            entityType: 'learning_class',
            entityId: classId,
            actorId: member.id,
            actorLabel: p.fullName,
          },
          db,
        );
        return {
          joined: true,
          tenantId: targetTenant,
          classId,
          title: classroom.title,
          memberId: member.id,
        };
      });
      const profile = (actor.learningProfile ?? {}) as Record<string, Prisma.InputJsonValue>;
      const peers = Array.isArray(profile.verifiedLearningPeers)
        ? profile.verifiedLearningPeers
        : [];
      await withTenant(p.tenantId, (db) =>
        db.user.update({
          where: { id: actor.id },
          data: {
            learningProfile: {
              ...profile,
              verifiedLearningPeers: [...new Set([...peers, joined.memberId])],
            },
          },
        }),
      );
      const { memberId, ...result } = joined;
      return result;
    },
  );
  app.post('/learning/classes/:id/assignments', auth, async (request, reply) => {
    const p = request.principal!;
    requireTeacher(p);
    const { id } = params.parse(request.params);
    const input = parseBody(
      z.object({
        title,
        kind: z.enum(['program', 'activity', 'lesson']),
        releaseId: uuid,
        dueAt: z.string().datetime().optional(),
      }),
      request.body,
    );
    const assignment = await withTenant(p.tenantId, async (db) => {
      if (!(await db.learningClass.findFirst({ where: { id, ownerId: p.userId } })))
        throw new NotFoundError('Own class');
      const valid =
        input.kind === 'program'
          ? await db.course.findFirst({ where: { id: input.releaseId, isPublished: true } })
          : input.kind === 'lesson'
            ? await db.lesson.findFirst({ where: { id: input.releaseId, isPublished: true } })
            : await db.simulationScenario.findFirst({
                where: { id: input.releaseId, status: 'published', learningScope: 'workspace' },
              });
      if (!valid) throw new ValidationError('Assign a published release in this workspace');
      return db.learningAssignment.create({
        data: {
          ...input,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          tenantId: p.tenantId,
          classId: id,
        },
      });
    });
    return reply.code(201).send({ assignment });
  });
  app.get('/learning/overview', auth, async (request) => {
    const p = request.principal!;
    return withTenant(p.tenantId, async (db) => {
      const [assignments, runs, enrollments] = await Promise.all([
        db.learningAssignment.findMany({
          where: { classroom: { members: { some: { userId: p.userId } } } },
          include: { classroom: { select: { title: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        db.experienceRun.findMany({
          where: { learnerId: p.userId },
          include: { scenario: { select: { title: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 30,
        }),
        db.courseEnrollment.findMany({
          where: { learnerId: p.userId },
          include: { course: { select: { id: true, title: true } } },
          orderBy: { enrolledAt: 'desc' },
          take: 30,
        }),
      ]);
      return {
        assignments,
        continue: runs
          .filter(
            (r) => r.status === 'active' && learningActivitySchema.safeParse(r.definition).success,
          )
          .map((r) => ({
            id: r.id,
            activityId: r.scenarioId,
            title: r.scenario.title,
            mode: r.mode,
          })),
        review: runs
          .filter(
            (r) =>
              learningActivitySchema.safeParse(r.definition).success &&
              r.mode === 'assessment' &&
              r.status !== 'active' &&
              ((r.state as any)?.mistakes ?? 0) > 0,
          )
          .slice(0, 5)
          .map((r) => ({
            activityId: r.scenarioId,
            title: r.scenario.title,
            mistakes: (r.state as any).mistakes,
          })),
        achievements: enrollments.filter((e) => e.status === 'completed').map((e) => e.course),
      };
    });
  });
  app.get('/learning/classes/:id/report',auth,async request=>{
    const p=request.principal!;requireTeacher(p);const{id}=params.parse(request.params);
    return withTenant(p.tenantId,async db=>{
      if(!await db.learningClass.findFirst({where:{id,ownerId:p.userId}}))throw new NotFoundError('Own class');
      const members=await db.learningClassMember.findMany({where:{classId:id},include:{user:{select:{id:true,fullName:true}}}});
      const assignments=await db.learningAssignment.findMany({where:{classId:id}});
      const units=await db.learningProgramUnit.findMany({where:{courseId:{in:assignments.filter(a=>a.kind==='program').map(a=>a.releaseId)}}});
      const activityIds=[...assignments.filter(a=>a.kind==='activity').map(a=>a.releaseId),...units.flatMap(u=>u.scenarioId?[u.scenarioId]:[])];
      const lessonIds=[...assignments.filter(a=>a.kind==='lesson').map(a=>a.releaseId),...units.flatMap(u=>u.lessonId?[u.lessonId]:[])];
      const runs=await db.experienceRun.findMany({where:{learnerId:{in:members.map(m=>m.userId)},scenarioId:{in:activityIds},scenario:{learningScope:'workspace',status:'published'}},include:{attempt:{select:{passed:true}},events:{where:{outcome:{path:['correct'],equals:false}},select:{stepId:true}}},orderBy:{updatedAt:'desc'},take:1000});
      const passedLessons=await db.lessonAttempt.findMany({where:{learnerId:{in:members.map(m=>m.userId)},lessonId:{in:lessonIds},passed:true},select:{learnerId:true,lessonId:true}});
      const enrollments=await db.courseEnrollment.findMany({where:{learnerId:{in:members.map(m=>m.userId)},courseId:{in:assignments.filter(a=>a.kind==='program').map(a=>a.releaseId)}}});
      return{assignments,members:members.map(member=>{
        const own=runs.filter(r=>r.learnerId===member.userId);
        const done=(kind:string,releaseId:string,requirement='pass_assessment')=>kind==='lesson'?passedLessons.some(a=>a.learnerId===member.userId&&a.lessonId===releaseId):own.some(r=>r.scenarioId===releaseId&&r.status==='completed'&&(requirement==='complete_practice'||r.mode==='assessment'&&r.attempt?.passed));
        return{id:member.userId,name:member.user.fullName,assignments:assignments.map(a=>({id:a.id,title:a.title,completed:a.kind!=='program'?done(a.kind,a.releaseId):units.some(u=>u.courseId===a.releaseId)?units.filter(u=>u.courseId===a.releaseId).every(u=>done(u.kind,u.lessonId??u.scenarioId!,u.requirement)):enrollments.some(e=>e.learnerId===member.userId&&e.courseId===a.releaseId&&e.status==='completed')})),runs:own.map(run=>{
          const parsed=learningActivitySchema.safeParse(run.definition),missed=new Set(parsed.success?run.events.flatMap(e=>parsed.data.steps.filter(s=>s.id===e.stepId).map(s=>s.objectiveId)):[]);
          return{id:run.id,activityId:run.scenarioId,mode:run.mode,status:run.status,mistakes:(run.state as {mistakes?:number}).mistakes??0,objectives:parsed.success?parsed.data.objectives.filter(o=>missed.has(o.id)):[]};
        })};
      })};
    });
  });
  app.put('/learning/programs/:id/units', auth, async (request) => {
    const p = request.principal!;
    requireTeacher(p);
    const { id } = params.parse(request.params);
    const input = parseBody(
      z.object({
        units: z.array(learningProgramUnitSchema).min(1).max(100),
        outcomes: z.array(z.string().min(3).max(300)).max(20).default([]),
        level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
        estimatedMinutes: z.number().int().min(1).max(10000).default(30),
      }),
      request.body,
    );
    return withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM courses WHERE id=${id}::uuid FOR UPDATE`;
      const course = await db.course.findFirst({ where: { id, createdById: p.userId } });
      if (!course) throw new NotFoundError('Own program');
      if (course.isPublished) throw new ConflictError('Published program units are immutable');
      for (const unit of input.units) {
        const target =
          unit.kind === 'lesson'
            ? await db.lesson.findFirst({ where: { id: unit.releaseId, isPublished: true } })
            : await db.simulationScenario.findFirst({
                where: { id: unit.releaseId, status: 'published', learningScope: 'workspace' },
              });
        if (!target) throw new ValidationError('Every unit must reference a published release');
        if (unit.kind !== 'lesson') {
          const activity = learningActivitySchema.safeParse(
            (target as { experience?: unknown }).experience,
          );
          if (!activity.success)
            throw new ValidationError('Use the existing campus path for version-one experiences');
          if (unit.kind === 'quiz' && activity.data.scene.kind !== 'none')
            throw new ValidationError('Quiz units need a quiz-only activity');
          if (
            unit.requirement === 'pass_assessment' &&
            activity.data.steps.some((s) => s.kind === 'reflection')
          )
            throw new ValidationError(
              'Written reflection is formative. Choose practice completion for this activity.',
            );
        }
      }
      await db.learningProgramUnit.deleteMany({ where: { courseId: id } });
      await db.learningProgramUnit.createMany({
        data: input.units.map((u, i) => ({
          tenantId: p.tenantId,
          courseId: id,
          position: i + 1,
          kind: u.kind,
          requirement: u.requirement,
          lessonId: u.kind === 'lesson' ? u.releaseId : null,
          scenarioId: u.kind !== 'lesson' ? u.releaseId : null,
        })),
      });
      await db.course.update({
        where: { id },
        data: {
          learningMeta: {
            outcomes: input.outcomes,
            level: input.level,
            estimatedMinutes: input.estimatedMinutes,
          },
        },
      });
      return { saved: true };
    });
  });
  app.get('/learning/programs/:id/units', auth, async (request) => {
    const p = request.principal!,
      { id } = params.parse(request.params);
    return withTenant(p.tenantId, async (db) => {
      const course = await db.course.findFirst({
        where: { id, ...(isTeacher(p) ? {} : { isPublished: true }) },
      });
      if (!course) throw new NotFoundError('Program');
      await syncLearningPrograms(db, p.userId);
      return {
        course: {
          id: course.id,
          title: course.title,
          description: course.description,
          isPublished: course.isPublished,
        },
        meta: course.learningMeta,
        units: await unitProgress(db, id, p.userId),
      };
    });
  });
  app.post('/learning/programs', auth, async (request, reply) => {
    const p = request.principal!;
    requireTeacher(p);
    const input = parseBody(
      z.object({ title, description: z.string().min(10).max(4000) }),
      request.body,
    );
    const course = await withTenant(p.tenantId, (db) =>
      db.course.create({
        data: {
          ...input,
          slug: `program-${randomUUID()}`,
          tenantId: p.tenantId,
          createdById: p.userId,
        },
      }),
    );
    return reply.code(201).send({ course: { id: course.id } });
  });
}
