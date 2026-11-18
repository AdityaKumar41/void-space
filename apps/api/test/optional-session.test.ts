import { afterAll, beforeAll, expect, it } from 'vitest';
import { cookieHeader, createTestApp, DEMO, login, type TestApp } from './helpers';
let context: TestApp;
beforeAll(async () => {
  context = await createTestApp();
});
afterAll(async () => {
  await context.close();
});
it('allows anonymous public browsing without a failed HTTP authentication probe', async () => {
  const optional = await context.app.inject('/api/v1/auth/me?optional=true');
  expect(optional.statusCode).toBe(200);
  expect(optional.json()).toBeNull();
  expect((await context.app.inject('/api/v1/auth/me')).statusCode).toBe(401);
});
it('preserves signed-in identity and rejects an invalid present cookie', async () => {
  const signedIn = await login(context.app, DEMO.users.auroraCreator);
  const response = await context.app.inject({
    url: '/api/v1/auth/me?optional=true',
    headers: { cookie: cookieHeader(signedIn.cookies, 'vs_access') },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().user.email).toBe(DEMO.users.auroraCreator);
  const invalid = await context.app.inject({
    url: '/api/v1/auth/me?optional=true',
    headers: { cookie: 'vs_access=invalid' },
  });
  expect(invalid.statusCode).toBe(401);
});

it('rejects oversized JSON collections before authentication schema validation', async () => {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: Array(1001).fill('invalid'), password: 'invalid' },
  });
  expect(response.statusCode).toBe(413);
  expect(response.json().code).toBe('PAYLOAD_TOO_COMPLEX');
});

it('rejects access tokens signed with a different algorithm', async () => {
  const token = context.app.jwt.sign(
    { sub: 'test', tid: 'test', roles: [], perms: [], amr: 'password', typ: 'access' },
    { algorithm: 'HS512' },
  );
  const response = await context.app.inject({
    url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('TOKEN_INVALID');
});
