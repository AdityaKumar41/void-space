import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login } from './helpers';
it('reports current shared lesson activity without exposing private study or retired metrics', async () => {
  const ctx = await createTestApp(),
    tenant = DEMO_TENANT_IDS.aurora;
  const plans: string[] = [];
  let privateRelease = '',
    sharedRelease = '';
  try {
    await withTenant(tenant, async (db) => {
      const author = await db.user.findFirstOrThrow({ where: { email: DEMO.users.auroraCreator } });
      for (const visibility of ['private', 'institution']) {
        const id = randomUUID();
        plans.push(id);
        const definition = { title: `${visibility} analytics QA`, sections: [{ id: 's' }] };
        await db.lessonPlan.create({
          data: { id, tenantId: tenant, ownerId: author.id, title: definition.title, definition },
        });
        const release = await db.lessonPlanRelease.create({
          data: {
            tenantId: tenant,
            ownerId: author.id,
            planId: id,
            revision: 1,
            definition,
            sourceExcerpts: [],
            reviewed: true,
            visibility,
          },
        });
        if (visibility === 'private') privateRelease = release.id;
        else sharedRelease = release.id;
        await db.lessonStudy.create({
          data: {
            tenantId: tenant,
            ownerId: author.id,
            releaseId: release.id,
            state: { completed: ['s'] },
          },
        });
      }
    });
    const cookie = cookieHeader(
      (await login(ctx.app, DEMO.users.auroraAdmin)).cookies,
      'vs_access',
    );
    const response = await ctx.app.inject({ url: '/api/v1/analytics/cohort', headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    const report = response.json();
    expect(report.totals).not.toHaveProperty('courses');
    expect(report.totals).not.toHaveProperty('credentialsIssued');
    expect(
      report.lessons.find((r: { releaseId: string }) => r.releaseId === privateRelease),
    ).toBeUndefined();
    expect(
      report.lessons.find((r: { releaseId: string }) => r.releaseId === sharedRelease),
    ).toMatchObject({ sessions: 1, completedSections: 1 });
  } finally {
    await withTenant(tenant, (db) => db.lessonPlan.deleteMany({ where: { id: { in: plans } } }));
    await ctx.close();
  }
});
