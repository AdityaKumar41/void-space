/**
 * Tests for the §7.5 cost and safety controls.
 *
 * These are the rules the SRS states as obligations, so each one is asserted rather than assumed. The
 * per-tenant rate limit test is the one worth reading: §7.5's stated purpose is that one tenant's
 * runaway request "cannot block … another tenant's usage", and a *global* limiter would pass a naive
 * "does it rate limit?" test while failing that requirement entirely.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AI_POLICY,
  TenantRateLimiter,
  redactForProvider,
  withTimeout,
  type AiPolicy,
} from '../src/policy';
import { classifyStatus } from '../src/transport';

const POLICY: AiPolicy = { ...DEFAULT_AI_POLICY, timeoutMs: 1_000, backoffBaseMs: 1, maxRetries: 2 };

describe('TenantRateLimiter', () => {
  it('limits one tenant without spending another tenant’s budget (§7.5)', () => {
    const now = 0;
    const limiter = new TenantRateLimiter(
      { ...POLICY, maxRequestsPerWindow: 2, windowMs: 1_000 },
      () => now,
    );

    expect(limiter.check('tenant-a').allowed).toBe(true);
    expect(limiter.check('tenant-a').allowed).toBe(true);
    expect(limiter.check('tenant-a').allowed).toBe(false);

    // The whole point: tenant B is unaffected by tenant A's flood.
    expect(limiter.check('tenant-b').allowed).toBe(true);
  });

  it('frees a slot once the window has passed', () => {
    let now = 0;
    const limiter = new TenantRateLimiter(
      { ...POLICY, maxRequestsPerWindow: 1, windowMs: 1_000 },
      () => now,
    );

    expect(limiter.check('t').allowed).toBe(true);
    expect(limiter.check('t').allowed).toBe(false);

    now = 1_001;
    expect(limiter.check('t').allowed).toBe(true);
  });

  it('reports how long to wait, so the UI can say something useful', () => {
    let now = 0;
    const limiter = new TenantRateLimiter(
      { ...DEFAULT_AI_POLICY, maxRequestsPerWindow: 1, windowMs: 60_000 },
      () => now,
    );
    limiter.check('t');
    now = 15_000;

    const decision = limiter.check('t');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.retryAfterMs).toBe(45_000);
  });
});

describe('redactForProvider (§7.5)', () => {
  it('removes an API key and says which kind it removed', () => {
    const result = redactForProvider({ prompt: 'use sk-abcdefghijklmnopqrstuvwxyz' });
    expect(JSON.stringify(result.value)).not.toContain('sk-abcdefghij');
    expect(result.redacted).toContain('apiKey');
  });

  it('removes a whole JWT rather than leaving its tail behind', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gF';
    const result = redactForProvider(`Authorization: ${jwt}`);
    expect(JSON.stringify(result.value)).not.toContain('eyJzdWIi');
    expect(result.redacted).toContain('jwt');
  });

  it('removes an email address, because a scene summary should not carry one', () => {
    const result = redactForProvider({ objectName: 'Crate for aditya@example.com' });
    expect(JSON.stringify(result.value)).not.toContain('aditya@example.com');
    expect(result.redacted).toContain('email');
  });

  it('walks nested objects and arrays, not only the top level', () => {
    const result = redactForProvider({
      messages: [{ content: [{ text: 'Bearer eyJhbGciOi.eyJzdWIi.c2ln' }] }],
    });
    expect(JSON.stringify(result.value)).not.toContain('eyJhbGciOi');
    expect(result.redacted.length).toBeGreaterThan(0);
  });

  it('leaves ordinary prose alone', () => {
    const result = redactForProvider({ objectName: 'Wooden crate, 1m, beside the table' });
    expect(result.value).toEqual({ objectName: 'Wooden crate, 1m, beside the table' });
    expect(result.redacted).toEqual([]);
  });

  it('finds a match on the second consecutive call, not only the first', () => {
    // A shared /g regex carries `lastIndex` between uses; without the reset, the second call would
    // skip its match and the payload would leave with the address still in it.
    expect(redactForProvider('aditya@example.com').redacted).toContain('email');
    expect(redactForProvider('someone@example.com').redacted).toContain('email');
  });
});

describe('withTimeout', () => {
  it('aborts the work and reports a timeout rather than hanging', async () => {
    await expect(withTimeout(20, 'test call', () => new Promise<never>(() => {}))).rejects.toThrow(
      /did not complete within 20ms/,
    );
  });

  it('passes the signal down, so the caller can cancel the actual request', async () => {
    let observed: AbortSignal | undefined;
    await withTimeout(50, 'test', async (signal) => {
      observed = signal;
      return 1;
    });
    expect(observed).toBeInstanceOf(AbortSignal);
  });
});

describe('classifyStatus', () => {
  it('maps a status onto the failure taxonomy callers branch on', () => {
    expect(classifyStatus(401)).toBe('UNAUTHORIZED');
    expect(classifyStatus(429)).toBe('RATE_LIMITED');
    expect(classifyStatus(400)).toBe('INVALID_REQUEST');
    // 529 is Anthropic's "overloaded" and belongs with 5xx, not in a case of its own.
    expect(classifyStatus(529)).toBe('PROVIDER_ERROR');
  });
});
