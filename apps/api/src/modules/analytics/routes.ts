/**
 * Cohort analytics grounded in real lesson attempts, enrollments, and credentials.
 */
import { withTenant } from '@void-space/db';
import type { FastifyInstance } from 'fastify';

import { UnauthenticatedError } from '../../lib/errors';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/analytics/cohort',
    { preHandler: app.requirePermission('audit:view') },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new UnauthenticatedError();

      const report = await withTenant(principal.tenantId, async (db) => {
        const [
          lessonsPublished,
          attempts,
          passedAttempts,
          credentials,
          mintedCredentials,
          courses,
          enrollments,
          completedEnrollments,
          fieldRuns,
        ] = await Promise.all([
          db.lesson.count({ where: { tenantId: principal.tenantId, isPublished: true } }),
          db.lessonAttempt.count({ where: { tenantId: principal.tenantId } }),
          db.lessonAttempt.count({ where: { tenantId: principal.tenantId, passed: true } }),
          db.skillCredential.count({ where: { tenantId: principal.tenantId } }),
          db.skillCredential.count({
            where: { tenantId: principal.tenantId, mintStatus: 'minted' },
          }),
          db.course.count({ where: { tenantId: principal.tenantId } }),
          db.courseEnrollment.count({ where: { tenantId: principal.tenantId } }),
          db.courseEnrollment.count({
            where: { tenantId: principal.tenantId, status: 'completed' },
          }),
          db.fieldGuideRun.count({ where: { tenantId: principal.tenantId } }),
        ]);

        const byLesson = await db.lessonAttempt.groupBy({
          by: ['lessonId'],
          where: { tenantId: principal.tenantId },
          _count: { _all: true },
          _avg: { score: true },
        });

        const lessonMeta = await db.lesson.findMany({
          where: {
            tenantId: principal.tenantId,
            id: { in: byLesson.map((row) => row.lessonId) },
          },
          select: { id: true, title: true, isPublished: true },
        });
        const titleById = new Map(lessonMeta.map((row) => [row.id, row]));

        return {
          generatedAt: new Date().toISOString(),
          totals: {
            lessonsPublished,
            attempts,
            passedAttempts,
            passRate: attempts === 0 ? 0 : Math.round((passedAttempts / attempts) * 1000) / 10,
            credentialsIssued: credentials,
            credentialsMintedOnChain: mintedCredentials,
            courses,
            enrollments,
            completedEnrollments,
            fieldGuideRuns: fieldRuns,
          },
          lessons: byLesson.map((row) => ({
            lessonId: row.lessonId,
            title: titleById.get(row.lessonId)?.title ?? 'Unknown lesson',
            published: titleById.get(row.lessonId)?.isPublished ?? false,
            attempts: row._count._all,
            averageScore:
              row._avg.score === null || row._avg.score === undefined
                ? null
                : Math.round(row._avg.score * 10) / 10,
          })),
        };
      });

      return reply.status(200).send(report);
    },
  );
}
