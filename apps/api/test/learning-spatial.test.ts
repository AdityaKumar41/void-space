import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';

let ctx: TestApp;
let author: string;
let viewer: string;
let other: string;
let assetId: string;
let lessonId: string;
let roomId: string;
let courseId: string;
const content = {
  title: 'Reviewed equipment inspection',
  summary: 'Identify and inspect the equipment before use.',
  narration: 'Locate the housing. Inspect the housing for visible damage before use.',
  outline: ['Locate the housing', 'Inspect for visible damage'],
  questions: [
    {
      id: 'inspect',
      prompt: 'What must be checked?',
      options: ['The packaging', 'The housing'],
      correctOption: 1,
      explanation: 'Inspect the housing for visible damage.',
    },
    {
      id: 'when',
      prompt: 'When should you inspect?',
      options: ['Before use', 'Never'],
      correctOption: 0,
      explanation: 'Inspect before use.',
    },
    {
      id: 'damage',
      prompt: 'What should you look for?',
      options: ['Colour', 'Price', 'Visible damage'],
      correctOption: 2,
      explanation: 'Look for visible damage.',
    },
  ],
  passingScore: 80,
};
beforeAll(async () => {
  ctx = await createTestApp();
  author = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  viewer = cookieHeader((await login(ctx.app, DEMO.users.auroraViewer)).cookies, 'vs_access');
  other = cookieHeader((await login(ctx.app, DEMO.users.northwindAdmin)).cookies, 'vs_access');
  const asset = await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
    db.asset.findFirst({
      where: { status: { in: ['approved', 'published'] } },
      select: { id: true },
    }),
  );
  if (!asset) throw new Error('Seed an approved asset first');
  assetId = asset.id;
});
afterAll(async () => {
  await withTenant(DEMO_TENANT_IDS.aurora, async (db) => {
    if (roomId) await db.spatialRoom.deleteMany({ where: { id: roomId } });
    if (courseId) await db.course.deleteMany({ where: { id: courseId } });
    if (lessonId) await db.lesson.deleteMany({ where: { id: lessonId } });
  });
  await ctx?.close();
});
const call = (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  payload?: Record<string, unknown>,
  cookie = author,
) =>
  ctx.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload }),
  });

