import { lessonTemplate } from '@void-space/types';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { createTestApp, DEMO_TENANT_IDS, type TestApp } from './helpers';
import { starterActivity } from '../src/modules/learning-hub/starters';
let ctx: TestApp;
const tenant = DEMO_TENANT_IDS.aurora,
  ids = Array.from({ length: 50 }, () => randomUUID());
const scenarioId = randomUUID(),
  planId = randomUUID(),
  releaseId = randomUUID();
let cookies: string[] = [];
beforeAll(async () => {
  ctx = await createTestApp();
  await withTenant(tenant, async (db) => {
    await db.user.createMany({
      data: ids.map((id, i) => ({
        id,
        tenantId: tenant,
        email: `pilot-load-${id}@example.test`,
        fullName: `Pilot learner ${i + 1}`,
        status: 'active',
        passwordHash: 'unusable-load-test-password',
      })),
    });
    const role = await db.role.findUniqueOrThrow({ where: { name: 'Learner' } });
    await db.userRole.createMany({
      data: ids.map((userId) => ({ tenantId: tenant, userId, roleId: role.id })),
    });
    const definition = lessonTemplate({
      topic: 'Concurrent lesson pilot',
      audience: 'Learners aged 13+',
      durationMinutes: 30,
      instructions: '',
      sourceIds: [],
    });
    await db.lessonPlan.create({
      data: { id: planId, tenantId: tenant, ownerId: ids[0]!, title: definition.title, definition },
    });
    await db.lessonPlanRelease.create({
      data: {
        id: releaseId,
        tenantId: tenant,
        ownerId: ids[0]!,
        planId,
        revision: 0,
        definition,
        sourceExcerpts: [],
        reviewed: true,
        visibility: 'institution',
      },
    });
    await db.simulationScenario.create({
      data: {
        id: scenarioId,
        tenantId: tenant,
        createdById: ids[0]!,
        title: '50 learner process fixture',
        description: 'Temporary pilot load fixture',
        status: 'published',
        learningScope: 'workspace',
        rubric: [],
        experience: starterActivity('process')!,
      },
    });
  });
  cookies = ids.map(
    (sub) =>
      `vs_access=${ctx.app.signAccessToken({ sub, tid: tenant, roles: ['Learner'], perms: [], amr: 'password', typ: 'access' })}`,
  );
});
afterAll(async () => {
  await withTenant(tenant, async (db) => {
    await db.lessonPlan.deleteMany({ where: { id: planId } });
    await db.simulationScenario.deleteMany({ where: { id: scenarioId } });
    await db.scenarioAttempt.deleteMany({ where: { learnerId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  });
  await ctx?.close();
});
describe('50 active learner pilot load', () => {
  it('serves listings and isolated, resumable server-scored runs concurrently', async () => {
    const timings: number[] = [];
    async function request(i: number, path: string, body?: unknown) {
      const start = performance.now();
      const r = await ctx.app.inject({
        method: body ? 'POST' : 'GET',
        url: '/api/v1' + path,
        headers: { cookie: cookies[i] },
        ...(body ? { payload: body } : {}),
      });
      timings.push(performance.now() - start);
      expect(r.statusCode, r.body).toBe(body ? 201 : 200);
      return r.json();
    }
    await Promise.all(ids.map((_, i) => request(i, '/learning/activities')));
    const runs = await Promise.all(
      ids.map((_, i) => request(i, `/simulations/${scenarioId}/runs`, { mode: 'assessment' })),
    );
    expect(new Set(runs.map((r) => r.run.id)).size).toBe(50);
    await Promise.all(
      runs.map((r, i) =>
        request(i, `/experience-runs/${r.run.id}/events`, {
          eventKey: randomUUID(),
          revision: 0,
          kind: 'order',
          ids: ['collect', 'review', 'publish'],
        }),
      ),
    );
    const complete = await Promise.all(
      runs.map((r, i) =>
        request(i, `/experience-runs/${r.run.id}/events`, {
          eventKey: randomUUID(),
          revision: 1,
          kind: 'answer',
          ids: ['review'],
        }),
      ),
    );
    expect(complete.every((r) => r.run.passed && r.run.score === 100 && r.run.revision === 2)).toBe(
      true,
    );
    await Promise.all(runs.map((r, i) => request(i, `/experience-runs/${r.run.id}`)));
    const foreign = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/experience-runs/${runs[0].run.id}`,
      headers: { cookie: cookies[1] },
    });
    expect(foreign.statusCode).toBe(404);
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)]!;
    console.info(
      JSON.stringify({
        activeLearners: 50,
        requests: timings.length,
        p95Ms: Math.round(p95),
        maxMs: Math.round(timings.at(-1)!),
      }),
    );
    expect(p95).toBeLessThan(5000);
  });
  it('serves the agent workspace and individual lesson progress for 50 active learners', async () => {
    const timings: number[] = [];
    const request = async (i: number, path: string, body?: unknown) => {
      const start = performance.now();
      const r = await ctx.app.inject({
        method: body ? 'POST' : 'GET',
        url: '/api/v1' + path,
        headers: { cookie: cookies[i] },
        ...(body ? { payload: body } : {}),
      });
      timings.push(performance.now() - start);
      expect(r.statusCode, r.body).toBe(200);
      return r.json();
    };
    await Promise.all(ids.map((_, i) => request(i, '/learning/agent/threads')));
    await Promise.all(ids.map((_, i) => request(i, '/learning/lesson-plans')));
    await Promise.all(
      ids.map((_, i) =>
        request(i, `/learning/lesson-plans/releases/${releaseId}?tenant=${tenant}`),
      ),
    );
    const events = ids.map(() => ({
      eventKey: randomUUID(),
      revision: 0,
      sectionId: 'section_1',
      kind: 'complete',
    }));
    const states = await Promise.all(
      ids.map((_, i) =>
        request(
          i,
          `/learning/lesson-plans/releases/${releaseId}/events?tenant=${tenant}`,
          events[i],
        ),
      ),
    );
    expect(states.every((s) => s.revision === 1 && s.state.completed.length === 1)).toBe(true);
    const duplicate = await Promise.all(
      ids.map((_, i) =>
        request(
          i,
          `/learning/lesson-plans/releases/${releaseId}/events?tenant=${tenant}`,
          events[i],
        ),
      ),
    );
    expect(duplicate.every((s) => s.revision === 1 && s.duplicate)).toBe(true);
    const sorted = timings.sort((a, b) => a - b),
      p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    console.log(
      JSON.stringify({
        scenario: 'agent-and-lessons',
        learners: 50,
        requests: timings.length,
        p95Ms: Math.round(p95),
        maxMs: Math.round(sorted.at(-1)!),
      }),
    );
    expect(p95).toBeLessThan(5000);
  });
});
