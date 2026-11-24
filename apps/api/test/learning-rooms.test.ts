import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';
let ctx: TestApp,
  teacher = '',
  participant = '',
  roomId = '',
  userId = randomUUID();
const tenant = DEMO_TENANT_IDS.aurora;
beforeAll(async () => {
  ctx = await createTestApp();
  teacher = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  await withTenant(tenant, async (db) => {
    await db.user.create({
      data: {
        id: userId,
        tenantId: tenant,
        email: `room-${userId}@example.test`,
        fullName: 'Room learner',
        status: 'active',
        passwordHash: 'unusable-test-credential',
      },
    });
    const role = await db.role.findUniqueOrThrow({ where: { name: 'Learner' } });
    await db.userRole.create({ data: { userId, tenantId: tenant, roleId: role.id } });
    const author = await db.user.findUniqueOrThrow({
      where: { tenantId_email: { tenantId: tenant, email: DEMO.users.auroraCreator } },
    });
    const room = await db.spatialRoom.create({
      data: {
        tenantId: tenant,
        createdById: author.id,
        title: 'Learning session fixture',
        status: 'live',
        worldState: {},
      },
    });
    roomId = room.id;
    await db.spatialParticipant.create({ data: { tenantId: tenant, roomId, userId } });
  });
  participant = `vs_access=${ctx.app.signAccessToken({ sub: userId, tid: tenant, roles: ['Learner'], perms: [], amr: 'password', typ: 'access' })}`;
});
afterAll(async () => {
  await withTenant(tenant, async (db) => {
    if (roomId) await db.spatialRoom.deleteMany({ where: { id: roomId } });
    await db.user.deleteMany({ where: { id: userId } });
  });
  await ctx?.close();
});
const call = (method: 'GET' | 'POST', path: string, body?: unknown, cookie = participant) =>
  ctx.app.inject({
    method,
    url: '/api/v1' + path,
    headers: { cookie },
    ...(body ? { payload: body } : {}),
  });
describe('private individual answers within shared learning rooms', () => {
  it('limits facilitator control, hides votes and gates draft recaps', async () => {
    const event = (kind: string, revision: number, extra: Record<string, unknown> = {}) => ({
      kind,
      revision,
      eventKey: randomUUID(),
      ...extra,
    });
    expect(
      (
        await call(
          'POST',
          `/learning/rooms/${roomId}/events`,
          event('poll', 0, { text: 'Choose a next study step', options: ['Read', 'Practise'] }),
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/learning/rooms/${roomId}/events`,
          event('poll', 0, { text: 'Choose a next study step', options: ['Read', 'Practise'] }),
          teacher,
        )
      ).statusCode,
    ).toBe(201);
    const vote = event('vote', 1, { option: 1 });
    expect((await call('POST', `/learning/rooms/${roomId}/events`, vote)).statusCode).toBe(201);
    expect((await call('POST', `/learning/rooms/${roomId}/events`, vote)).json().duplicate).toBe(
      true,
    );
    const poll = (await call('GET', `/learning/rooms/${roomId}`)).json().session.poll;
    expect(poll.ownVote).toBe(1);
    expect(poll.counts).toBeNull();
    expect(poll).not.toHaveProperty('votes');
    const publicRoom = (await call('GET', `/spatial/rooms/${roomId}`)).json();
    expect(JSON.stringify(publicRoom)).not.toContain('votes');
    expect(
      (
        await call(
          'POST',
          `/learning/rooms/${roomId}/events`,
          event('question', 0, { text: 'Why does the switch open the path?' }),
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          'POST',
          `/learning/rooms/${roomId}/events`,
          event('recap', 2, {
            text: 'We reviewed circuit components. Questions remain open.',
            reviewed: false,
          }),
          teacher,
        )
      ).statusCode,
    ).toBe(201);
    expect((await call('GET', `/learning/rooms/${roomId}`)).json().session.recap).toBeNull();
    expect(
      (await call('GET', `/learning/rooms/${roomId}`, undefined, teacher)).json().session.recap
        .reviewed,
    ).toBe(false);
    expect(
      (
        await call(
          'POST',
          `/learning/rooms/${roomId}/events`,
          event('recap', 3, {
            text: 'We reviewed circuit components. Questions remain open.',
            reviewed: true,
          }),
          teacher,
        )
      ).statusCode,
    ).toBe(201);
    expect((await call('GET', `/learning/rooms/${roomId}`)).json().session.recap.reviewed).toBe(
      true,
    );
  });
});
