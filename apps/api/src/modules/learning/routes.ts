import { lessonProgressRoutes } from './progress';
/**
 * DAM-native learning loop: approved asset -> authored lesson -> assessment ->
 * portable verified completion.  It intentionally reuses the existing asset
 * approval gate rather than permitting unreviewed material into training.
 */
import { createHash } from 'node:crypto';

import { recordAudit, withTenant } from '@void-space/db';
import {
  createLessonSchema,
  generateQuestionsSchema,
  idParamsSchema,
  lessonQuestionSchema,
  lessonContentSchema,
  mentorQuestionSchema,
  submitLessonAttemptSchema,
} from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';
import { answerLessonQuestion } from './mentor';
import type { ApiEnv } from '../../env';
import {
  generateLessonDraft,
  generateQuestionsFromNotes,
  questionsFromNotes,
} from './generator';
import { TextAiError } from '@void-space/studio-ai/text';

const lessonParamsSchema = z.object({ id: z.string().uuid() });
const deliveryInclude = {
  assetVersion: { select: { id: true, ipfsCid: true, format: true, polycount: true } },
} as const;
const STAGES = ['Awareness', 'Practice', 'Apply', 'Mastery'] as const;

type StoredQuestion = z.infer<typeof lessonQuestionSchema>;

function generatedLesson(asset: {
  name: string;
  category: string;
  description: string | null;
  tags: string[];
}) {
  const subject = asset.name;
  const context =
    asset.description ?? `${subject} is a reviewed ${asset.category.toLowerCase()} asset.`;
  const options = [
    `Inspect the approved ${asset.category.toLowerCase()} asset and its safety context`,
    'Skip review and use an unverified substitute',
    'Publish the asset without checking its instructions',
    'Treat metadata as optional during delivery',
  ];
  const questions: StoredQuestion[] = [
    {
      id: 'purpose',
      prompt: `What is the correct first step before using ${subject}?`,
      options,
      correctOption: 0,
      explanation: 'Training starts with the approved asset and its documented context.',
    },
    {
      id: 'provenance',
      prompt: `Why should a learner use the approved ${subject} version?`,
      options: [
        'It has reviewed provenance and metadata',
        'It is always the smallest file',
        'It bypasses assessment',
        'It needs no licence',
      ],
      correctOption: 0,
      explanation:
        'Approved versions carry the review trail and provenance needed for accountable training.',
    },
    {
      id: 'delivery',
      prompt: 'Which behaviour keeps an XR learning session accountable?',
      options: [
        'Complete the guided steps and submit the assessment',
        'Share answers before starting',
        'Ignore the lesson context',
        'Replace the approved asset mid-session',
      ],
      correctOption: 0,
      explanation:
        'A recorded assessment is the evidence that the learner completed the guided activity.',
    },
  ];
  return {
    title: `${subject}: guided lesson`,
    summary: context.slice(0, 2000),
    narration: `Welcome to ${subject}. ${context} First, orient yourself to the approved asset and its intended use. Next, practise the key checks in a safe environment. Finally, complete the short assessment to verify your understanding.`,
    outline: [
      'Orient to the approved asset',
      'Inspect context and safe use',
      'Practise the guided workflow',
      'Verify understanding',
    ],
    questions,
  };
}

function subjectDraft(title: string, source: string) {
  const notes = source.replace(/\s+/g, ' ').trim();
  const sentences = source
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);
  const outline = (sentences.length > 0 ? sentences : [notes]).slice(0, 6).map((line) => line.slice(0, 1000));
  const recalled = (outline[0] ?? notes).slice(0, 280);
  return {
    title: title.slice(0, 200),
    summary: notes.slice(0, 2000),
    narration: source.trim().slice(0, 8000),
    outline,
    questions: [
      {
        id: 'recall',
        prompt: 'Which statement comes from this lesson?',
        options: [recalled, 'A claim that does not appear in the lesson notes'],
        correctOption: 0,
        explanation:
          'This checks that the question stays inside the notes. Replace it with a harder question before you publish.',
      },
    ],
  };
}

