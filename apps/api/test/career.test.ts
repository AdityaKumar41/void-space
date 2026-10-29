import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';

let context: TestApp;
let cookie: string;
let lessonId: string;

beforeAll(async () => {
  context = await createTestApp();
  const session = await login(context.app, DEMO.users.auroraCreator);
  cookie = cookieHeader(session.cookies, 'vs_access');
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
    payload: { assetId: asset.id, title: 'Career evidence fixture' },
  });
  lessonId = (lesson.json() as { lesson: { id: string } }).lesson.id;
  await context.app.inject({
    method: 'POST',
    url: `/api/v1/lessons/${lessonId}/publish`,
    headers: { cookie },
  });
  const detail = await context.app.inject({
    method: 'GET',
    url: `/api/v1/lessons/${lessonId}`,
    headers: { cookie },
  });
  const questions = (
    detail.json() as { lesson: { questions: { id: string; options: string[] }[] } }
  ).lesson.questions;
  // Generated fixture lessons always use the approved first option; the server
  // computes the score and resulting credential.
  await context.app.inject({
    method: 'POST',
    url: `/api/v1/lessons/${lessonId}/attempts`,
    headers: { cookie },
    payload: { answers: Object.fromEntries(questions.map((question) => [question.id, 0])) },
  });
});
afterAll(async () => {
  if (lessonId)
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.lesson.deleteMany({ where: { id: lessonId } }),
    );
  await context?.close();
});

describe('Career Compass', () => {
  it('derives role paths only from the caller’s verified tenant evidence', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/career/profile',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      skills: expect.arrayContaining([
        expect.objectContaining({ kind: 'lesson', title: 'Career evidence fixture' }),
      ]),
      recommendations: expect.arrayContaining([
        expect.objectContaining({ role: 'Digital learning practitioner' }),
      ]),
    });
  });
});
