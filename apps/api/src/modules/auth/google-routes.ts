/**
 * Google SSO routes (FR-2.2).
 *
 *   GET  /api/v1/auth/google/start      redirect to Google's consent screen
 *   GET  /api/v1/auth/google/callback   exchange the code, then either sign in or
 *                                       park the identity for onboarding
 *   POST /api/v1/auth/google/complete   create a workspace for a first-time user
 *   GET  /api/v1/auth/providers         which login methods this deployment offers
 *
 * `state` is verified against a SameSite=Lax, httpOnly cookie before the code is
 * exchanged, so a cross-site login-CSRF cannot complete the flow.
 */
import { registerSchema, type AuthResponse, type SessionUser } from '@void-space/types';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { ApiEnv } from '../../env';
import {
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  ONBOARDING_COOKIE,
  clearOnboardingCookie,
  cookieSecurity,
  setAccessCookie,
  setOnboardingCookie,
  setRefreshCookie,
} from '../../lib/cookies';
import { parseDurationSeconds } from '../../lib/duration';
import { isAppError, UnauthenticatedError } from '../../lib/errors';
import { parseBody, requestContext } from '../../lib/http';
import { createGoogleSsoService, type OnboardingIdentity } from './google';
import { buildAuthService, type AuthService, type AuthenticatedResult } from './service';

const ONBOARDING_TTL_SECONDS = 30 * 60;

/**
 * The page Google returns to is a browser navigation, so the destination has to
 * be a path on our own site. `//evil.example` is protocol-relative and would
 * leave the product.
 */
export function safeOAuthNext(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return '/console';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/console';
  if (value.startsWith('/login')) return '/console';
  return value;
}

function webOrigin(redirectUri: string): string {
  return new URL(redirectUri).origin;
}

export interface GoogleRoutesOptions {
  readonly env: ApiEnv;
}

export async function googleRoutes(
  app: FastifyInstance,
  options: GoogleRoutesOptions,
): Promise<void> {
  const { env } = options;
  const secure = cookieSecurity(env);
  const accessMaxAgeSeconds = parseDurationSeconds(env.JWT_ACCESS_TTL, 900);
  const refreshMaxAgeSeconds = parseDurationSeconds(env.JWT_REFRESH_TTL, 604_800);

  // Same service instance wiring as password login: one TTL policy, one signer.
  const auth: AuthService = buildAuthService(app, env);
  const google = createGoogleSsoService({ env, auth });

  function completeAuth(reply: FastifyReply, result: AuthenticatedResult): AuthResponse {
    setAccessCookie(reply, result.accessToken, {
      secure,
      sameSite: 'lax',
      maxAgeSeconds: accessMaxAgeSeconds,
    });
    if (result.refreshToken) {
      setRefreshCookie(reply, result.refreshToken, {
        secure,
        sameSite: 'lax',
        maxAgeSeconds: refreshMaxAgeSeconds,
      });
    }
    clearOnboardingCookie(reply, secure);
    return { user: result.session as SessionUser, accessTokenExpiresIn: accessMaxAgeSeconds };
  }

  app.get('/google/start', async (request, reply) => {
    const { url, state } = google.startUrl();
    const next = safeOAuthNext((request.query as { next?: unknown }).next);
    const cookieBase = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/api/v1/auth' };
    reply.setCookie(OAUTH_STATE_COOKIE, state, { ...cookieBase, maxAge: 600 });
    reply.setCookie(OAUTH_NEXT_COOKIE, next, { ...cookieBase, maxAge: 600 });
    // Redirect the browser straight to Google.
    return reply.redirect(url, 302);
  });

  function loginError(reply: FastifyReply, message: string, code: string) {
    // Unconfigured deployments keep the JSON the suite asserts on. A configured
    // one is a browser coming back from Google, and a JSON body there is a dead end.
    if (!google.isConfigured() || !env.GOOGLE_REDIRECT_URI) {
      throw new UnauthenticatedError(message, code);
    }
    const origin = webOrigin(env.GOOGLE_REDIRECT_URI);
    return reply.redirect(`${origin}/login?error=${encodeURIComponent(code)}`, 302);
  }

  app.get('/google/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    if (query.error) {
      return loginError(reply, `Google sign-in was cancelled (${query.error})`, 'GOOGLE_CANCELLED');
    }
    if (!query.code || !query.state) {
      return loginError(reply, 'Missing code or state from Google', 'GOOGLE_BAD_CALLBACK');
    }

    const expectedState = request.cookies[OAUTH_STATE_COOKIE];
    if (!expectedState || expectedState !== query.state) {
      // Login-CSRF attempt, or a stale/replayed callback.
      return loginError(reply, 'OAuth state mismatch', 'GOOGLE_STATE_MISMATCH');
    }
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/v1/auth', secure, httpOnly: true, sameSite: 'lax' });

    let result: AuthenticatedResult | OnboardingIdentity;
    try {
      result = await google.exchangeCode(query.code, requestContext(request));
    } catch (error) {
      if (isAppError(error) && error.statusCode < 500) {
        return loginError(reply, error.message, error.code);
      }
      throw error;
    }

    const origin = webOrigin(env.GOOGLE_REDIRECT_URI!);
    const next = safeOAuthNext(request.cookies[OAUTH_NEXT_COOKIE]);
    reply.clearCookie(OAUTH_NEXT_COOKIE, { path: '/api/v1/auth', secure, httpOnly: true, sameSite: 'lax' });

    // No membership yet → FR-2.2's "prompt for tenant selection/creation".
    if ('googleId' in result) {
      const token = app.signOnboardingToken(result);
      setOnboardingCookie(reply, token, {
        secure,
        sameSite: 'lax',
        maxAgeSeconds: ONBOARDING_TTL_SECONDS,
      });
      const onboard = new URL('/login/google', origin);
      onboard.searchParams.set('next', next);
      return reply.redirect(onboard.toString(), 302);
    }

    completeAuth(reply, result);
    return reply.redirect(`${origin}${next}`, 302);
  });

  app.post('/google/complete', async (request, reply) => {
    const identity = app.verifyOnboardingToken(request.cookies[ONBOARDING_COOKIE]);
    if (!identity) {
      throw new UnauthenticatedError(
        'Your Google sign-in has expired; please start again',
        'ONBOARDING_EXPIRED',
      );
    }

    // The same shape as self-service signup minus the password (FR-1.1 via SSO).
    const input = parseBody(
      registerSchema.omit({ email: true, password: true, fullName: true }),
      request.body,
    );

    const result = await google.completeOnboarding(identity, input, requestContext(request));
    return reply.status(201).send(completeAuth(reply, result));
  });

  /** Small helper the web app calls to decide whether to show the Google button. */
  app.get('/providers', async (_request, reply) => {
    return reply.status(200).send({
      password: true,
      google: google.isConfigured(),
      wallet: env.SIWE_ENABLED,
      googleClientId: google.isConfigured() ? env.GOOGLE_CLIENT_ID : null,
    });
  });
}

export const googleOnboardingSchema = z.object({
  organizationName: z.string().min(2).max(120),
  organizationSlug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
});

export type { OnboardingIdentity };