function safeLesson(lesson: {
  id: string;
  assetId: string | null;
  title: string;
  summary: string;
  narration: string;
  outline: unknown;
  questions: unknown;
  passingScore: number;
  isPublished: boolean;
  assetVersion?: {
    id: string;
    ipfsCid: string | null;
    format: string;
    polycount: number | null;
  } | null;
}) {
  const questions = z
    .array(lessonQuestionSchema)
    .parse(lesson.questions)
    .map(({ correctOption: _answer, explanation: _explanation, ...question }) => question);
  // Explicit projection: database author ids, source paths and answer keys never enter delivery.
  return {
    id: lesson.id,
    assetId: lesson.assetId,
    title: lesson.title,
    summary: lesson.summary,
    narration: lesson.narration,
    outline: z.array(z.string()).parse(lesson.outline),
    questions,
    passingScore: lesson.passingScore,
    isPublished: lesson.isPublished,
    media: lesson.assetVersion
      ? {
          versionId: lesson.assetVersion.id,
          cid: lesson.assetVersion.ipfsCid,
          format: lesson.assetVersion.format,
          polycount: lesson.assetVersion.polycount,
        }
      : null,
  };
}

export async function learningRoutes(
  app: FastifyInstance,
  options: { env: ApiEnv },
): Promise<void> {
  await lessonProgressRoutes(app);
  app.post(
    '/lessons',
    { preHandler: app.requirePermission('learning:manage') },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new ForbiddenError('Authentication required', 'UNAUTHENTICATED');
      const input = parseBody(createLessonSchema, request.body);
      // The model call must not hold a database transaction open.
      const asset = input.assetId
        ? await withTenant(principal.tenantId, (db) =>
            db.asset.findFirst({
              where: {
                id: input.assetId,
                tenantId: principal.tenantId,
                status: { in: ['approved', 'published'] },
              },
              include: { currentVersion: { select: { id: true } } },
            }),
          )
        : null;
      if (input.assetId && !asset?.currentVersion)
        throw new ValidationError('The selected model must be approved and have a current version');
      const versionId = asset?.currentVersion?.id ?? null;
      const subject = {
        name: asset?.name ?? input.title ?? 'Lesson',
        category: asset?.category ?? 'Subject',
        description: asset?.description ?? input.sourceText ?? null,
        tags: asset?.tags ?? [],
      };
      let generated = asset
        ? generatedLesson(subject)
        : subjectDraft(input.title ?? 'Lesson', input.sourceText ?? '');
      let generation: {
        mode: 'ai' | 'template';
        provider?: string;
        model?: string;
        reason?: string;
      } = {
        mode: 'template',
        reason: input.sourceText
          ? 'Your notes are in the lesson. Add questions yourself, or use Write questions with AI.'
          : 'This draft is a starting point. Replace it with the subject material before publishing.',
      };
      if (input.generateWithAi) {
        try {
          const result = await generateLessonDraft(subject, input.sourceText, options.env);
          generated = result.content;
          generation = result.generation;
        } catch {
          if (input.sourceText && input.title) generated = subjectDraft(input.title, input.sourceText);
          generation = {
            mode: 'template',
            reason:
              'The model did not return a usable draft. The notes are in the lesson so you can write the quiz yourself.',
          };
        }
      }
      const lesson = await withTenant(principal.tenantId, async (db) => {
        if (asset && versionId) {
          const current = await db.asset.findFirst({
            where: {
              id: asset.id,
              tenantId: principal.tenantId,
              status: { in: ['approved', 'published'] },
              currentVersionId: versionId,
            },
            select: { id: true },
          });
          if (!current)
            throw new ConflictError(
              'The approved asset changed during generation. Start a new draft from the reviewed version.',
            );
        }
        const created = await db.lesson.create({
          data: {
            tenantId: principal.tenantId,
            assetId: asset?.id ?? null,
            assetVersionId: versionId,
            createdById: principal.userId,
            title: input.title ?? generated.title,
            summary: generated.summary,
            narration: generated.narration,
            outline: generated.outline,
            questions: generated.questions,
            passingScore: input.passingScore,
          },
        });
        await recordAudit(
          {
            action: 'learning.lesson_created',
            entityType: 'lesson',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: {
              assetId: asset?.id ?? null,
              generation,
              sourceProvided: Boolean(input.sourceText),
              sourceSha256: input.sourceText
                ? createHash('sha256').update(input.sourceText).digest('hex')
                : null,
            },
          },
          db,
        );
        return created;
      });
      return reply.status(201).send({ lesson: safeLesson(lesson), generation });
    },
  );

  app.get('/lessons', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const includeDrafts =
      z.object({ includeDrafts: z.enum(['true', 'false']).optional() }).parse(request.query)
        .includeDrafts === 'true';
    const mayManage = principal.permissions.includes('learning:manage');
    const lessons = await withTenant(principal.tenantId, (db) =>
      db.lesson.findMany({
        where: {
          tenantId: principal.tenantId,
          ...(!(includeDrafts && mayManage) ? { isPublished: true } : {}),
        },
        include: deliveryInclude,
        orderBy: { updatedAt: 'desc' },
      }),
    );
    return { lessons: lessons.map(safeLesson) };
  });

  app.get('/lessons/:id', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const { id } = lessonParamsSchema.parse(request.params);
    const lesson = await withTenant(principal.tenantId, (db) =>
      db.lesson.findFirst({
        where: { id, tenantId: principal.tenantId, isPublished: true },
        include: deliveryInclude,
      }),
    );
    if (!lesson) throw new NotFoundError('Lesson not found');
    return { lesson: safeLesson(lesson) };
  });

  app.get(
    '/lessons/assets',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const assets = await withTenant(request.principal!.tenantId, (db) =>
        db.asset.findMany({
          where: {
            tenantId: request.principal!.tenantId,
            status: { in: ['approved', 'published'] },
            currentVersionId: { not: null },
          },
          select: {
            id: true,
            name: true,
            category: true,
            currentVersion: { select: { id: true, ipfsCid: true, format: true, polycount: true } },
          },
          orderBy: { name: 'asc' },
          take: 200,
        }),
      );
      return {
        assets: assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          category: asset.category,
          media: asset.currentVersion
            ? {
                versionId: asset.currentVersion.id,
                cid: asset.currentVersion.ipfsCid,
                format: asset.currentVersion.format,
                polycount: asset.currentVersion.polycount,
              }
            : null,
        })),
      };
    },
  );

  app.post(
    '/lessons/questions',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const input = parseBody(generateQuestionsSchema, request.body);
      try {
        return await generateQuestionsFromNotes(input, options.env);
      } catch (error) {
        const questions = questionsFromNotes(input.notes);
        return {
          questions,
          generation: {
            mode: 'notes' as const,
            reason:
              error instanceof TextAiError
                ? 'The lesson model is not answering. These questions were built from the notes.'
                : 'The model reply could not be used. These questions were built from the notes.',
          },
        };
      }
    },
  );

  app.get(
    '/lessons/:id/author',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const { id } = lessonParamsSchema.parse(request.params);
      const lesson = await withTenant(request.principal!.tenantId, (db) =>
        db.lesson.findFirst({
          where: { id, tenantId: request.principal!.tenantId },
          include: deliveryInclude,
        }),
      );
      if (!lesson) throw new NotFoundError('Lesson');
      return {
        lesson: {
          ...safeLesson(lesson),
          questions: z.array(lessonQuestionSchema).parse(lesson.questions),
        },
      };
    },
  );

  app.patch(
    '/lessons/:id',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = lessonParamsSchema.parse(request.params);
      const content = parseBody(lessonContentSchema, request.body);
      const lesson = await withTenant(principal.tenantId, async (db) => {
        const existing = await db.lesson.findFirst({ where: { id, tenantId: principal.tenantId } });
        if (!existing) throw new NotFoundError('Lesson');
        const updated = await db.lesson.updateMany({
          where: { id, tenantId: principal.tenantId, isPublished: false },
          data: content,
        });
        if (!updated.count)
          throw new ConflictError(
            'Published lessons are immutable. Create a new draft to revise the assessment.',
          );
        await recordAudit(
          {
            action: 'learning.lesson_updated',
            entityType: 'lesson',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return db.lesson.findUniqueOrThrow({ where: { id }, include: deliveryInclude });
      });
      return { lesson: safeLesson(lesson) };
    },
  );

  app.post(
    '/lessons/:id/publish',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = lessonParamsSchema.parse(request.params);
      const lesson = await withTenant(principal.tenantId, async (db) => {
        const candidate = await db.lesson.findFirst({
          where: { id, tenantId: principal.tenantId },
          include: { asset: true },
        });
        if (!candidate) throw new NotFoundError('Lesson');
        parseBody(lessonContentSchema, candidate);
        if (candidate.assetId || candidate.assetVersionId) {
          if (
            !candidate.asset ||
            !['approved', 'published'].includes(candidate.asset.status) ||
            candidate.asset.currentVersionId !== candidate.assetVersionId
          )
            throw new ConflictError(
              'The lesson must reference the current approved model before release.',
            );
        }
        const updated = await db.lesson.updateMany({
          where: { id, tenantId: principal.tenantId },
          data: { isPublished: true },
        });
        if (updated.count === 0) throw new NotFoundError('Lesson not found');
        await recordAudit(
          {
            action: 'learning.lesson_published',
            entityType: 'lesson',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return db.lesson.findUniqueOrThrow({ where: { id } });
      });
      return { lesson: safeLesson(lesson) };
    },
  );

  app.post(
    '/lessons/:id/revise',
    { preHandler: app.requirePermission('learning:manage') },
    async (request, reply) => {
      const principal = request.principal!;
      const { id } = lessonParamsSchema.parse(request.params);
      const lesson = await withTenant(principal.tenantId, async (db) => {
        const existing = await db.lesson.findFirst({
          where: { id, tenantId: principal.tenantId },
        });
        if (!existing) throw new NotFoundError('Lesson');
        const created = await db.lesson.create({
          data: {
            tenantId: principal.tenantId,
            assetId: existing.assetId,
            assetVersionId: existing.assetVersionId,
            createdById: principal.userId,
            title: existing.title,
            summary: existing.summary,
            narration: existing.narration,
            outline: existing.outline ?? [],
            questions: existing.questions ?? [],
            passingScore: existing.passingScore,
            isPublished: false,
          },
        });
        await recordAudit(
          {
            action: 'learning.lesson_created',
            entityType: 'lesson',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { revisedFrom: existing.id },
          },
          db,
        );
        return created;
      });
      return reply.status(201).send({ lesson: { id: lesson.id } });
    },
  );

  app.post('/lessons/:id/attempts', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = request.principal!;
    const { id } = lessonParamsSchema.parse(request.params);
    const input = parseBody(submitLessonAttemptSchema, request.body);
    const result = await withTenant(principal.tenantId, async (db) => {
      const lesson = await db.lesson.findFirst({
        where: { id, tenantId: principal.tenantId, isPublished: true },
      });
      if (!lesson) throw new NotFoundError('Lesson not found');
      const questions = z.array(lessonQuestionSchema).parse(lesson.questions);
      const correct = questions.filter(
        (question) => input.answers[question.id] === question.correctOption,
      ).length;
      const score = Math.round((correct / questions.length) * 100);
      const passed = score >= lesson.passingScore;
      const stage = STAGES[Math.min(STAGES.length - 1, Math.floor((score / 100) * STAGES.length))]!;
      const attempt = await db.lessonAttempt.create({
        data: {
          tenantId: principal.tenantId,
          lessonId: id,
          learnerId: principal.userId,
          answers: input.answers,
          score,
          passed,
          stage,
        },
      });
      await recordAudit(
        {
          action: 'learning.assessment_completed',
          entityType: 'lesson_attempt',
          entityId: attempt.id,
          actorId: principal.userId,
          actorLabel: principal.fullName,
          afterState: { lessonId: id, score, passed, stage },
        },
        db,
      );
      let credential = null;
      if (passed) {
        const verificationHash = createHash('sha256')
          .update(`${principal.tenantId}:${attempt.id}:${id}:${score}`)
          .digest('hex');
        credential = await db.skillCredential.create({
          data: {
            tenantId: principal.tenantId,
            attemptId: attempt.id,
            learnerId: principal.userId,
            verificationHash,
          },
        });
        await recordAudit(
          {
            action: 'learning.credential_issued',
            entityType: 'skill_credential',
            entityId: credential.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { attemptId: attempt.id, verificationHash },
          },
          db,
        );
      }
      // A course completion is evidence-derived: completing one lesson may
      // unlock it, but only when this learner has a passing attempt for every
      // ordered course lesson. This keeps compliance reports trustworthy even
      // when a caller retries or submits requests out of order.
      const affectedEnrollments = await db.courseEnrollment.findMany({
        where: {
          tenantId: principal.tenantId,
          learnerId: principal.userId,
          status: 'active',
          course: { lessons: { some: { lessonId: id } } },
        },
        include: { course: { include: { lessons: { select: { lessonId: true } } } } },
      });
      const completedCourses: string[] = [];
      for (const enrollment of affectedEnrollments) {
        const lessonIds = enrollment.course.lessons.map((link) => link.lessonId);
        const passingAttempts = await db.lessonAttempt.findMany({
          where: {
            tenantId: principal.tenantId,
            learnerId: principal.userId,
            lessonId: { in: lessonIds },
            passed: true,
          },
          select: { lessonId: true },
        });
        if (new Set(passingAttempts.map((entry) => entry.lessonId)).size !== lessonIds.length)
          continue;
        await db.courseEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'completed', completedAt: new Date() },
        });
        completedCourses.push(enrollment.courseId);
        await recordAudit(
          {
            action: 'campus.course_completed',
            entityType: 'course_enrollment',
            entityId: enrollment.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { courseId: enrollment.courseId, evidenceLessonIds: lessonIds },
          },
          db,
        );
      }
      const review = questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        correct: input.answers[question.id] === question.correctOption,
        yourAnswer: question.options[input.answers[question.id] ?? -1] ?? '',
        rightAnswer: question.options[question.correctOption] ?? '',
        explanation: question.explanation,
      }));
      return { attempt, credential, correct, completedCourses, review };
    });
    return reply.status(201).send({
      score: result.attempt.score,
      passed: result.attempt.passed,
      stage: result.attempt.stage,
      correctAnswers: result.correct,
      review: result.review,
      credential: result.credential
        ? {
            id: result.credential.id,
            verificationCode: result.credential.verificationHash,
            issuedAt: result.credential.issuedAt.toISOString(),
          }
        : null,
      completedCourseIds: result.completedCourses,
    });
  });

  app.post('/lessons/:id/mentor', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const { id } = lessonParamsSchema.parse(request.params);
    const { question } = parseBody(mentorQuestionSchema, request.body);
    const lesson = await withTenant(principal.tenantId, (db) =>
      db.lesson.findFirst({ where: { id, tenantId: principal.tenantId, isPublished: true } }),
    );
    if (!lesson) throw new NotFoundError('Lesson not found');
    return answerLessonQuestion(
      {
        title: lesson.title,
        summary: lesson.summary,
        narration: lesson.narration,
        outline: z.array(z.string()).parse(lesson.outline),
      },
      question,
      options.env,
    );
  });

  app.get('/credentials/:id', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const { id } = idParamsSchema.parse(request.params);
    const credential = await withTenant(principal.tenantId, (db) =>
      db.skillCredential.findFirst({
        where: { id, tenantId: principal.tenantId, learnerId: principal.userId },
        include: { attempt: { include: { lesson: true } } },
      }),
    );
    if (!credential) throw new NotFoundError('Credential not found');
    return {
      credential: {
        id: credential.id,
        verificationCode: credential.verificationHash,
        issuedAt: credential.issuedAt.toISOString(),
        score: credential.attempt.score,
        stage: credential.attempt.stage,
        lessonTitle: credential.attempt.lesson.title,
      },
    };
  });
}
