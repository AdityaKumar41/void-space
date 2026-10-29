import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';
import { definition } from './experience-fixture';
let ctx: TestApp;
let author: string;
let viewer: string;
let other: string;
let scenarioId: string;
let runId: string;
const call = (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, unknown>,
  cookie = viewer,
) =>
  ctx.app.inject({
    method,
    url: '/api/v1' + path,
    headers: { cookie },
    ...(body ? { payload: body } : {}),
  });
beforeAll(async () => {
  ctx = await createTestApp();
  author = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  viewer = cookieHeader((await login(ctx.app, DEMO.users.auroraViewer)).cookies, 'vs_access');
  other = cookieHeader((await login(ctx.app, DEMO.users.northwindAdmin)).cookies, 'vs_access');
  const assets = (await call('GET', '/lessons/assets', undefined, author)).json().assets;
  const asset = assets.find((a: { media: { cid: string | null } | null }) => a.media?.cid);
  if (!asset) throw new Error('Expected approved pinned demo asset');
  const created = await call(
    'POST',
    '/simulations',
    {
      title: 'Interactive fixture',
      description: 'Identify a component and respond to a defect with recorded scene actions.',
      experience: { ...definition, assetId: asset.id },
    },
    author,
  );
  expect(created.statusCode).toBe(201);
  scenarioId = created.json().scenario.id;
  expect((await call('POST', `/simulations/${scenarioId}/publish`, {}, author)).statusCode).toBe(
    200,
  );
});
afterAll(async () => {
  if (scenarioId)
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.simulationScenario.deleteMany({ where: { id: scenarioId } }),
    );
  await ctx?.close();
});
describe('Durable interactive experience runtime', () => {
  it('starts and resumes only the learner’s own run, without exposing answer keys', async () => {
    const started = await call('POST', `/simulations/${scenarioId}/runs`, { mode: 'assessment' });
    expect(started.statusCode).toBe(201);
    runId = started.json().run.id;
    expect(started.json().run.currentStep).not.toHaveProperty('hintTargetId');
    expect(
      (await call('POST', `/simulations/${scenarioId}/runs`, { mode: 'assessment' })).json().run.id,
    ).toBe(runId);
    expect((await call('GET', `/experience-runs/${runId}`, undefined, other)).statusCode).toBe(404);
    expect(
      (
        await call('POST', `/simulations/${scenarioId}/attempts`, {
          evidence: { identify: true, decide: true },
          score: 100,
        })
      ).statusCode,
    ).toBe(409);
  });
  it('rejects forged scores, stale events, and duplicate advancement', async () => {
    expect(
      (
        await call('POST', `/experience-runs/${runId}/events`, {
          kind: 'select_target',
          targetId: 'housing',
          revision: 0,
          eventKey: randomUUID(),
          score: 100,
        })
      ).statusCode,
    ).toBe(400);
    const event = {
      kind: 'select_target',
      targetId: 'housing',
      revision: 0,
      eventKey: randomUUID(),
    };
    const [result, concurrent] = await Promise.all([
      call('POST', `/experience-runs/${runId}/events`, event),
      call('POST', `/experience-runs/${runId}/events`, event),
    ]);
    expect([result.statusCode, concurrent.statusCode].sort()).toEqual([200, 201]);
    expect([200, 201]).toContain(result.statusCode);
    expect(result.json().run.state.stepIndex).toBe(1);
    expect(result.json().run.currentStep).not.toHaveProperty('correctChoiceId');
    expect(
      (await call('POST', `/experience-runs/${runId}/events`, { ...event, targetId: 'battery' }))
        .statusCode,
    ).toBe(409);
    const repeated = await call('POST', `/experience-runs/${runId}/events`, event);
    expect(repeated.json()).toMatchObject({ duplicate: true, run: { revision: 1 } });
    expect(
      (
        await call('POST', `/experience-runs/${runId}/events`, {
          kind: 'choose',
          choiceId: 'report',
          revision: 0,
          eventKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
  });
  it('finishes atomically with one assessment and a server-timestamped replay', async () => {
    const event = { kind: 'choose', choiceId: 'report', revision: 1, eventKey: randomUUID() };
    const completed = await call('POST', `/experience-runs/${runId}/events`, event);
    expect(completed.json().run).toMatchObject({ status: 'completed', score: 100, passed: true });
    const attemptId = completed.json().run.attemptId;
    expect(
      (await call('POST', `/experience-runs/${runId}/events`, event)).json().run.attemptId,
    ).toBe(attemptId);
    const replay = (await call('GET', `/experience-runs/${runId}/replay`)).json();
    expect(replay.events).toHaveLength(2);
    expect(replay.events[0].at).toBeTruthy();
    const attempts = await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.scenarioAttempt.count({ where: { scenarioId } }),
    );
    expect(attempts).toBe(1);
  });
  it('keeps publication immutable and restricts room bindings to published workspace experiences', async () => {
    expect(
      (
        await call(
          'PATCH',
          `/simulations/${scenarioId}`,
          {
            title: 'Changed title',
            description: 'A valid description for a changed experience',
            experience: definition,
          },
          author,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await call('GET', `/simulations/${scenarioId}/author`, undefined, other)).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          'POST',
          '/spatial/rooms',
          { title: 'Cross-workspace experience', experienceId: scenarioId },
          other,
        )
      ).statusCode,
    ).toBe(400);
    const room = await call(
      'POST',
      '/spatial/rooms',
      { title: 'Interactive learning room', experienceId: scenarioId },
      author,
    );
    expect(room.statusCode).toBe(201);
    expect(room.json().room.worldState.experienceId).toBe(scenarioId);
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.spatialRoom.delete({ where: { id: room.json().room.id } }),
    );
  });
  it('keeps coached practice separate from passing assessed evidence', async () => {
    const start = (
      await call('POST', `/simulations/${scenarioId}/runs`, { mode: 'practice', restart: true })
    ).json().run;
    await call('POST', `/experience-runs/${start.id}/events`, {
      kind: 'select_target',
      targetId: 'housing',
      revision: 0,
      eventKey: randomUUID(),
    });
    const bad = await call('POST', `/experience-runs/${start.id}/events`, {
      kind: 'choose',
      choiceId: 'continue',
      revision: 1,
      eventKey: randomUUID(),
    });
    expect(bad.json().run.status).toBe('active');
    const good = await call('POST', `/experience-runs/${start.id}/events`, {
      kind: 'choose',
      choiceId: 'report',
      revision: 2,
      eventKey: randomUUID(),
    });
    expect(good.json().run).toMatchObject({ status: 'completed', passed: false, mode: 'practice' });
  });
});
