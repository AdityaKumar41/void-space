import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';

let ctx: TestApp;
let creator: string;
let viewer: string;
let otherTenantAdmin: string;
let lessonId: string;
let versionId: string;
let questionIds: string[];

const content = {
  title: 'Analytics measurement fixture',
  summary: 'A short lesson for analytics verification.',
  narration: 'Inspect the approved item. Check it before use.',
  outline: ['Inspect the approved item', 'Check it before use'],
  questions: [
    {
      id: 'inspect',
      prompt: 'What should you inspect?',
      options: ['The approved item', 'An unrelated item'],
      correctOption: 0,
      explanation: 'Inspect the approved item.',
    },
    {
      id: 'when',
      prompt: 'When should you check it?',
      options: ['Before use', 'Never'],
      correctOption: 0,
      explanation: 'Check it before use.',
    },
    {
      id: 'why',
      prompt: 'Why check it?',
      options: ['To confirm it is ready', 'To skip training'],
      correctOption: 0,
      explanation: 'Confirm it is ready.',
    },
  ],
  passingScore: 80,
};

const call = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object, cookie = creator) =>
  ctx.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload }),
  });

beforeAll(async () => {
  ctx = await createTestApp();
  creator = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  viewer = cookieHeader((await login(ctx.app, DEMO.users.auroraViewer)).cookies, 'vs_access');
  otherTenantAdmin = cookieHeader(
    (await login(ctx.app, DEMO.users.northwindAdmin)).cookies,
    'vs_access',
  );
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
  if (!asset?.currentVersion?.ipfsCid) throw new Error('Expected an approved lesson source asset');
  versionId = asset.currentVersion.id;
  const created = await call('POST', '/lessons', {
    assetId: asset.id,
    title: content.title,
  });
  expect(created.statusCode).toBe(201);
  lessonId = created.json().lesson.id;
  const updated = await call('PATCH', `/lessons/${lessonId}`, content);
  expect(updated.statusCode).toBe(200);
  questionIds = content.questions.map((question) => question.id);
  const published = await call('POST', `/lessons/${lessonId}/publish`);
  expect(published.statusCode).toBe(200);
});

afterAll(async () => {
  if (lessonId)
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.lesson.deleteMany({ where: { id: lessonId } }),
    );
  await ctx?.close();
});