describe('Reviewed spatial lesson delivery', () => {
  it('keeps a generated draft recoverable for authors and private from learners', async () => {
    const created = await call('POST', '/lessons', { assetId });
    expect(created.statusCode).toBe(201);
    lessonId = created.json().lesson.id;
    const drafts = await call('GET', '/lessons?includeDrafts=true');
    expect(drafts.json().lessons.some((l: { id: string }) => l.id === lessonId)).toBe(true);
    expect((await call('GET', `/lessons/${lessonId}/author`)).statusCode).toBe(200);
    expect((await call('GET', `/lessons/${lessonId}/author`, undefined, viewer)).statusCode).toBe(
      403,
    );
    expect((await call('GET', `/lessons/${lessonId}`, undefined, viewer)).statusCode).toBe(404);
    expect((await call('GET', `/lessons/${lessonId}/author`, undefined, other)).statusCode).toBe(
      404,
    );
  });
  it('validates real authored assessments, publishes explicitly and freezes released content', async () => {
    expect(
      (
        await call('PATCH', `/lessons/${lessonId}`, {
          ...content,
          questions: [{ ...content.questions[0], correctOption: 5 }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await call('PATCH', `/lessons/${lessonId}`, content)).statusCode).toBe(200);
    expect((await call('POST', `/lessons/${lessonId}/publish`)).statusCode).toBe(200);
    expect((await call('PATCH', `/lessons/${lessonId}`, content)).statusCode).toBe(409);
    const lesson = (await call('GET', `/lessons/${lessonId}`, undefined, viewer)).json().lesson;
    expect(lesson.media.versionId).toBeTruthy();
    expect(lesson.questions[0]).not.toHaveProperty('correctOption');
    expect(lesson.questions[0]).not.toHaveProperty('explanation');
    const attempt = await call(
      'POST',
      `/lessons/${lessonId}/attempts`,
      { answers: { inspect: 1, when: 0, damage: 0 } },
      viewer,
    );
    expect(attempt.json()).toMatchObject({ score: 67, correctAnswers: 2, passed: false });
    const passed = await call(
      'POST',
      `/lessons/${lessonId}/attempts`,
      { answers: { inspect: 1, when: 0, damage: 2 } },
      viewer,
    );
    expect(passed.json()).toMatchObject({
      score: 100,
      passed: true,
      credential: { verificationCode: expect.any(String) },
    });
  });
  it('reports live occupancy and removes a participant immediately on leave', async () => {
    const created = await call('POST', '/spatial/rooms', {
      title: 'Inspection workshop',
      lessonId,
    });
    expect(created.statusCode).toBe(201);
    roomId = created.json().room.id;
    expect((await call('POST', `/spatial/rooms/${roomId}/live`)).statusCode).toBe(200);
    expect(
      (
        await call(
          'POST',
          `/spatial/rooms/${roomId}/heartbeat`,
          { pose: { position: [0, 1.6, 0], device: 'web' } },
          viewer,
        )
      ).statusCode,
    ).toBe(200);
    const room = (await call('GET', '/spatial/rooms', undefined, viewer))
      .json()
      .rooms.find((r: { id: string }) => r.id === roomId);
    expect(room.participants).toHaveLength(1);
    expect((await call('POST', `/spatial/rooms/${roomId}/leave`, {}, other)).statusCode).toBe(404);
    expect((await call('POST', `/spatial/rooms/${roomId}/leave`, {}, viewer)).statusCode).toBe(200);
    expect(
      (await call('GET', `/spatial/rooms/${roomId}`, undefined, viewer)).json().room.participants,
    ).toHaveLength(0);
  });
  it('lets facilitators share steps and end sessions without granting learners room control', async () => {
    const state = { schemaVersion: 1, lessonStep: 1 };
    expect(
      (await call('PATCH', `/spatial/rooms/${roomId}/world`, { worldState: state }, viewer))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/spatial/rooms/${roomId}/world`, { worldState: state })).statusCode,
    ).toBe(200);
    expect(
      (await call('GET', `/spatial/rooms/${roomId}`, undefined, viewer)).json().room.worldState,
    ).toEqual(state);
    expect((await call('POST', `/spatial/rooms/${roomId}/archive`, {}, viewer)).statusCode).toBe(
      403,
    );
    expect((await call('POST', `/spatial/rooms/${roomId}/archive`, {})).statusCode).toBe(200);
    expect((await call('POST', `/spatial/rooms/${roomId}/heartbeat`, {}, viewer)).statusCode).toBe(
      404,
    );
  });
  it('recognizes existing passing evidence when a learner enrolls later', async () => {
    const created = await call('POST', '/courses', {
      title: 'Inspection program',
      slug: `inspection-${crypto.randomUUID()}`,
      description: 'Learn to inspect reviewed equipment before use.',
      lessonIds: [lessonId],
    });
    expect(created.statusCode).toBe(201);
    courseId = created.json().course.id;
    expect((await call('POST', `/courses/${courseId}/publish`)).statusCode).toBe(200);
    const enrolled = await call('POST', `/courses/${courseId}/enrollments`, {}, viewer);
    expect(enrolled.statusCode).toBe(201);
    expect(enrolled.json().enrollment.status).toBe('completed');
    expect(
      (await call('POST', `/courses/${courseId}/enrollments`, {}, viewer)).json().enrollment.id,
    ).toBe(enrolled.json().enrollment.id);
    const list = (await call('GET', '/courses', undefined, viewer)).json().courses;
    const course = list.find((c: { id: string }) => c.id === courseId);
    expect(course).toMatchObject({
      progress: { completed: 1, total: 1 },
      enrollment: { status: 'completed' },
    });
    expect(
      (await call('GET', '/courses', undefined, other))
        .json()
        .courses.some((c: { id: string }) => c.id === courseId),
    ).toBe(false);
  });
});
