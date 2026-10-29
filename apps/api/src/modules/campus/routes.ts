/**
 * Virtual Campus: course release, ordered curriculum and evidence-based learner
 * completion.  Course state stays tenant-bound; learner completion can only be
 * inferred from passing LessonAttempt records.
 */
import { recordAudit, withTenant } from '@void-space/db';
import { createCourseSchema } from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';

const paramsSchema = z.object({ id: z.string().uuid() });

function courseView(course: {
  id: string;
  title: string;
  slug: string;
  description: string;
  isPublished: boolean;
  lessons: readonly {
    position: number;
    lesson: { id: string; title: string; summary: string; passingScore: number };
  }[];
}) {
  return {
    id: course.id,
    title: course.title,
    slug: course.slug,
    description: course.description,
    isPublished: course.isPublished,
    lessons: course.lessons.map((link) => ({ position: link.position, ...link.lesson })),
  };
}

export async function campusRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/courses',
    { preHandler: app.requirePermission('learning:manage') },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new ForbiddenError('Authentication required', 'UNAUTHENTICATED');
      const input = parseBody(createCourseSchema, request.body);
      const course = await withTenant(principal.tenantId, async (db) => {
        const lessons = await db.lesson.findMany({
          where: { id: { in: input.lessonIds }, tenantId: principal.tenantId, isPublished: true },
          select: { id: true, title: true, summary: true, passingScore: true },
        });
        if (lessons.length !== input.lessonIds.length) {
          throw new ValidationError('Every course lesson must be published in this workspace', {
            lessonIds: input.lessonIds,
          });
        }
        const created = await db.course.create({
          data: {
            tenantId: principal.tenantId,
            title: input.title,
            slug: input.slug,
            description: input.description,
            createdById: principal.userId,
            lessons: {
              create: input.lessonIds.map((lessonId, index) => ({
                tenantId: principal.tenantId,
                lessonId,
                position: index + 1,
              })),
            },
          },
          include: { lessons: { orderBy: { position: 'asc' }, include: { lesson: true } } },
        });
        await recordAudit(
          {
            action: 'campus.course_created',
            entityType: 'course',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { slug: created.slug, lessonIds: input.lessonIds },
          },
          db,
        );
        return created;
      });
      return reply.status(201).send({ course: courseView(course) });
    },
  );

  app.post(
    '/courses/:id/publish',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const course = await withTenant(principal.tenantId, async (db) => {
        const current = await db.course.findFirst({
          where: { id, tenantId: principal.tenantId },
          include: { lessons: { include: { lesson: { select: { isPublished: true } } } } },
        });
        if (!current) throw new NotFoundError('Course not found');
        if (
          current.lessons.length === 0 ||
          current.lessons.some((link) => !link.lesson.isPublished)
        ) {
          throw new ValidationError(
            'A course can publish only when every ordered lesson is published',
          );
        }
        const updated = await db.course.update({
          where: { id },
          data: { isPublished: true },
          include: { lessons: { orderBy: { position: 'asc' }, include: { lesson: true } } },
        });
        await recordAudit(
          {
            action: 'campus.course_published',
            entityType: 'course',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return updated;
      });
      return { course: courseView(course) };
    },
  );

  app.get('/courses', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const courses = await withTenant(principal.tenantId, (db) =>
      db.course.findMany({
        where: {
          tenantId: principal.tenantId,
          ...(principal.permissions.includes('learning:manage') ? {} : { isPublished: true }),
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          lessons: { orderBy: { position: 'asc' }, include: { lesson: true } },
          enrollments: {
            where: { learnerId: principal.userId },
            select: { status: true, completedAt: true },
          },
        },
      }),
    );
    const attempts = await withTenant(principal.tenantId, (db) =>
      db.lessonAttempt.findMany({
        where: {
          tenantId: principal.tenantId,
          learnerId: principal.userId,
          passed: true,
          lessonId: {
            in: courses.flatMap((course) => course.lessons.map((link) => link.lessonId)),
          },
        },
        select: { lessonId: true },
        distinct: ['lessonId'],
      }),
    );
    const completed = new Set(attempts.map((attempt) => attempt.lessonId));
    return {
      courses: courses.map((course) => ({
        ...courseView(course),
        lessons: courseView(course).lessons.map((lesson) => ({
          ...lesson,
          completed: completed.has(lesson.id),
        })),
        progress: {
          total: course.lessons.length,
          completed: course.lessons.filter((link) => completed.has(link.lessonId)).length,
        },
        enrollment: course.enrollments[0]
          ? {
              status: course.enrollments[0].status,
              completedAt: course.enrollments[0].completedAt?.toISOString() ?? null,
            }
          : null,
      })),
    };
  });

  app.get('/courses/:id', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const { id } = paramsSchema.parse(request.params);
    const course = await withTenant(principal.tenantId, (db) =>
      db.course.findFirst({
        where: { id, tenantId: principal.tenantId, isPublished: true },
        include: { lessons: { orderBy: { position: 'asc' }, include: { lesson: true } } },
      }),
    );
    if (!course) throw new NotFoundError('Course not found');
    const enrollment = await withTenant(principal.tenantId, (db) =>
      db.courseEnrollment.findUnique({
        where: { courseId_learnerId: { courseId: id, learnerId: principal.userId } },
      }),
    );
    return {
      course: courseView(course),
      enrollment: enrollment
        ? {
            status: enrollment.status,
            enrolledAt: enrollment.enrolledAt.toISOString(),
            completedAt: enrollment.completedAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  app.post('/courses/:id/enrollments', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = request.principal!;
    const { id } = paramsSchema.parse(request.params);
    const enrollment = await withTenant(principal.tenantId, async (db) => {
      const course = await db.course.findFirst({
        where: { id, tenantId: principal.tenantId, isPublished: true },
        select: { id: true, lessons: { select: { lessonId: true } } },
      });
      if (!course) throw new NotFoundError('Course not found');
      const passing = await db.lessonAttempt.findMany({
        where: {
          tenantId: principal.tenantId,
          learnerId: principal.userId,
          lessonId: { in: course.lessons.map((link) => link.lessonId) },
          passed: true,
        },
        select: { lessonId: true },
        distinct: ['lessonId'],
      });
      const complete = course.lessons.length > 0 && passing.length === course.lessons.length;
      const previous = await db.courseEnrollment.findUnique({
        where: { courseId_learnerId: { courseId: id, learnerId: principal.userId } },
      });
      const created = await db.courseEnrollment.upsert({
        where: { courseId_learnerId: { courseId: id, learnerId: principal.userId } },
        create: {
          tenantId: principal.tenantId,
          courseId: id,
          learnerId: principal.userId,
          ...(complete ? { status: 'completed', completedAt: new Date() } : {}),
        },
        update:
          complete && previous?.status !== 'completed'
            ? { status: 'completed', completedAt: new Date() }
            : {},
      });
      if (!previous)
        await recordAudit(
          {
            action: 'campus.enrollment_created',
            entityType: 'course_enrollment',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { courseId: id },
          },
          db,
        );
      if (complete && previous?.status !== 'completed')
        await recordAudit(
          {
            action: 'campus.course_completed',
            entityType: 'course_enrollment',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { courseId: id },
          },
          db,
        );
      return created;
    });
    return reply.status(201).send({
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt.toISOString(),
      },
    });
  });
}
