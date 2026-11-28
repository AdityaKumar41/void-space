import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { withTenant } from '@void-space/db';
import { createTestApp, cookieHeader, login, DEMO, DEMO_TENANT_IDS, type TestApp } from './helpers';
let ctx: TestApp;
let author = '',
  other = '',
  owner = '';
const tenant = DEMO_TENANT_IDS.aurora;
const sourceIds: string[] = [],
  taskIds: string[] = [],
  collections: string[] = [];
const call = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown, cookie = author) =>
  ctx.app.inject({
    method,
    url: '/api/v1' + path,
    headers: { cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
beforeAll(async () => {
  ctx = await createTestApp();
  author = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  other = cookieHeader((await login(ctx.app, DEMO.users.auroraAdmin)).cookies, 'vs_access');
  owner = (await call('GET', '/auth/me')).json().user.id;
});
afterAll(async () => {
  await withTenant(tenant, async (db) => {
    await db.learningSourceCollection.deleteMany({ where: { id: { in: collections } } });
    await db.learningTask.deleteMany({ where: { id: { in: taskIds } } });
    await db.learningSource.deleteMany({ where: { id: { in: sourceIds } } });
  });
  await ctx?.close();
});
describe('private learning harness', () => {
  it('advertises image unavailability and refuses new image jobs while paused', async () => {
    const enabled = ctx.env.AI_IMAGE_ENABLED;
    ctx.env.AI_IMAGE_ENABLED = false;
    try {
      expect((await call('GET', '/learning/agent/activity')).json().imageAvailable).toBe(false);
      const result = await call('POST', '/learning/agent/images', { prompt: 'Synthetic cube' });
      expect(result.statusCode).toBe(409);
      expect(result.json().code).toBe('IMAGE_GENERATION_PAUSED');
    } finally {
      ctx.env.AI_IMAGE_ENABLED = enabled;
    }
  });
  it('keeps source collections owner-only, validates references and checks revisions', async () => {
    const source = (
      await call('POST', '/learning/sources', {
        title: 'Harness reference',
        text: 'The sphere has a continuous curved surface used for synthetic learning tests.',
      })
    ).json().source;
    sourceIds.push(source.id);
    const created = await call('POST', '/learning/source-collections', {
      title: 'Sphere study',
      sourceIds: [source.id],
    });
    expect(created.statusCode, created.body).toBe(201);
    const collection = created.json().collection;
    collections.push(collection.id);
    expect(
      (await call('GET', '/learning/source-collections', undefined, other))
        .json()
        .collections.some((c: { id: string }) => c.id === collection.id),
    ).toBe(false);
    expect(
      (
        await call(
          'POST',
          '/learning/source-collections',
          { title: 'Forbidden source', sourceIds: [source.id] },
          other,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('PATCH', `/learning/source-collections/${collection.id}`, {
          title: 'Updated sphere study',
          sourceIds: [source.id],
          revision: 0,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('PATCH', `/learning/source-collections/${collection.id}`, {
          title: 'Stale overwrite',
          sourceIds: [source.id],
          revision: 0,
        })
      ).statusCode,
    ).toBe(409);
  });
  it('cancels a run idempotently and replays only owner-visible events', async () => {
    const id = randomUUID();
    taskIds.push(id);
    await withTenant(tenant, async (db) => {
      await db.learningTask.create({
        data: { id, tenantId: tenant, ownerId: owner, kind: 'agent_turn', input: {} },
      });
      await db.learningAgentRun.create({
        data: { id, tenantId: tenant, ownerId: owner, engine: 'inngest' },
      });
      await db.learningAgentEvent.create({
        data: {
          tenantId: tenant,
          runId: id,
          payload: { type: 'step', label: 'Reading synthetic notes' },
        },
      });
    });
    expect(
      (await call('POST', `/learning/agent/runs/${id}/cancel`, undefined, other)).statusCode,
    ).toBe(404);
    const events = await call('GET', `/learning/agent/runs/${id}/events`);
    expect(events.statusCode).toBe(200);
    const cursor = events.json().nextCursor;
    expect((await call('POST', `/learning/agent/runs/${id}/cancel`)).json().status).toBe(
      'cancelled',
    );
    expect((await call('POST', `/learning/agent/runs/${id}/cancel`)).json().status).toBe(
      'cancelled',
    );
    const replay = (await call('GET', `/learning/agent/runs/${id}/events?after=${cursor}`)).json();
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0].payload.type).toBe('cancelled');
    expect(
      (await call('GET', `/learning/agent/runs/${id}/events`, undefined, other)).statusCode,
    ).toBe(404);
  });
  it('records annotation revisions and rejects invalid citations and stale edits', async () => {
    const source = await withTenant(tenant, (db) =>
      db.learningSource.create({
        data: {
          tenantId: tenant,
          ownerId: owner,
          title: 'Synthetic sphere',
          mime: 'model/gltf-binary',
          passages: [],
          metadata: {
            revision: 0,
            parts: [{ key: 'mesh-0', name: 'Sphere' }],
            labels: [],
            labelsReviewed: false,
          },
        },
      }),
    );
    sourceIds.push(source.id);
    const label = {
      id: 'surface',
      label: 'Surface',
      explanation: 'A continuous curved surface.',
      meshKey: 'mesh-0',
      position: [0.1, 0.2, 0.3],
      function: 'Encloses a volume',
      relationships: 'Outer boundary',
      sourceRefs: [],
    };
    const first = await call('PATCH', `/learning/library/${source.id}/labels`, {
      revision: 0,
      reviewed: false,
      labels: [label],
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(
      (
        await call('PATCH', `/learning/library/${source.id}/labels`, {
          revision: 0,
          reviewed: false,
          labels: [label],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call('PATCH', `/learning/library/${source.id}/labels`, {
          revision: 1,
          reviewed: false,
          labels: [{ ...label, sourceRefs: [{ sourceId: randomUUID(), passageId: 'invented' }] }],
        })
      ).statusCode,
    ).toBe(400);
    const history = (
      await call('GET', `/learning/library/${source.id}/annotations/history`)
    ).json();
    expect(history.revisions.map((r: { revision: number }) => r.revision)).toEqual([1, 0]);
    expect(
      (await call('GET', `/learning/library/${source.id}/annotations/history`, undefined, other))
        .statusCode,
    ).toBe(404);
  });
});
