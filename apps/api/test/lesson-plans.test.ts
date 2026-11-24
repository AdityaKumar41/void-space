import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { withTenant, withPlatform } from '@void-space/db';
import type { LessonPlan } from '@void-space/types';
import { createTestApp, login, cookieHeader, DEMO, DEMO_TENANT_IDS, type TestApp } from './helpers';
let ctx: TestApp,
  teacher = '',
  learner = '',
  personal = '',
  planId = '',
  releaseId = '',
  shareId = '',
  sourceId = '';
let revision = 0,
  definition: LessonPlan;
const plans: string[] = [];
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  cookie = teacher,
) =>
  ctx.app.inject({
    method,
    url: '/api/v1' + path,
    headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  ctx = await createTestApp();
  teacher = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  const r = await call(
    'POST',
    '/auth/learners',
    {
      fullName: 'Lesson pilot learner',
      email: `lesson-${randomUUID()}@example.test`,
      password: 'LessonPilot2026!',
      ageBand: '13-17',
    },
    '',
  );
  expect(r.statusCode, r.body).toBe(201);
  learner = cookieHeader(r.headers['set-cookie'] as string[], 'vs_access');
  personal = (await call('GET', '/auth/me', undefined, learner)).json().user.activeTenantId;
});
afterAll(async () => {
  await withTenant(DEMO_TENANT_IDS.aurora, async (db) => {
    await db.lessonPlan.deleteMany({ where: { id: { in: plans } } });
    if (sourceId) await db.learningSource.deleteMany({ where: { id: sourceId } });
  });
  if (personal) await withPlatform((db) => db.tenant.deleteMany({ where: { id: personal } }));
  await ctx?.close();
});
describe('asset-led lesson releases, access and personal study', () => {
  it('creates complete examples in all three visual formats and protects drafts', async () => {
    for (const key of ['geometry', 'diagram', 'process']) {
      const r = await call('POST', `/learning/lesson-plans/examples/${key}`, {});
      expect(r.statusCode, r.body).toBe(201);
      plans.push(r.json().plan.id);
      if (key === 'geometry') {
        planId = r.json().plan.id;
        definition = r.json().plan.definition;
      }
      expect(
        r
          .json()
          .plan.definition.sections.reduce((n: number, s: { minutes: number }) => n + s.minutes, 0),
      ).toBe(30);
      expect(
        (await call('GET', `/learning/lesson-plans/${r.json().plan.id}`, undefined, learner))
          .statusCode,
      ).toBe(404);
    }
  });
  it('publishes only after explicit review, pins excerpts and hides instructor material', async () => {
    const s = await call('POST', '/learning/sources', {
      title: 'Private teacher source',
      text: 'A sphere has a curved surface in every direction. This source remains private.',
    });
    expect(s.statusCode, s.body).toBe(201);
    sourceId = s.json().source.id;
    definition.sourceIds = [sourceId];
    definition.sections[1]!.sourceRefs = [{ sourceId, passageId: 'p1' }];
    definition.sections[1]!.notes = 'INSTRUCTOR_PRIVATE_NOTES';
    const save = await call('PATCH', `/learning/lesson-plans/${planId}`, {
      revision: 0,
      definition,
    });
    expect(save.statusCode, save.body).toBe(200);
    revision = save.json().plan.revision;
    expect(
      (
        await call('POST', `/learning/lesson-plans/${planId}/publish`, {
          revision,
          review: { facts: true },
        })
      ).statusCode,
    ).toBe(400);
    const r = await call('POST', `/learning/lesson-plans/${planId}/publish`, {
      revision,
      review: { facts: true, answers: true, mappings: true, rights: true },
    });
    expect(r.statusCode, r.body).toBe(201);
    releaseId = r.json().release.id;
    const other = await call(
      'GET',
      `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
      undefined,
      learner,
    );
    expect(other.statusCode).toBe(404);
    const link = await call('POST', `/learning/lesson-plans/releases/${releaseId}/shares`, {});
    expect(link.statusCode, link.body).toBe(201);
    shareId = link.json().shareId;
    const before = (await call('GET', '/auth/me', undefined, learner)).json();
    const join = await call(
      'POST',
      '/learning/lesson-plans/join',
      { code: link.json().code },
      learner,
    );
    expect(join.statusCode, join.body).toBe(200);
    const after = (await call('GET', '/auth/me', undefined, learner)).json();
    expect(after.user.id).toBe(before.user.id);
    expect(after.user.activeTenantId).toBe(personal);
    expect(after.user.roles).toEqual(['Learner']);
    const view = await call(
      'GET',
      `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
      undefined,
      learner,
    );
    expect(view.statusCode, view.body).toBe(200);
    expect(view.body).not.toContain('correctIds');
    expect(view.body).not.toContain('targetId');
    expect(view.body).not.toContain('INSTRUCTOR_PRIVATE_NOTES');
    await call('DELETE', `/learning/lesson-plans/shares/${shareId}`);
    const replacement = await call(
      'POST',
      `/learning/lesson-plans/releases/${releaseId}/shares`,
      {},
    );
    shareId = replacement.json().shareId;
    expect(
      (
        await call(
          'POST',
          '/learning/lesson-plans/join',
          { code: replacement.json().code },
          learner,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          'GET',
          `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
          undefined,
          learner,
        )
      ).statusCode,
    ).toBe(200);
    expect(view.json().release.sourceExcerpts[0]).toMatchObject({ page: 1, passageId: 'p1' });
    expect(
      (await call('GET', `/learning/sources/${sourceId}/file`, undefined, learner)).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          'GET',
          `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}&present=true`,
          undefined,
          learner,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/learning/lesson-plans/releases/${releaseId}/exports?tenant=${DEMO_TENANT_IDS.aurora}`,
          { format: 'pptx', audience: 'teacher' },
          learner,
        )
      ).statusCode,
    ).toBe(403);
  });
  it('keeps progress individual and rejects fabricated completion, duplicate-key changes and stale tabs', async () => {
    const path = `/learning/lesson-plans/releases/${releaseId}/events?tenant=${DEMO_TENANT_IDS.aurora}`;
    const quiz = definition.sections.find((s) => s.kind === 'quiz')!;
    expect(
      (
        await call(
          'POST',
          path,
          { eventKey: randomUUID(), revision: 0, sectionId: quiz.id, kind: 'complete' },
          learner,
        )
      ).statusCode,
    ).toBe(400);
    const event = {
      eventKey: randomUUID(),
      revision: 0,
      sectionId: definition.sections[0]!.id,
      kind: 'complete',
    };
    const first = await call('POST', path, event, learner);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().revision).toBe(1);
    const dup = await call('POST', path, event, learner);
    expect(dup.json()).toMatchObject({ revision: 1, duplicate: true });
    expect(
      (await call('POST', path, { ...event, sectionId: definition.sections[1]!.id }, learner))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          'POST',
          path,
          { ...event, eventKey: randomUUID(), sectionId: definition.sections[1]!.id },
          learner,
        )
      ).statusCode,
    ).toBe(409);
    const reloaded = await call(
      'GET',
      `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
      undefined,
      learner,
    );
    expect(reloaded.json().progress.state.completed).toEqual([definition.sections[0]!.id]);
    const own = await call(
      'GET',
      `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
      undefined,
      teacher,
    );
    expect(own.json().progress.state.completed).toEqual([]);
    const wrong = await call(
      'POST',
      path,
      {
        eventKey: randomUUID(),
        revision: 1,
        sectionId: quiz.id,
        kind: 'activity',
        action: { eventKey: randomUUID(), revision: 0, kind: 'answer', ids: ['guess'] },
      },
      learner,
    );
    expect(wrong.statusCode, wrong.body).toBe(200);
    expect(wrong.json().state.activities[quiz.id].status).toBe('active');
    expect(wrong.body).not.toContain('correctIds');
    const correct = await call(
      'POST',
      path,
      {
        eventKey: randomUUID(),
        revision: 2,
        sectionId: quiz.id,
        kind: 'activity',
        action: { eventKey: randomUUID(), revision: 0, kind: 'answer', ids: ['consult'] },
      },
      learner,
    );
    expect(correct.statusCode, correct.body).toBe(200);
    expect(correct.json().state.activities[quiz.id]).toMatchObject({
      status: 'completed',
      mistakes: 1,
    });
  });
  it('keeps published releases immutable while allowing new drafts and revokes lesson grants', async () => {
    const before = await call(
      'GET',
      `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
    );
    const oldTitle = before.json().release.definition.title;
    const patched = await call('PATCH', `/learning/lesson-plans/${planId}`, {
      revision,
      definition: { ...definition, title: 'A revised geometry lesson' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(
      (await call('PATCH', `/learning/lesson-plans/${planId}`, { revision, definition }))
        .statusCode,
    ).toBe(409);
    const unchanged = await call(
      'GET',
      `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
    );
    expect(unchanged.json().release.definition.title).toBe(oldTitle);
    await expect(
      withTenant(DEMO_TENANT_IDS.aurora, (db) =>
        db.lessonPlanRelease.update({ where: { id: releaseId }, data: { revision: 99 } }),
      ),
    ).rejects.toThrow();
    expect((await call('DELETE', `/learning/lesson-plans/shares/${shareId}`)).statusCode).toBe(200);
    expect(
      (
        await call(
          'GET',
          `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
          undefined,
          learner,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          'POST',
          `/learning/lesson-plans/releases/${releaseId}/events?tenant=${DEMO_TENANT_IDS.aurora}`,
          {
            eventKey: randomUUID(),
            revision: 3,
            sectionId: definition.sections[1]!.id,
            kind: 'complete',
          },
          learner,
        )
      ).statusCode,
    ).toBe(404);
  });
  it('lets learners study private material without allowing publication or sharing', async () => {
    const example = await call('POST', '/learning/lesson-plans/examples/process', {}, learner);
    expect(example.statusCode, example.body).toBe(201);
    const id = example.json().plan.id;
    const snap = await call('POST', `/learning/lesson-plans/${id}/study`, {}, learner);
    expect(snap.statusCode, snap.body).toBe(201);
    const view = await call(
      'GET',
      `/learning/lesson-plans/releases/${snap.json().release.id}?tenant=${personal}`,
      undefined,
      learner,
    );
    expect(view.json().release.reviewed).toBe(false);
    expect(
      (
        await call(
          'POST',
          `/learning/lesson-plans/releases/${snap.json().release.id}/shares`,
          {},
          learner,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          `/learning/lesson-plans/releases/${snap.json().release.id}?tenant=${personal}`,
        )
      ).statusCode,
    ).toBe(404);
  });
});
