import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';
let context: TestApp;
let cookie: string;
let planId: string;
const body = {
  title: 'Safer maintenance training',
  problem: 'Maintenance teams need repeatable safe practice before entering live environments.',
  customer: 'Industrial safety teams',
  solution: 'Verified XR lessons, simulation and field guidance.',
  nextMilestone: 'Pilot with one maintenance team',
};
beforeAll(async () => {
  context = await createTestApp();
  cookie = cookieHeader((await login(context.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
});
afterAll(async () => {
  if (planId)
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.venturePlan.deleteMany({ where: { id: planId } }),
    );
  await context?.close();
});
describe('Venture Builder', () => {
  it('persists an owned plan and permits its creator to update it', async () => {
    const create = await context.app.inject({
      method: 'POST',
      url: '/api/v1/ventures',
      headers: { cookie },
      payload: body,
    });
    expect(create.statusCode).toBe(201);
    planId = (create.json() as { plan: { id: string } }).plan.id;
    const update = await context.app.inject({
      method: 'PUT',
      url: `/api/v1/ventures/${planId}`,
      headers: { cookie },
      payload: { ...body, nextMilestone: 'Run the safety pilot' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ plan: { nextMilestone: 'Run the safety pilot' } });
  });
});
