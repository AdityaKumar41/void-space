import { beforeAll, afterAll, it, expect } from 'vitest';
import { withTenant } from '@void-space/db';
import { createTestApp, cookieHeader, login, DEMO, DEMO_TENANT_IDS, type TestApp } from './helpers';
let ctx: TestApp,
  author = '',
  other = '',
  planId = '';
const taskIds: string[] = [];
const call = (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, cookie = author) =>
  ctx.app.inject({
    method,
    url: '/api/v1' + path,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { payload: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  ctx = await createTestApp();
  author = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  other = cookieHeader((await login(ctx.app, DEMO.users.auroraAdmin)).cookies, 'vs_access');
});
afterAll(async () => {
  await withTenant(DEMO_TENANT_IDS.aurora, async (db) => {
    await db.learningTask.deleteMany({ where: { id: { in: taskIds } } });
    if (planId) await db.lessonPlan.deleteMany({ where: { id: planId } });
  });
  await ctx.close();
});
it('keeps annotation generation owner-only, revision-checked and separate from publication', async () => {
  const created = await call('POST', '/learning/lesson-plans/examples/geometry', {});
  expect(created.statusCode, created.body).toBe(201);
  const plan = created.json().plan;
  planId = plan.id;
  const section = plan.definition.sections.find(
    (s: { activity?: { scene: { kind: string } } }) => s.activity?.scene.kind === 'model',
  );
  const input = {
    revision: 0,
    sectionId: section.id,
    instruction: 'Suggest component explanations for this synthetic geometry lesson.',
  };
  expect(
    (await call('POST', `/learning/lesson-plans/${planId}/annotations`, input, other)).statusCode,
  ).toBe(404);
  expect(
    (await call('POST', `/learning/lesson-plans/${planId}/annotations`, { ...input, revision: 99 }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await call('POST', `/learning/lesson-plans/${planId}/annotations`, {
        ...input,
        sectionId: 'missing',
      })
    ).statusCode,
  ).toBe(400);
  const queued = await call('POST', `/learning/lesson-plans/${planId}/annotations`, input);
  expect(queued.statusCode, queued.body).toBe(202);
  taskIds.push(queued.json().task.id);
  expect(queued.json().task.kind).toBe('plan_annotate');
  const def = plan.definition;
  def.sections.find((s: { id: string }) => s.id === section.id).activity.targets[0].placement =
    'unplaced';
  const saved = await call('PATCH', `/learning/lesson-plans/${planId}`, {
    revision: 0,
    definition: def,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const published = await call('POST', `/learning/lesson-plans/${planId}/publish`, {
    revision: saved.json().plan.revision,
    review: { facts: true, answers: true, mappings: true, rights: true },
  });
  expect(published.statusCode, published.body).toBe(400);
  expect(published.body).toContain('Confirm or remove');
  const current = (await call('GET', `/learning/lesson-plans/${planId}`)).json().plan;
  expect(
    current.definition.sections.find((s: { id: string }) => s.id === section.id).activity.targets[0]
      .placement,
  ).toBe('unplaced');
});
