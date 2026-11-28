import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withPlatform } from '@void-space/db';
import { createTestApp, removeTestTenants, type TestApp } from './helpers';
import { totp, totpStep } from '../src/modules/platform/totp';
let context: TestApp;
const ids: string[] = [];
beforeAll(async () => {
  context = await createTestApp();
});
afterAll(async () => {
  await withPlatform(async (db) => {
    await db.platformConsoleSession.deleteMany({ where: { userId: { in: ids } } });
    await db.platformAccess.deleteMany({ where: { userId: { in: ids } } });
  });
  await removeTestTenants();
  await context.close();
});
const cookiesOf = (response: { headers: Record<string, unknown> }) => {
  const values = response.headers['set-cookie'];
  return (Array.isArray(values) ? values : [values])
    .filter((v): v is string => typeof v === 'string' && !v.includes('Max-Age=0'))
    .map((v) => v.split(';')[0])
    .join('; ');
};
async function account(role?: 'PlatformAdmin' | 'PlatformModerator') {
  const result = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      organizationName: `Test platform boundary ${randomUUID()}`,
      fullName: 'Boundary administrator',
      email: `platform-${randomUUID()}@example.test`,
      password: 'PlatformBoundary2026!',
    },
  });
  expect(result.statusCode).toBe(201);
  const user = result.json().user;
  ids.push(user.id);
  if (role)
    await withPlatform((db) => db.platformAccess.create({ data: { userId: user.id, role } }));
  return { userId: user.id as string, cookie: cookiesOf(result) };
}
async function elevate(user: Awaited<ReturnType<typeof account>>) {
  const enrollment = await context.app.inject({
    method: 'POST',
    url: '/api/v1/platform/mfa/enroll',
    headers: { cookie: user.cookie },
  });
  expect(enrollment.statusCode).toBe(200);
  const secret = enrollment.json().secret as string;
  const verification = await context.app.inject({
    method: 'POST',
    url: '/api/v1/platform/mfa/verify',
    headers: { cookie: user.cookie },
    payload: { code: totp(secret, Math.floor(Date.now() / 30000)) },
  });
  expect(verification.statusCode).toBe(200);
  return {
    cookie: cookiesOf(verification),
    secret,
    codes: verification.json().recoveryCodes as string[],
  };
}
describe('global platform authority', () => {
  it('uses RFC 6238 truncation and rejects malformed and out-of-window codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totp(secret, 1)).toBe('287082');
    expect(totpStep(secret, '287082', 59000)).toBe(1);
    expect(totpStep(secret, '287082', 180000)).toBeNull();
    expect(totpStep(secret, '00000x', 59000)).toBeNull();
  });
  it('does not derive platform access from institution administration', async () => {
    const user = await account();
    for (const url of ['/api/v1/platform/overview', '/api/v1/tenants']) {
      const response = await context.app.inject({
        method: 'GET',
        url,
        headers: { cookie: user.cookie },
      });
      expect(response.statusCode).toBe(403);
    }
    const access = await context.app.inject({
      method: 'GET',
      url: '/api/v1/platform/access',
      headers: { cookie: user.cookie },
    });
    expect(access.json()).toMatchObject({ granted: false, enrolled: false, elevated: false });
  });
  it('requires MFA, prevents code replay, consumes recovery codes once and rechecks revocation', async () => {
    const user = await account('PlatformAdmin');
    expect(
      (
        await context.app.inject({
          method: 'GET',
          url: '/api/v1/platform/overview',
          headers: { cookie: user.cookie },
        })
      ).statusCode,
    ).toBe(403);
    const elevated = await elevate(user);
    expect(elevated.codes).toHaveLength(10);
    const overview = await context.app.inject({
      method: 'GET',
      url: '/api/v1/platform/overview',
      headers: { cookie: elevated.cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().role).toBe('PlatformAdmin');
    expect(JSON.stringify(overview.json())).not.toMatch(/secretCipher|passwordHash|storagePath/);
    const verify = (code: string) =>
      context.app.inject({
        method: 'POST',
        url: '/api/v1/platform/mfa/verify',
        headers: { cookie: user.cookie },
        payload: { code },
      });
    expect((await verify(totp(elevated.secret, Math.floor(Date.now() / 30000)))).statusCode).toBe(
      403,
    );
    expect((await verify(elevated.codes[0]!)).statusCode).toBe(200);
    expect((await verify(elevated.codes[0]!)).statusCode).toBe(403);
    await withPlatform((db) =>
      db.platformAccess.update({ where: { userId: user.userId }, data: { revokedAt: new Date() } }),
    );
    expect(
      (
        await context.app.inject({
          method: 'GET',
          url: '/api/v1/platform/overview',
          headers: { cookie: elevated.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('restricts moderators and refuses cross-origin changes', async () => {
    const user = await account('PlatformModerator'),
      elevated = await elevate(user);
    expect(
      (
        await context.app.inject({
          method: 'GET',
          url: '/api/v1/platform/events',
          headers: { cookie: elevated.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await context.app.inject({
          method: 'POST',
          url: '/api/v1/platform/logout',
          headers: { cookie: elevated.cookie, origin: 'https://unexpected.example' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('revokes central access when signing out of the application', async () => {
    const user = await account('PlatformAdmin');
    const elevated = await elevate(user);
    const logout = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `${user.cookie}; ${elevated.cookie}` },
    });
    expect(logout.statusCode).toBe(204);
    const stale = await context.app.inject({
      method: 'GET',
      url: '/api/v1/platform/overview',
      headers: { cookie: elevated.cookie },
    });
    expect(stale.statusCode).toBe(403);
  });
});
