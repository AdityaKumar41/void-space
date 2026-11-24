import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withPlatform } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';
let ctx: TestApp,
  teacher = '',
  viewer = '',
  learner = '',
  personal = '',
  learnerId = '',
  activityId = '',
  sourceId = '',
  classId = '',
  programId = '';
const created: string[] = [];
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  cookie = learner,
) =>
  ctx.app.inject({
    method,
    url: '/api/v1' + path,
    headers: { cookie },
    ...(body ? { payload: body } : {}),
  });
beforeAll(async () => {
  ctx = await createTestApp();
  teacher = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  viewer = cookieHeader((await login(ctx.app, DEMO.users.auroraViewer)).cookies, 'vs_access');
});
afterAll(async () => {
  await withTenant(DEMO_TENANT_IDS.aurora, async (db) => {
    if (classId) await db.learningClass.deleteMany({ where: { id: classId } });
    if (programId) await db.course.deleteMany({ where: { id: programId } });
    await db.simulationScenario.deleteMany({ where: { id: { in: created } } });
    if (learnerId) {
      await db.experienceRun.deleteMany({ where: { learnerId } });
      await db.scenarioAttempt.deleteMany({ where: { learnerId } });
      await db.courseEnrollment.deleteMany({ where: { learnerId } });
      await db.user.deleteMany({ where: { id: learnerId } });
    }
    if (sourceId) await db.learningSource.deleteMany({ where: { id: sourceId } });
  });
  if (personal) await withPlatform((db) => db.tenant.deleteMany({ where: { id: personal } }));
  await ctx?.close();
});
describe('connected learning API and privacy', () => {
  it('creates a personal learner without administration rights', async () => {
    const r = await call(
      'POST',
      '/auth/learners',
      {
        fullName: 'Pilot learner',
        email: `pilot-${randomUUID()}@example.test`,
        password: 'PilotLearning2026!',
        ageBand: '13-17',
      },
      '',
    );
    expect(r.statusCode, r.body).toBe(201);
    learner = cookieHeader(r.headers['set-cookie'] as string[], 'vs_access');
    const me = await call('GET', '/auth/me');
    expect(me.json().user.roles).toEqual(['Learner']);
    personal = me.json().user.activeTenantId;
    expect((await call('POST', '/learning/classes', { title: 'Not authorized' })).statusCode).toBe(
      403,
    );
  });
  it('imports three private starters and protects them from others', async () => {
    for (const key of ['geometry', 'diagram', 'process']) {
      const r = await call('POST', `/learning/starters/${key}/import`, {});
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json().activity.id;
      const a = await call('GET', `/learning/activities/${id}`);
      expect(a.statusCode).toBe(200);
      expect(JSON.stringify(a.json())).not.toContain('correctIds');
      expect((await call('GET', `/learning/activities/${id}`, undefined, teacher)).statusCode).toBe(
        404,
      );
      expect(
        (await call('POST', `/simulations/${id}/runs`, { mode: 'assessment' })).statusCode,
      ).not.toBe(201);
    }
  });
  it('joins a class with learner permissions and revokes invitations', async () => {
    const c = await call('POST', '/learning/classes', { title: 'Connected pilot class' }, teacher);
    expect(c.statusCode, c.body).toBe(201);
    classId = c.json().classroom.id;
    const invite = await call('POST', `/learning/classes/${classId}/invite`, {}, teacher);
    const r = await call('POST', '/learning/classes/join', { code: invite.json().code });
    expect(r.statusCode, r.body).toBe(200);
    const switched = await call('POST', '/auth/tenant', { tenantId: DEMO_TENANT_IDS.aurora });
    expect(switched.statusCode, switched.body).toBe(200);
    learner = cookieHeader(switched.headers['set-cookie'] as string[], 'vs_access');
    const me = await call('GET', '/auth/me');
    learnerId = me.json().user.id;
    expect(me.json().user.roles).toEqual(['Learner']);
    expect((await call('POST', '/learning/classes', { title: 'No permission' })).statusCode).toBe(
      403,
    );
    const classes = await call('GET', '/learning/classes');
    expect(JSON.stringify(classes.json())).not.toContain('tokenHash');
    expect(
      (await call('DELETE', `/learning/classes/${classId}/invite`, undefined, teacher)).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', '/learning/classes/join', { code: invite.json().code })).statusCode,
    ).toBe(404);
  });
  it('requires reviewed publishing and keeps original sources private', async () => {
    const r = await call('POST', '/learning/starters/process/import', {}, teacher);
    activityId = r.json().activity.id;
    created.push(activityId);
    const a = await call('GET', `/learning/activities/${activityId}/author`, undefined, teacher);
    const definition = a.json().activity.definition;
    sourceId = definition.blocks[0].sourceRefs[0].sourceId;
    expect(
      (await call('GET', '/learning/sources')).json().sources.some((s: any) => s.id === sourceId),
    ).toBe(false);
    expect((await call('GET', `/learning/sources/${sourceId}/file`)).statusCode).toBe(404);
    definition.reviewed = false;
    expect(
      (
        await call(
          'PATCH',
          `/learning/activities/${activityId}`,
          { definition, scope: 'workspace' },
          teacher,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', `/learning/activities/${activityId}/publish`, {}, teacher)).statusCode,
    ).toBe(400);
    definition.reviewed = true;
    await call(
      'PATCH',
      `/learning/activities/${activityId}`,
      { definition, scope: 'workspace' },
      teacher,
    );
    expect(
      (await call('POST', `/learning/activities/${activityId}/publish`, {}, teacher)).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          'PATCH',
          `/learning/activities/${activityId}`,
          { definition, scope: 'workspace' },
          teacher,
        )
      ).statusCode,
    ).toBe(409);
    const publicView = await call('GET', `/learning/activities/${activityId}`);
    expect(publicView.statusCode).toBe(200);
    expect(JSON.stringify(publicView.json())).not.toContain('correctOrder');
  });
  it('assigns an immutable mixed program and cannot complete it with practice alone', async () => {
    const r = await call(
      'POST',
      '/learning/programs',
      { title: 'Evidence learning path', description: 'Complete the reviewed process assessment.' },
      teacher,
    );
    programId = r.json().course.id;
    expect(
      (
        await call(
          'PUT',
          `/learning/programs/${programId}/units`,
          {
            units: [{ kind: 'activity', releaseId: activityId, requirement: 'pass_assessment' }],
            outcomes: ['Review material before sharing'],
            level: 'beginner',
            estimatedMinutes: 8,
          },
          teacher,
        )
      ).statusCode,
    ).toBe(200);
    expect((await call('POST', `/courses/${programId}/publish`, {}, teacher)).statusCode).toBe(200);
    expect(
      (
        await call(
          'PUT',
          `/learning/programs/${programId}/units`,
          { units: [{ kind: 'activity', releaseId: activityId }] },
          teacher,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          'POST',
          `/learning/classes/${classId}/assignments`,
          { title: 'Complete source review', kind: 'program', releaseId: programId },
          teacher,
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (await call('POST', `/courses/${programId}/enrollments`, {})).json().enrollment.status,
    ).toBe('active');
  });
  it('rejects wrong, duplicated and stale events; excludes assessment hints', async () => {
    const started = await call('POST', `/simulations/${activityId}/runs`, { mode: 'assessment' });
    expect(started.statusCode, started.body).toBe(201);
    const id = started.json().run.id;
    expect(started.json().run.currentStep).not.toHaveProperty('correctOrder');
    expect(
      (
        await call('POST', `/learning/activities/${activityId}/mentor`, {
          question: 'Give me a hint',
        })
      ).statusCode,
    ).toBe(403);
    const wrong = {
      eventKey: randomUUID(),
      revision: 0,
      kind: 'order',
      ids: ['publish', 'review', 'collect'],
    };
    const w = await call('POST', `/experience-runs/${id}/events`, wrong);
    expect(w.statusCode, w.body).toBe(201);
    expect(w.json().run.state.stepIndex).toBe(0);
    expect((await call('POST', `/experience-runs/${id}/events`, wrong)).json().duplicate).toBe(
      true,
    );
    expect(
      (await call('POST', `/experience-runs/${id}/events`, { ...wrong, eventKey: randomUUID() }))
        .statusCode,
    ).toBe(409);
    expect((await call('GET', `/experience-runs/${id}/replay`)).statusCode).toBe(403);
    expect((await call('GET', `/experience-runs/${id}`, undefined, viewer)).statusCode).toBe(404);
    const correct = await call('POST', `/experience-runs/${id}/events`, {
      eventKey: randomUUID(),
      revision: 1,
      kind: 'order',
      ids: ['collect', 'review', 'publish'],
    });
    expect(correct.statusCode, correct.body).toBe(201);
    const done = await call('POST', `/experience-runs/${id}/events`, {
      eventKey: randomUUID(),
      revision: 2,
      kind: 'answer',
      ids: ['review'],
    });
    expect(done.statusCode, done.body).toBe(201);
    expect(done.json().run.status).toBe('completed');
    expect(done.json().run.score).toBe(88);
    expect(done.json().run.passed).toBe(true);
    const program = await call('GET', `/learning/programs/${programId}/units`);
    expect(program.json().units.every((u: any) => u.completed)).toBe(true);
    expect(
      (await call('POST', `/courses/${programId}/enrollments`, {})).json().enrollment.status,
    ).toBe('completed');
  });
});
