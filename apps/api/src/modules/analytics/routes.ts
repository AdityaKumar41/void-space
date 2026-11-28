/** Aggregate current shared lesson releases. Private learner material never enters this report. */
import { withTenant } from '@void-space/db';
import type { FastifyInstance } from 'fastify';
export async function analyticsRoutes(app: FastifyInstance) {
  app.get(
    '/analytics/cohort',
    { preHandler: app.requirePermission('audit:view') },
    async (request) => {
      const tenantId = request.principal!.tenantId;
      return withTenant(tenantId, async (db) => {
        const rows = await db.$queryRaw<
          { releaseId: string; sessions: bigint; sections: bigint; latest: Date }[]
        >`
        SELECT s.release_id AS "releaseId", count(*) AS sessions,
          sum(CASE WHEN jsonb_typeof(s.state->'completed')='array' THEN jsonb_array_length(s.state->'completed') ELSE 0 END)::bigint AS sections,
          max(s.updated_at) AS latest
        FROM lesson_studies s JOIN lesson_plan_releases r ON r.id=s.release_id
        WHERE s.tenant_id=${tenantId}::uuid AND r.tenant_id=${tenantId}::uuid
          AND r.reviewed=true AND r.visibility IN ('institution','public')
        GROUP BY s.release_id ORDER BY max(s.updated_at) DESC`;
        const [publishedReleases, releases] = await Promise.all([
          db.lessonPlanRelease.count({
            where: { reviewed: true, visibility: { in: ['institution', 'public'] } },
          }),
          db.lessonPlanRelease.findMany({
            where: { id: { in: rows.slice(0, 50).map((r) => r.releaseId) } },
            select: { id: true, definition: true },
          }),
        ]);
        const titles = new Map(
          releases.map((r) => [
            r.id,
            (r.definition as { title?: string }).title ?? 'Shared lesson',
          ]),
        );
        return {
          generatedAt: new Date().toISOString(),
          totals: {
            publishedReleases,
            studySessions: rows.reduce((n, r) => n + Number(r.sessions), 0),
            completedSections: rows.reduce((n, r) => n + Number(r.sections), 0),
          },
          lessons: rows
            .slice(0, 50)
            .map((r) => ({
              releaseId: r.releaseId,
              title: titles.get(r.releaseId) ?? 'Shared lesson',
              sessions: Number(r.sessions),
              completedSections: Number(r.sections),
              lastStudiedAt: r.latest.toISOString(),
            })),
        };
      });
    },
  );
}
