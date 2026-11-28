import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, it, expect } from 'vitest';
import { withPlatform } from '@void-space/db';
import { createTestApp, cookieHeader, type TestApp } from './helpers';
let ctx: TestApp;
const tenants: string[] = [];
const suffix = randomUUID();
const request = (
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  path: string,
  body?: unknown,
  cookie = '',
) =>
  ctx.app.inject({
    method,
    url: '/api/v1' + path,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { payload: JSON.stringify(body) } : {}),
  });
const cookies = (r: { headers: Record<string, unknown> }) =>
  cookieHeader(r.headers['set-cookie'] as string[], 'vs_access');
async function register(
  label: string,
  personal = false,
  email = `${label}-${suffix}@example.test`,
) {
  const r = await request('POST', personal ? '/auth/learners' : '/auth/register', {
    fullName: `Test ${label}`,
    email,
    password: 'Individual2026!',
    ...(personal ? { ageBand: '18+' } : { organizationName: `Institution ${label}` }),
  });
  expect(r.statusCode, r.body).toBe(201);
  tenants.push(r.json().user.activeTenantId);
  return { cookie: cookies(r), user: r.json().user, email };
}
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  for (const id of tenants) await withPlatform((db) => db.tenant.deleteMany({ where: { id } }));
  await ctx.close();
});
it('does not expose or switch to another same-email account without ownership proof', async () => {
  const person = await register('individual', true),
    org = await register('unlinked-owner');
  const invited = await request(
    'POST',
    '/users/invite',
    { email: person.email, fullName: 'Different institution account', role: 'Learner' },
    org.cookie,
  );
  expect(invited.statusCode, invited.body).toBe(201);
  const accepted = await request('POST', '/auth/invite/accept', {
    token: invited.json().invite.token,
    fullName: 'Institution student',
    password: 'SeparateAccount2026!',
  });
  expect(accepted.statusCode, accepted.body).toBe(201);
  const personalView = (await request('GET', '/auth/me', undefined, person.cookie)).json();
  expect(personalView.user.tenants.map((t: { id: string }) => t.id)).toEqual([
    person.user.activeTenantId,
  ]);
  const switched = await request(
    'POST',
    '/auth/tenant',
    { tenantId: org.user.activeTenantId },
    person.cookie,
  );
  expect(switched.statusCode).toBe(403);
  expect(switched.json().code).toBe('IDENTITY_PROOF_REQUIRED');
  const student = cookies(accepted);
  expect(
    (await request('GET', '/learning/workspace/profile', undefined, student)).json().persona,
  ).toBe('student');
  expect(
    (
      await request(
        'POST',
        '/users/invite',
        {
          email: `escalate-${suffix}@example.test`,
          fullName: 'Unauthorized teacher',
          role: 'Creator',
        },
        student,
      )
    ).statusCode,
  ).toBe(403);
});
it('lets an authenticated individual create a separate institution and switch back without moving private data', async () => {
  const person = await register('founder', true);
  const source = await request(
    'POST',
    '/learning/sources',
    {
      title: 'Personal notes',
      text: 'These synthetic study notes must remain in the personal workspace.',
    },
    person.cookie,
  );
  expect(source.statusCode).toBe(201);
  const created = await request(
    'POST',
    '/learning/workspace/institution',
    { name: 'Separate institution' },
    person.cookie,
  );
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().workspace.id;
  tenants.push(id);
  const sw = await request('POST', '/auth/tenant', { tenantId: id }, person.cookie);
  expect(sw.statusCode, sw.body).toBe(200);
  const admin = cookies(sw);
  expect(
    (await request('GET', '/learning/workspace/profile', undefined, admin)).json().persona,
  ).toBe('teacher');
  expect(
    (await request('GET', `/learning/sources/${source.json().source.id}/file`, undefined, admin))
      .statusCode,
  ).toBe(404);
  expect((await request('GET', '/learning/sources', undefined, admin)).json().sources).toEqual([]);
  expect(
    (await request('POST', '/auth/tenant', { tenantId: person.user.activeTenantId }, admin))
      .statusCode,
  ).toBe(200);
});
it('allows removed members to be re-invited and consumes the new invitation only once', async () => {
  const org = await register('reinstate-owner'),
    email = `removed-${suffix}@example.test`;
  const invite = await request(
    'POST',
    '/users/invite',
    { email, fullName: 'Removed member', role: 'Learner' },
    org.cookie,
  );
  const accepted = await request('POST', '/auth/invite/accept', {
    token: invite.json().invite.token,
    fullName: 'Removed member',
    password: 'StudentAccount2026!',
  });
  expect(accepted.statusCode).toBe(201);
  expect(
    (await request('DELETE', `/users/${accepted.json().user.id}`, undefined, org.cookie))
      .statusCode,
  ).toBe(200);
  const next = await request(
    'POST',
    '/users/invite',
    { email, fullName: 'Returning teacher', role: 'Creator' },
    org.cookie,
  );
  expect(next.statusCode, next.body).toBe(201);
  const results = await Promise.all(
    ['FirstAccount2026!', 'SecondAccount2026!'].map((password) =>
      request('POST', '/auth/invite/accept', {
        token: next.json().invite.token,
        fullName: 'Returning teacher',
        password,
      }),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(results.find((r) => r.statusCode === 201)!.json().user.roles).toEqual(['Creator']);
});
it('revokes pending invitations with tenant isolation and prevents later acceptance', async () => {
  const owner = await register('revoke-owner'),
    other = await register('revoke-other');
  const invite = await request(
    'POST',
    '/users/invite',
    { email: `revoke-${suffix}@example.test`, fullName: 'Invite recipient', role: 'Learner' },
    owner.cookie,
  );
  expect(invite.statusCode).toBe(201);
  const id = invite.json().invite.id;
  expect(
    (await request('DELETE', `/users/invites/${id}`, undefined, other.cookie)).statusCode,
  ).toBe(404);
  expect(
    (await request('DELETE', `/users/invites/${id}`, undefined, owner.cookie)).statusCode,
  ).toBe(204);
  expect(
    (
      await request('POST', '/auth/invite/accept', {
        token: invite.json().invite.token,
        fullName: 'Invite recipient',
        password: 'InviteRecipient2026!',
      })
    ).statusCode,
  ).toBe(404);
});

it('keeps an administrator when two administrators concurrently demote themselves', async () => {
  const owner = await register('concurrent-admin');
  const invitation = await request(
    'POST',
    '/users/invite',
    {
      email: `second-admin-${suffix}@example.test`,
      fullName: 'Second administrator',
      role: 'TenantAdmin',
    },
    owner.cookie,
  );
  expect(invitation.statusCode).toBe(201);
  const accepted = await request('POST', '/auth/invite/accept', {
    token: invitation.json().invite.token,
    fullName: 'Second administrator',
    password: 'SecondAdmin2026!',
  });
  expect(accepted.statusCode).toBe(201);
  const results = await Promise.all([
    request('PATCH', `/users/${owner.user.id}`, { role: 'Learner' }, owner.cookie),
    request('PATCH', `/users/${accepted.json().user.id}`, { role: 'Learner' }, cookies(accepted)),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('LAST_ADMIN');
});