describe('Learning analytics', () => {
  it('records bounded foreground time and aggregates assessment performance', async () => {
    const firstHeartbeat = await call(
      'POST',
      `/lessons/${lessonId}/time`,
      { assetVersionId: versionId },
      viewer,
    );
    expect(firstHeartbeat.statusCode).toBe(200);
    const firstProgressSave = await call(
      'PATCH',
      `/lessons/${lessonId}/progress`,
      {
        assetVersionId: versionId,
        revision: 0,
        step: 0,
        assessment: false,
        answers: {},
      },
      viewer,
    );
    expect(firstProgressSave.statusCode).toBe(200);

    const trackedUser = await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.user.findUniqueOrThrow({
        where: {
          tenantId_email: {
            tenantId: DEMO_TENANT_IDS.aurora,
            email: DEMO.users.auroraViewer,
          },
        },
        select: { id: true },
      }),
    );
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.lessonProgress.updateMany({
        where: { lessonId, learnerId: trackedUser.id },
        data: { lastActivityAt: new Date(Date.now() - 20_000) },
      }),
    );
    const heartbeat = await call(
      'POST',
      `/lessons/${lessonId}/time`,
      { assetVersionId: versionId },
      viewer,
    );
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().learningTimeSeconds).toBeGreaterThan(0);
    expect(heartbeat.json().learningTimeSeconds).toBeLessThanOrEqual(45);

    const attempt = await call(
      'POST',
      `/lessons/${lessonId}/attempts`,
      { answers: Object.fromEntries(questionIds.map((id) => [id, 0])) },
      viewer,
    );
    expect(attempt.statusCode).toBe(201);
    expect(attempt.json()).toMatchObject({ score: 100, passed: true, stage: 'Mastery' });

    const response = await call('GET', '/learning/analytics');
    expect(response.statusCode).toBe(200);
    expect(response.json().summary.learnerCount).toBeGreaterThanOrEqual(1);
    expect(response.json().summary.attemptCount).toBeGreaterThanOrEqual(1);
    expect(response.json().summary.averageScore).toEqual(expect.any(Number));
    expect(response.json().summary.credentialCount).toBeGreaterThanOrEqual(1);
    expect(response.json().summary.learningTimeSeconds).toBeGreaterThan(0);
    expect(response.json().summary.lessonCount).toBeGreaterThanOrEqual(1);
    expect(response.json().summary.progressCount).toBeGreaterThanOrEqual(1);
    expect(response.json().summary.averageProgressPercent).toEqual(expect.any(Number));
    expect(response.json().performanceTrend).toHaveLength(30);
    const report = response
      .json()
      .learners.find((learner: { id: string }) => learner.id === trackedUser.id);
    expect(report).toMatchObject({
      name: expect.any(String),
      attemptCount: expect.any(Number),
      averageScore: 100,
      latestStage: 'Mastery',
    });
    expect(report.credentialCount).toBeGreaterThanOrEqual(1);
    expect(report.lessonProgress).toContainEqual(
      expect.objectContaining({
        lessonId,
        progressPercent: 50,
        attemptCount: 1,
        latestScore: 100,
        latestPassed: true,
        latestStage: 'Mastery',
      }),
    );
    expect(
      response.json().skills.find((skill: { lessonId: string }) => skill.lessonId === lessonId),
    ).toMatchObject({
      lessonId,
      attempts: 1,
      averageScore: 100,
      masteryCount: 1,
      averageProgressPercent: 50,
    });

    const learnerReportResponse = await call(
      'GET',
      `/learning/analytics/learners/${trackedUser.id}`,
    );
    expect(learnerReportResponse.statusCode).toBe(200);
    expect(learnerReportResponse.json()).toMatchObject({
      id: trackedUser.id,
      learningTimeSeconds: expect.any(Number),
      lessonProgress: expect.arrayContaining([
        expect.objectContaining({
          lessonId,
          progressPercent: 50,
          learningTimeSeconds: expect.any(Number),
          latestScore: 100,
          latestPassed: true,
        }),
      ]),
      assessmentHistory: [
        expect.objectContaining({
          lessonId,
          lessonTitle: content.title,
          score: 100,
          passed: true,
          stage: 'Mastery',
          completedAt: expect.any(String),
        }),
      ],
    });
    expect(learnerReportResponse.json().learningTimeSeconds).toBeGreaterThan(0);
    expect(
      (
        await call(
          'GET',
          `/learning/analytics/learners/${trackedUser.id}`,
          undefined,
          otherTenantAdmin,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('enforces learning permissions, tenant isolation and explicit AI configuration errors', async () => {
    expect((await call('GET', '/learning/analytics', undefined, viewer)).statusCode).toBe(403);
    const otherTenant = await call('GET', '/learning/analytics', undefined, otherTenantAdmin);
    expect(otherTenant.statusCode).toBe(200);
    expect(otherTenant.json().summary).toMatchObject({
      learnerCount: 0,
      progressCount: 0,
      attemptCount: 0,
      learningTimeSeconds: 0,
    });
    const insights = await call('POST', '/learning/analytics/insights');
    expect(insights.statusCode).toBe(503);
    expect(insights.json().code).toBe('AI_NOT_CONFIGURED');
  });

  it('rejects client-supplied duration and stale lesson versions', async () => {
    expect(
      (
        await call('POST', `/lessons/${lessonId}/time`, {
          assetVersionId: versionId,
          learningTimeSeconds: 1_000_000,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/lessons/${lessonId}/time`, {
          assetVersionId: '00000000-0000-4000-8000-000000000001',
        })
      ).statusCode,
    ).toBe(409);
  });
});
