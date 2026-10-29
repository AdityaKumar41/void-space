/**
 * Simulator assessment HTTP contract. This proves that a learner cannot choose
 * a score: only criterion evidence crosses the client boundary and the server
 * derives the weighted result from the released scenario rubric.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenant } from '@void-space/db';

import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';

let context: TestApp;
let cookie: string;
let assetId: string;
let lessonId: string;
let scenarioId: string;

beforeAll(async () => {
  context = await createTestApp();
  const creator = await login(context.app, DEMO.users.auroraCreator);
  cookie = cookieHeader(creator.cookies, 'vs_access');
  const asset = await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
    db.asset.findFirst({
      where: { tenantId: DEMO_TENANT_IDS.aurora, status: { in: ['approved', 'published'] } },
      select: { id: true },
    }),
  );
  if (!asset) throw new Error('Expected a seeded approved asset');
  assetId = asset.id;
});

afterAll(async () => {
  if (lessonId) {
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.lesson.deleteMany({ where: { id: lessonId, tenantId: DEMO_TENANT_IDS.aurora } }),
    );
  }
  await context?.close();
});

describe('Genesis Simulator assessment loop', () => {
  it('creates, publishes and grades a scenario from server-owned rubric evidence', async () => {
    const lesson = await context.app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie },
      payload: { assetId, title: 'Simulator fixture lesson' },
    });
    expect(lesson.statusCode).toBe(201);
    lessonId = (lesson.json() as { lesson: { id: string } }).lesson.id;

    const publishedLesson = await context.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/publish`,
      headers: { cookie },
    });
    expect(publishedLesson.statusCode).toBe(200);

    const create = await context.app.inject({
      method: 'POST',
      url: '/api/v1/simulations',
      headers: { cookie },
      payload: {
        title: 'Energy isolation practice',
        description:
          'Isolate all energy sources and prove the equipment has no remaining stored energy.',
        lessonId,
        rubric: [
          { id: 'isolate', label: 'Isolate all energy sources', weight: 40 },
          { id: 'verify', label: 'Verify zero stored energy', weight: 60 },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    scenarioId = (create.json() as { scenario: { id: string } }).scenario.id;

    const release = await context.app.inject({
      method: 'POST',
      url: `/api/v1/simulations/${scenarioId}/publish`,
      headers: { cookie },
    });
    expect(release.statusCode).toBe(200);

    const partial = await context.app.inject({
      method: 'POST',
      url: `/api/v1/simulations/${scenarioId}/attempts`,
      headers: { cookie },
      // A fabricated `score` is deliberately not a valid request field and is
      // ignored; the stored 40-point evidence determines the actual result.
      payload: { evidence: { isolate: true, verify: false }, score: 100 },
    });
    expect(partial.statusCode).toBe(201);
    expect(partial.json()).toMatchObject({ attempt: { score: 40, passed: false } });

    const complete = await context.app.inject({
      method: 'POST',
      url: `/api/v1/simulations/${scenarioId}/attempts`,
      headers: { cookie },
      payload: { evidence: { isolate: true, verify: true } },
    });
    expect(complete.statusCode).toBe(201);
    expect(complete.json()).toMatchObject({ attempt: { score: 100, passed: true } });
  });
});
