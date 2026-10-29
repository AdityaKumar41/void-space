import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenant } from '@void-space/db';

import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';

let context: TestApp;
let cookie: string;
let lessonId: string;
const guideIds: string[] = [];

beforeAll(async () => {
  context = await createTestApp();
  const loginResult = await login(context.app, DEMO.users.auroraCreator);
  cookie = cookieHeader(loginResult.cookies, 'vs_access');
  const asset = await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
    db.asset.findFirst({
      where: { tenantId: DEMO_TENANT_IDS.aurora, status: { in: ['approved', 'published'] } },
      select: { id: true },
    }),
  );
  if (!asset) throw new Error('Expected a seeded approved asset');
  const lesson = await context.app.inject({
    method: 'POST',
    url: '/api/v1/lessons',
    headers: { cookie },
    payload: { assetId: asset.id, title: 'Field guide fixture lesson' },
  });
  lessonId = (lesson.json() as { lesson: { id: string } }).lesson.id;
  await context.app.inject({
    method: 'POST',
    url: `/api/v1/lessons/${lessonId}/publish`,
    headers: { cookie },
  });
});

afterAll(async () => {
  await withTenant(DEMO_TENANT_IDS.aurora, async (db) => {
    if (guideIds.length > 0) {
      await db.fieldGuide.deleteMany({
        where: { id: { in: guideIds }, tenantId: DEMO_TENANT_IDS.aurora },
      });
    }
    if (lessonId) await db.lesson.deleteMany({ where: { id: lessonId } });
  });
  await context?.close();
});

describe('Field IQ packet and completion evidence', () => {
  it('edits a draft with several safety steps and freezes it after publication', async () => {
    const create = await context.app.inject({
      method: 'POST',
      url: '/api/v1/field-guides',
      headers: { cookie },
      payload: {
        title: 'Pump inspection draft',
        description:
          'A multi-step field procedure that makes each inspection and safety note reviewable.',
        lessonId,
        steps: [{ id: 'inspect', instruction: 'Inspect the pump housing.' }],
      },
    });
    const guideId = create.json().guide.id as string;
    guideIds.push(guideId);
    const patch = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/field-guides/${guideId}`,
      headers: { cookie },
      payload: {
        title: 'Pump inspection procedure',
        description:
          'A multi-step field procedure that makes each inspection and safety note reviewable.',
        lessonId,
        steps: [
          {
            id: 'inspect',
            instruction: 'Inspect the pump housing.',
            safetyNote: 'Stop if the guard is damaged.',
          },
          { id: 'record', instruction: 'Record the inspection result.' },
        ],
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().guide.steps).toHaveLength(2);
    expect(
      (
        await context.app.inject({
          method: 'POST',
          url: `/api/v1/field-guides/${guideId}/publish`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/field-guides/${guideId}`,
          headers: { cookie },
          payload: {
            title: 'Changed',
            description:
              'A multi-step field procedure that makes each inspection and safety note reviewable.',
            lessonId,
            steps: [{ id: 'inspect', instruction: 'Inspect the pump housing.' }],
          },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('publishes a guide and refuses a partial completion record', async () => {
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/v1/field-guides',
      headers: { cookie },
      payload: {
        title: 'Lockout field packet',
        description:
          'A guided mobile checklist for safe lockout and verification before servicing.',
        lessonId,
        steps: [
          {
            id: 'isolate',
            instruction: 'Isolate every energy source.',
            safetyNote: 'Wear required PPE.',
          },
          { id: 'verify', instruction: 'Verify zero stored energy.' },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const guideId = (created.json() as { guide: { id: string } }).guide.id;
    guideIds.push(guideId);
    expect(
      (
        await context.app.inject({
          method: 'POST',
          url: `/api/v1/field-guides/${guideId}/publish`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    const partial = await context.app.inject({
      method: 'POST',
      url: `/api/v1/field-guides/${guideId}/runs`,
      headers: { cookie },
      payload: { completedStepIds: ['isolate'], device: 'mobile' },
    });
    expect(partial.statusCode).toBe(400);
    const complete = await context.app.inject({
      method: 'POST',
      url: `/api/v1/field-guides/${guideId}/runs`,
      headers: { cookie },
      payload: { completedStepIds: ['isolate', 'verify'], device: 'ar' },
    });
    expect(complete.statusCode).toBe(201);
    expect(complete.json()).toMatchObject({ run: { device: 'ar' } });
  });
});
