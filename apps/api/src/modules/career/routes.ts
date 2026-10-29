/** Career Compass: derives a portable skill profile from verified evidence only. */
import { withTenant } from '@void-space/db';
import type { FastifyInstance } from 'fastify';

export async function careerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/career/profile', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    return withTenant(principal.tenantId, async (db) => {
      const [credentials, scenarios, fieldRuns] = await Promise.all([
        db.skillCredential.findMany({
          where: { tenantId: principal.tenantId, learnerId: principal.userId },
          include: { attempt: { include: { lesson: { select: { title: true } } } } },
          orderBy: { issuedAt: 'desc' },
        }),
        db.scenarioAttempt.findMany({
          where: { tenantId: principal.tenantId, learnerId: principal.userId, passed: true },
          include: { scenario: { select: { title: true } } },
          orderBy: { completedAt: 'desc' },
        }),
        db.fieldGuideRun.findMany({
          where: { tenantId: principal.tenantId, userId: principal.userId },
          include: { guide: { select: { title: true } } },
          orderBy: { completedAt: 'desc' },
        }),
      ]);
      const seen = new Set<string>();
      const skills = [
        ...credentials.map((credential) => ({
          kind: 'lesson',
          title: credential.attempt.lesson.title,
          verifiedAt: credential.issuedAt.toISOString(),
        })),
        ...scenarios.map((attempt) => ({
          kind: 'simulation',
          title: attempt.scenario.title,
          verifiedAt: attempt.completedAt.toISOString(),
        })),
        ...fieldRuns.map((run) => ({
          kind: 'field',
          title: run.guide.title,
          verifiedAt: run.completedAt.toISOString(),
        })),
      ].filter((skill) => {
        // A skill profile lists each verified outcome once. Repeat passes stay in the
        // assessment record; the newest one is already first.
        const key = `${skill.kind}\0${skill.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const recommendations = [
        ...(skills.some((skill) => skill.kind === 'field')
          ? [{ role: 'Field operations specialist', reason: 'Verified field execution evidence' }]
          : []),
        ...(skills.some((skill) => skill.kind === 'simulation')
          ? [{ role: 'XR safety trainer', reason: 'Passed simulation assessment evidence' }]
          : []),
        ...(skills.some((skill) => skill.kind === 'lesson')
          ? [
              {
                role: 'Digital learning practitioner',
                reason: 'Verified guided learning credentials',
              },
            ]
          : []),
      ];
      return { skills, recommendations, evidenceCount: skills.length };
    });
  });
}
