import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { withTenant } from '@void-space/db';
import { createTestApp, login, cookieHeader, DEMO, DEMO_TENANT_IDS, type TestApp } from './helpers';
let ctx: TestApp;
let author: string;
let viewer: string;
let other: string;
let lessonId: string;
let versionId: string;
let draftId: string;
let questionId: string;
const call = (method: 'GET' | 'PATCH', id: string, body?: object, cookie = viewer) =>
  ctx.app.inject({
    method,
    url: `/api/v1/lessons/${id}/progress`,
    headers: { cookie },
    ...(body ? { payload: body } : {}),
  });
beforeAll(async () => {
  ctx = await createTestApp();
  author = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  viewer = cookieHeader((await login(ctx.app, DEMO.users.auroraViewer)).cookies, 'vs_access');
  other = cookieHeader((await login(ctx.app, DEMO.users.northwindAdmin)).cookies, 'vs_access');
  const asset = await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
    db.asset.findFirst({
      where: {
        tenantId: DEMO_TENANT_IDS.aurora,
        status: { in: ['approved', 'published'] },
        currentVersion: { isNot: null },
      },
      include: { currentVersion: true },
    }),
  );
  if (!asset?.currentVersion?.ipfsCid) throw new Error('Expected a pinned reviewed source asset');
  const make = async () => {
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: author },
      payload: { assetId: asset.id, title: 'Saved lesson progress fixture' },
    });
    expect(r.statusCode).toBe(201);
    return r.json().lesson;
  };
  const lesson = await make();
  lessonId = lesson.id;
  versionId = asset.currentVersion.id;
  questionId = lesson.questions[0].id;
  draftId = (await make()).id;
  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/lessons/${lessonId}/publish`,
    headers: { cookie: author },
  });
});
afterAll(async () => {
  await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
    db.lesson.deleteMany({ where: { id: { in: [lessonId, draftId].filter(Boolean) } } }),
  );
  await ctx?.close();
});
describe('Version-bound lesson progress', () => {
  it('resumes reading and draft answers independently from assessment evidence', async () => {
    expect((await call('GET', lessonId)).json().progress).toBeNull();
    const payload = {
      assetVersionId: versionId,
      revision: 0,
      step: 1,
      assessment: true,
      answers: { [questionId]: 0 },
    };
    const [a, b] = await Promise.all([
      call('PATCH', lessonId, payload),
      call('PATCH', lessonId, payload),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect((await call('GET', lessonId)).json().progress).toMatchObject({
      step: 1,
      assessment: true,
      answers: { [questionId]: 0 },
      revision: 1,
    });
    expect(
      await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
        db.lessonAttempt.count({ where: { lessonId } }),
      ),
    ).toBe(0);
  });
  it('isolates learner state and refuses drafts, stale versions and invented answer keys', async () => {
    expect((await call('GET', lessonId, undefined, author)).json().progress).toBeNull();
    expect((await call('GET', lessonId, undefined, other)).statusCode).toBe(404);
    expect((await call('GET', draftId)).statusCode).toBe(404);
    const payload = {
      assetVersionId: versionId,
      revision: 1,
      step: 0,
      assessment: false,
      answers: {},
    };
    expect((await call('PATCH', lessonId, { ...payload, step: 99 })).statusCode).toBe(400);
    expect(
      (await call('PATCH', lessonId, { ...payload, answers: { invented: 1 } })).statusCode,
    ).toBe(400);
    expect(
      (
        await call('PATCH', lessonId, {
          ...payload,
          assetVersionId: '00000000-0000-4000-8000-000000000001',
        })
      ).statusCode,
    ).toBe(409);
    expect((await call('PATCH', lessonId, { ...payload, score: 100 })).statusCode).toBe(400);
  });
});
