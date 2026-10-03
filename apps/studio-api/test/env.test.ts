/**
 * Configuration validation (VS2-SRS-1.0 §9.4).
 *
 * The cases pinned here are the ones where a wrong value is *silent* rather than loud: a mis-set
 * base URL produces a 404 that looks like a missing VOID·SPACE route, and a blank line an operator
 * believes is inert either fails the boot or disables an integration without saying so.
 */
import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env';
import { STUDIO_TEST_ENV } from './harness';
/** A complete, valid environment, with one field overridable per test. */
function env(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...STUDIO_TEST_ENV, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

describe('Studio API environment', () => {
  it('applies the documented defaults', () => {
    const parsed = loadEnv(env({ STUDIO_API_PORT: undefined, VOIDSPACE_CLIENT_MODE: undefined }));

    // 4100 matches the upstream `docker/studio/nginx.conf` proxies to; a mismatch is a 502 that
    // looks like the API being down.
    expect(parsed.STUDIO_API_PORT).toBe(4100);
    // `live` by default, so a deployment never silently simulates a publish. Mock is opt-in.
    expect(parsed.VOIDSPACE_CLIENT_MODE).toBe('live');
    // FR-14.3 — how often an in-flight publish is re-read. The panel polls on this value, so it has
    // to reach the client through the status payload rather than being duplicated in the editor.
    expect(parsed.STUDIO_PUBLISH_POLL_INTERVAL_MS).toBe(30_000);
  });

  it('refuses a publish poll interval that would hammer the platform', () => {
    // The floor is server-side because the client cannot be trusted to be the only consumer of this
    // value, and a 1 ms poll is a denial of service aimed at our own API by configuration.
    expect(() => loadEnv(env({ STUDIO_PUBLISH_POLL_INTERVAL_MS: '50' }))).toThrow(
      /STUDIO_PUBLISH_POLL_INTERVAL_MS/,
    );
  });

  it('splits the CORS origins into a trimmed list', () => {
    const parsed = loadEnv(env({ STUDIO_CORS_ORIGINS: ' https://a.example , http://b.example ,' }));

    expect(parsed.STUDIO_CORS_ORIGINS).toEqual(['https://a.example', 'http://b.example']);
  });

  it('reads a blank setting as absent rather than as a value', () => {
    // `VAR=` is how a blank line is written in a .env file, and zod cannot tell it from a real one.
    const parsed = loadEnv(
      env({ STUDIO_VOIDSPACE_API_BASE_URL: '', STUDIO_VOIDSPACE_API_KEY: '' }),
    );

    expect(parsed.STUDIO_VOIDSPACE_API_BASE_URL).toBeUndefined();
    expect(parsed.STUDIO_VOIDSPACE_API_KEY).toBeUndefined();
  });

  it('rejects a base URL that carries the /api/v1 root', () => {
    // The doubled path this prevents: https://host/api/v1/api/v1/public/catalog. The message has to
    // name the field, because the operator's next move is to edit that line.
    expect(() =>
      loadEnv(env({ STUDIO_VOIDSPACE_API_BASE_URL: 'https://void.example/api/v1' })),
    ).toThrow(/STUDIO_VOIDSPACE_API_BASE_URL/);
  });

  it('accepts an origin with or without a trailing slash', () => {
    expect(
      loadEnv(env({ STUDIO_VOIDSPACE_API_BASE_URL: 'https://void.example' }))
        .STUDIO_VOIDSPACE_API_BASE_URL,
    ).toBe('https://void.example');
    expect(
      loadEnv(env({ STUDIO_VOIDSPACE_API_BASE_URL: 'https://void.example/' }))
        .STUDIO_VOIDSPACE_API_BASE_URL,
    ).toBe('https://void.example/');
    expect(
      loadEnv(env({ STUDIO_VOIDSPACE_API_BASE_URL: 'http://localhost:4433' }))
        .STUDIO_VOIDSPACE_API_BASE_URL,
    ).toBe('http://localhost:4433');
  });

  it('refuses to start without the two database URLs', () => {
    // A missing STUDIO_DATABASE_URL would otherwise disable tenant isolation silently (§5.2).
    expect(() => loadEnv(env({ STUDIO_DATABASE_URL: undefined }))).toThrow(
      /invalid environment configuration/,
    );
    expect(() => loadEnv(env({ STUDIO_PLATFORM_DATABASE_URL: undefined }))).toThrow(
      /invalid environment configuration/,
    );
  });

  it('refuses a signing secret too short to be one', () => {
    expect(() => loadEnv(env({ STUDIO_JWT_ACCESS_SECRET: 'short' }))).toThrow(
      /STUDIO_JWT_ACCESS_SECRET/,
    );
  });

  it('names the file to check against in the failure message', () => {
    expect(() => loadEnv(env({ STUDIO_DATABASE_URL: 'not-a-url' }))).toThrow(/\.env\.example/);
  });

  it('treats a blank AI key as “no provider”, not as a credential', () => {
    // The supported-deployment case: `ANTHROPIC_API_KEY=` in a .env file is how an operator writes
    // "I am not using the AI features", and it must degrade rather than fail the boot.
    const parsed = loadEnv(env({ ANTHROPIC_API_KEY: '' }));

    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
    // The rest of the AI settings still resolve, so the audit path can read them.
    expect(parsed.ANTHROPIC_TIMEOUT_MS).toBe(60_000);
    expect(parsed.STUDIO_AI_RATE_LIMIT_PER_MINUTE).toBe(30);
  });

  it('defaults the model to a dated snapshot, not a floating alias', () => {
    // §7.5's reproducibility guarantee rests on this: an alias means the Copilot's behaviour changes
    // without a commit, and a stored CopilotMessage can no longer be replayed.
    expect(loadEnv(env({ ANTHROPIC_MODEL: undefined })).ANTHROPIC_MODEL).toBe(
      'claude-sonnet-4-5-20250929',
    );
    // An operator may still pin their own, which is why this is a setting rather than a constant.
    expect(loadEnv(env({ ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001' })).ANTHROPIC_MODEL).toBe(
      'claude-haiku-4-5-20251001',
    );
  });

  it('refuses an AI timeout too tight to complete a multi-object instruction', () => {
    // §7.2 asks the model to reason over a scene summary and emit several tool calls, so a
    // sub-second ceiling times out on exactly the instructions the Copilot exists for. Refused at
    // boot rather than discovered as a mystery failure.
    expect(() => loadEnv(env({ ANTHROPIC_TIMEOUT_MS: '50' }))).toThrow(/ANTHROPIC_TIMEOUT_MS/);
  });

  it('refuses a per-tenant AI rate limit below one', () => {
    // Zero would read as "no AI" while leaving the feature enabled — a kill switch with the wrong
    // label. Disabling a feature is FR-18.1's flag, not a rate limit of zero.
    expect(() => loadEnv(env({ STUDIO_AI_RATE_LIMIT_PER_MINUTE: '0' }))).toThrow(
      /STUDIO_AI_RATE_LIMIT_PER_MINUTE/,
    );
  });
});
