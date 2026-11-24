import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { withTenant, withPlatform, buildGlbFixture } from '@void-space/db';
import { JobProducer } from '../src/lib/jobs';
import { createTestApp, cookieHeader, login, DEMO, DEMO_TENANT_IDS, type TestApp } from './helpers';
let ctx: TestApp,
  teacher = '',
  learner = '',
  other = '',
  personal = '',
  otherTenant = '',
  institution = '',
  modelId = '',
  planId = '',
  releaseId = '',
  threadId = '',
  folderId = '';
const files: string[] = [],
  tasks: string[] = [];
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  cookie = learner,
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
  for (const which of ['learner', 'other']) {
    const r = await call(
      'POST',
      '/auth/learners',
      {
        fullName: 'Agent pilot learner',
        email: `agent-${randomUUID()}@example.test`,
        password: 'AgentPilot2026!',
        ageBand: '13-17',
      },
      '',
    );
    expect(r.statusCode, r.body).toBe(201);
    const cookie = cookieHeader(r.headers['set-cookie'] as string[], 'vs_access'),
      me = (await call('GET', '/auth/me', undefined, cookie)).json();
    if (which === 'learner') {
      learner = cookie;
      personal = me.user.activeTenantId;
    } else {
      other = cookie;
      otherTenant = me.user.activeTenantId;
    }
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  if (planId)
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.lessonPlan.deleteMany({ where: { id: planId } }),
    );
  for (const id of [personal, otherTenant, institution].filter(Boolean))
    await withPlatform((db) => db.tenant.deleteMany({ where: { id } }));
  for (const path of files) await rm(path, { force: true });
  await ctx?.close();
});
describe('AI-first workspace permissions and audiences', () => {
  it('adds private GLB models without any public asset publication', async () => {
    const boundary = 'model-' + randomUUID(),
      bytes = buildGlbFixture(12),
      payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="my-private-model.glb"\r\nContent-Type: model/gltf-binary\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/learning/library/upload',
      headers: { cookie: learner, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(r.statusCode, r.body).toBe(201);
    modelId = r.json().model.id;
    const source = await withTenant(personal, (db) =>
      db.learningSource.findUniqueOrThrow({ where: { id: modelId } }),
    );
    files.push(source.storagePath!);
    expect(source.metadata).toMatchObject({ labelsReviewed: false });
    expect((await call('GET', `/learning/library/${modelId}/file`)).statusCode).toBe(200);
    expect(
      (await call('GET', `/learning/library/${modelId}/file`, undefined, other)).statusCode,
    ).toBe(404);
    expect(await withTenant(personal, (db) => db.asset.count({ where: { id: modelId } }))).toBe(0);
    const bad = {
      revision: 0,
      reviewed: true,
      labels: [
        {
          id: 'part',
          meshKey: 'mesh-999',
          label: 'Unverified part',
          explanation: 'A description',
          position: [0, 0, 0],
        },
      ],
    };
    expect((await call('PATCH', `/learning/library/${modelId}/labels`, bad)).statusCode).toBe(400);
    const good = { ...bad, labels: [{ ...bad.labels[0], meshKey: 'mesh-0' }] };
    expect((await call('PATCH', `/learning/library/${modelId}/labels`, good)).statusCode).toBe(200);
  });
  it('keeps conversations/folders private and recovers when the queue cannot start', async () => {
    const f = await call('POST', '/learning/agent/folders', { title: 'Anatomy drafts' });
    expect(f.statusCode, f.body).toBe(201);
    folderId = f.json().folder.id;
    const t = await call('POST', '/learning/agent/threads', { title: 'Plan a lesson', folderId });
    expect(t.statusCode, t.body).toBe(201);
    threadId = t.json().thread.id;
    expect(
      (await call('GET', `/learning/agent/threads/${threadId}`, undefined, other)).statusCode,
    ).toBe(404);
    const enqueue = vi
      .spyOn(JobProducer.prototype, 'enqueue')
      .mockResolvedValue({ id: 'test', queue: 'learning', enqueued: false });
    const event = {
      eventKey: randomUUID(),
      revision: 0,
      message: 'Create a 30-minute lesson about model inspection',
      privateModelId: modelId,
    };
    const sent = await call('POST', `/learning/agent/threads/${threadId}/messages`, event);
    expect(sent.statusCode, sent.body).toBe(202);
    tasks.push(sent.json().taskId);
    expect((await call('GET', `/learning/tasks/${sent.json().taskId}`)).json().task.status).toBe(
      'failed',
    );
    const duplicate = await call('POST', `/learning/agent/threads/${threadId}/messages`, event);
    expect(duplicate.json()).toMatchObject({ duplicate: true, taskId: sent.json().taskId });
    expect(
      (
        await call('POST', `/learning/agent/threads/${threadId}/messages`, {
          ...event,
          eventKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call('PATCH', `/learning/agent/threads/${threadId}`, { folderId }, other)).statusCode,
    ).toBe(404);
    enqueue.mockRestore();
  });
  it('enforces institution membership even when an outsider has a lesson code', async () => {
    const ex = await call('POST', '/learning/lesson-plans/examples/diagram', {}, teacher);
    planId = ex.json().plan.id;
    const pub = await call(
      'POST',
      `/learning/lesson-plans/${planId}/publish`,
      {
        revision: 0,
        visibility: 'institution',
        review: { facts: true, answers: true, mappings: true, rights: true },
      },
      teacher,
    );
    expect(pub.statusCode, pub.body).toBe(201);
    releaseId = pub.json().release.id;
    const link = await call(
      'POST',
      `/learning/lesson-plans/releases/${releaseId}/shares`,
      {},
      teacher,
    );
    expect(link.statusCode, link.body).toBe(201);
    expect(
      (await call('POST', '/learning/lesson-plans/join', { code: link.json().code })).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          'GET',
          `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/learning/public-lessons/${releaseId}`, undefined, '')).statusCode,
    ).toBe(404);
    const viewer = cookieHeader(
      (await login(ctx.app, DEMO.users.auroraViewer)).cookies,
      'vs_access',
    );
    expect(
      (
        await call(
          'GET',
          `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
          undefined,
          viewer,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          'PATCH',
          `/learning/lesson-plans/releases/${releaseId}/visibility`,
          { visibility: 'public' },
          teacher,
        )
      ).statusCode,
    ).toBe(200);
    const publicView = await call('GET', `/learning/public-lessons/${releaseId}`, undefined, '');
    expect(publicView.statusCode, publicView.body).toBe(200);
    expect(publicView.body).not.toContain('correctIds');
    expect(publicView.body).not.toContain('notes');
    expect((await call('POST', `/learning/public-lessons/${releaseId}/open`, {})).statusCode).toBe(
      200,
    );
    expect(
      (
        await call(
          'GET',
          `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
        )
      ).statusCode,
    ).toBe(200);
    await call(
      'PATCH',
      `/learning/lesson-plans/releases/${releaseId}/visibility`,
      { visibility: 'private' },
      teacher,
    );
    expect(
      (await call('GET', `/learning/public-lessons/${releaseId}`, undefined, '')).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          'GET',
          `/learning/lesson-plans/releases/${releaseId}?tenant=${DEMO_TENANT_IDS.aurora}`,
        )
      ).statusCode,
    ).toBe(404);
  });
  it('creates a separate institution for an authenticated individual, without moving private models', async () => {
    const r = await call('POST', '/learning/workspace/institution', { name: 'Pilot institution' });
    expect(r.statusCode, r.body).toBe(201);
    institution = r.json().workspace.id;
    const switched = await call('POST', '/auth/tenant', { tenantId: institution });
    expect(switched.statusCode, switched.body).toBe(200);
    const cookie = cookieHeader(switched.headers['set-cookie'] as string[], 'vs_access');
    const workspace = await call('GET', '/learning/workspace', undefined, cookie);
    expect(workspace.json().workspace.kind).toBe('organization');
    expect((await call('GET', '/learning/library', undefined, cookie)).json().models).toEqual([]);
    expect(
      (await call('GET', `/learning/library/${modelId}/file`, undefined, cookie)).statusCode,
    ).toBe(404);
  });
  it('refuses owned authoring changes after a role becomes read-only', async () => {
    const me = (await call('GET', '/auth/me')).json(),
      uid = me.user.id;
    await withTenant(personal, async (db) => {
      await db.userRole.deleteMany({ where: { userId: uid } });
      const role = await db.role.findUniqueOrThrow({ where: { name: 'Viewer' } });
      await db.userRole.create({ data: { tenantId: personal, userId: uid, roleId: role.id } });
    });
    expect(
      (
        await call('PATCH', `/learning/library/${modelId}/labels`, {
          revision: 1,
          reviewed: false,
          labels: [],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('PATCH', `/learning/agent/threads/${threadId}`, {
          title: 'Changed after demotion',
        })
      ).statusCode,
    ).toBe(403);
  });
});
