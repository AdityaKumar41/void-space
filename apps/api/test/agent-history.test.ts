import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { withTenant, withPlatform } from '@void-space/db';
import { JobProducer } from '../src/lib/jobs';
import { createTestApp, cookieHeader, login, DEMO, type TestApp } from './helpers';
let ctx: TestApp,
  cookie = '',
  other = '',
  tenant = '',
  otherTenant = '',
  owner = '';
const call = (url: string, c = cookie) =>
  ctx.app.inject({ method: 'GET', url: '/api/v1' + url, headers: { cookie: c } });
beforeAll(async () => {
  ctx = await createTestApp();
  for (const second of [false, true]) {
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/learners',
      payload: {
        fullName: 'History API learner',
        email: `history-api-${randomUUID()}@example.test`,
        password: 'HistoryApi2026!',
        ageBand: '18+',
      },
    });
    const c = cookieHeader(r.headers['set-cookie'] as string[], 'vs_access');
    const me = (await call('/auth/me', c)).json();
    if (second) {
      other = c;
      otherTenant = me.user.activeTenantId;
    } else {
      cookie = c;
      tenant = me.user.activeTenantId;
      owner = me.user.id;
    }
  }
});
afterAll(async () => {
  for (const id of [tenant, otherTenant])
    if (id) await withPlatform((db) => db.tenant.deleteMany({ where: { id } }));
  await ctx.close();
});
it('keeps all AI work private and paginates without returning prompts or answer definitions', async () => {
  const thread = await withTenant(tenant, (db) =>
    db.learningThread.create({
      data: { tenantId: tenant, ownerId: owner, title: 'Saved diagram', messages: [] },
    }),
  );
  const ids = Array.from({ length: 52 }, () => randomUUID());
  await withTenant(tenant, (db) =>
    db.learningTask.createMany({
      data: ids.map((id) => ({
        id,
        tenantId: tenant,
        ownerId: owner,
        kind: 'agent_turn',
        status: 'completed',
        input: {
          threadId: thread.id,
          context: {
            message: 'Saved diagram request',
            privateSourceText: 'private-source-sentinel',
          },
        },
        result: { definition: { correctIds: ['answer-secret-sentinel'] } },
      })),
    }),
  );
  await withTenant(tenant, (db) =>
    db.learningThread.update({
      where: { id: thread.id },
      data: { messages: [{ role: 'user', content: 'Saved diagram request', taskId: ids[0] }] },
    }),
  );
  const first = (await call('/learning/agent/activity')).json();
  expect(first.tasks).toHaveLength(50);
  expect(first.nextCursor).toBeTruthy();
  const second = (await call(`/learning/agent/activity?cursor=${first.nextCursor}`)).json();
  expect(second.tasks).toHaveLength(2);
  expect(new Set([...first.tasks, ...second.tasks].map((t: any) => t.id)).size).toBe(52);
  const view = await call('/learning/agent/activity');
  expect(view.body).not.toContain('private-source-sentinel');
  expect(view.body).not.toContain('answer-secret-sentinel');
  expect((await call('/learning/agent/activity', other)).json().tasks).toHaveLength(0);
  expect((await call(`/learning/agent/threads/${thread.id}`, other)).statusCode).toBe(404);
  expect((await call(`/learning/agent/threads/${thread.id}`)).json().tasks).toHaveLength(1);
});
it('derives institution teaching access from membership, while personal learners stay individual', async () => {
  expect((await call('/learning/workspace/profile')).json().persona).toBe('individual');
  const teacher = cookieHeader(
    (await login(ctx.app, DEMO.users.auroraCreator)).cookies,
    'vs_access',
  );
  expect((await call('/learning/workspace/profile', teacher)).json().persona).toBe('teacher');
  // A learner in an organization remains a student regardless of the email's domain.
  await withTenant(tenant, (db) =>
    db.tenant.update({ where: { id: tenant }, data: { kind: 'organization' } }),
  );
  expect((await call('/learning/workspace/profile')).json().persona).toBe('student');
});

it('loads older conversations without crossing accounts', async () => {
  await withTenant(tenant, (db) =>
    db.learningThread.createMany({
      data: Array.from({ length: 51 }, () => ({
        id: randomUUID(),
        tenantId: tenant,
        ownerId: owner,
        title: 'Older saved conversation',
        messages: [],
      })),
    }),
  );
  const first = (await call('/learning/agent/threads')).json();
  expect(first.threads).toHaveLength(50);
  const second = (await call(`/learning/agent/threads?cursor=${first.nextCursor}`)).json();
  expect(second.threads).toHaveLength(2);
  expect(new Set([...first.threads, ...second.threads].map((t: any) => t.id)).size).toBe(52);
  expect((await call('/learning/agent/threads', other)).json().threads).toHaveLength(0);
});
it('only retries an owned failed image request and keeps the previous failure', async () => {
  const user = (await call('/auth/me', other)).json().user;
  const previous = await withTenant(otherTenant, (db) =>
    db.learningTask.create({
      data: {
        tenantId: otherTenant,
        ownerId: user.id,
        kind: 'image_generate',
        status: 'failed',
        input: { prompt: 'A blue sphere' },
        error: 'Flux unavailable',
      },
    }),
  );
  const spy = vi
    .spyOn(JobProducer.prototype, 'enqueue')
    .mockResolvedValue({ id: 'test', queue: 'learning', enqueued: false });
  const enabled = ctx.env.AI_IMAGE_ENABLED;
  ctx.env.AI_IMAGE_ENABLED = true;
  try {
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/v1/learning/agent/activity/${previous.id}/retry`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/learning/agent/activity/${previous.id}/retry`,
      headers: { cookie: other },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().task.id).not.toBe(previous.id);
    expect(response.json().task.status).toBe('failed');
    const history = (await call('/learning/agent/activity', other)).json().tasks;
    expect(history).toHaveLength(2);
  } finally {
    ctx.env.AI_IMAGE_ENABLED = enabled;
    spy.mockRestore();
  }
});
