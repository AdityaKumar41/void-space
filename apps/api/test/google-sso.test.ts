/**
 * Google SSO (FR-2.2).
 *
 * Google's endpoints are not reachable from the test environment, so these tests
 * cover the parts that are ours to get right: the state check, graceful degradation
 * when the deployment has no Google credentials, and the first-sign-in onboarding
 * branch (which is reached here by signing an onboarding token the same way the
 * callback does).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { safeOAuthNext } from '../src/modules/auth/google-routes';
import {
  DEMO,
  cookieHeader,
  createTestApp,
  login,
  readCookie,
  removeTestTenants,
  type TestApp,
} from './helpers';

let context: TestApp;
let suffix: string;

beforeAll(async () => {
  context = await createTestApp();
  suffix = Math.random().toString(36).slice(2, 8);
});

afterAll(async () => {
  // The suite creates real workspaces through the API; leave the dev database as we found it.
  await removeTestTenants();
  await context?.close();
});

describe('FR-2.2 Google SSO', () => {
  it('keeps the post-login path on this site', () => {
    expect(safeOAuthNext('/console/library')).toBe('/console/library');
    expect(safeOAuthNext('//evil.example')).toBe('/console');
    expect(safeOAuthNext('https://evil.example')).toBe('/console');
    expect(safeOAuthNext('/login')).toBe('/console');
  });

  it('advertises which login methods the deployment offers', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/auth/providers' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { password: boolean; google: boolean; wallet: boolean };
    expect(body.password).toBe(true);
    // The button tracks whether this process actually has a Google client.
    expect(body.google).toBe(Boolean(context.env.GOOGLE_CLIENT_ID));
    expect(typeof body.wallet).toBe('boolean');
  });

  it('sends the browser to Google, or refuses when Google is not configured', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/start?next=/studio/connect',
    });

    if (!context.env.GOOGLE_CLIENT_ID) {
      expect(response.statusCode).toBe(503);
      expect((response.json() as { code: string }).code).toBe('GOOGLE_NOT_CONFIGURED');
      return;
    }

    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(readCookie(response.headers['set-cookie'], 'vs_oauth_state')).toBeTruthy();
    expect(readCookie(response.headers['set-cookie'], 'vs_oauth_next')).toBe('/studio/connect');
  });

  it('rejects a callback with a mismatched or missing state (login CSRF)', async () => {
    const configured = Boolean(context.env.GOOGLE_CLIENT_ID && context.env.GOOGLE_REDIRECT_URI);
    const origin = configured ? new URL(context.env.GOOGLE_REDIRECT_URI!).origin : '';

    const missing = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=abc&state=xyz',
    });
    const incomplete = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=abc',
    });
    const cancelled = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?error=access_denied',
    });

    if (!configured) {
      expect(missing.statusCode).toBe(401);
      expect((missing.json() as { code: string }).code).toBe('GOOGLE_STATE_MISMATCH');
      expect(incomplete.statusCode).toBe(401);
      expect((incomplete.json() as { code: string }).code).toBe('GOOGLE_BAD_CALLBACK');
      expect(cancelled.statusCode).toBe(401);
      expect((cancelled.json() as { code: string }).code).toBe('GOOGLE_CANCELLED');
      return;
    }

    // A person coming back from Google must land on the sign-in page, not a JSON body.
    expect(missing.statusCode).toBe(302);
    expect(missing.headers.location).toBe(`${origin}/login?error=GOOGLE_STATE_MISMATCH`);
    expect(incomplete.headers.location).toBe(`${origin}/login?error=GOOGLE_BAD_CALLBACK`);
    expect(cancelled.headers.location).toBe(`${origin}/login?error=GOOGLE_CANCELLED`);
  });

  it('provisions a workspace for a first-time SSO identity', async () => {
    const email = `sso-owner-${suffix}@example.test`;
    const onboarding = context.app.signOnboardingToken({
      email,
      fullName: 'SSO Owner',
      googleId: `google-sub-${suffix}`,
    });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/complete',
      headers: { cookie: `vs_onboarding=${onboarding}` },
      payload: {
        organizationName: `SSO Workspace ${suffix}`,
        organizationSlug: `sso-workspace-${suffix}`,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { user: { email: string; roles: string[]; tenants: unknown[] } };
    expect(body.user.email).toBe(email);
    expect(body.user.roles).toEqual(['TenantAdmin']);

    // The new account has a live session …
    const setCookie = response.headers['set-cookie'];
    const me = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader(setCookie, 'vs_access') },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { tenant: { slug: string } }).tenant.slug).toBe(
      `sso-workspace-${suffix}`,
    );

    // … and cannot be signed into with a password it never had (FR-2.6 principle:
    // SSO-only accounts are not password accounts).
    const passwordAttempt = await login(context.app, email, DEMO.password);
    expect(passwordAttempt.statusCode).toBe(401);
  });

  it('refuses onboarding without a valid onboarding cookie', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/complete',
      payload: { organizationName: 'No Cookie Inc' },
    });

    expect(response.statusCode).toBe(401);
    expect((response.json() as { code: string }).code).toBe('ONBOARDING_EXPIRED');
  });

  it('refuses an onboarding token signed for a different purpose', async () => {
    // An access token must not be usable as an onboarding token.
    const admin = await login(context.app, DEMO.users.auroraAdmin);
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/complete',
      headers: { cookie: `vs_onboarding=${admin.accessToken}` },
      payload: { organizationName: 'Wrong Token Inc' },
    });

    expect(response.statusCode).toBe(401);
    expect((response.json() as { code: string }).code).toBe('ONBOARDING_EXPIRED');
  });
});
