import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env';

const required = {
  DATABASE_URL: 'postgresql://localhost/voidspace',
  PLATFORM_DATABASE_URL: 'postgresql://localhost/voidspace',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-16',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16',
};

const production = {
  ...required,
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  PUBLIC_WEB_ORIGIN: 'https://learn.example.test',
  CORS_ORIGINS: 'https://learn.example.test',
  S3_BUCKET: 'void-production-tests',
};

describe('loadEnv local chain defaults', () => {
  it('uses local Anvil when the Fuji RPC is absent or blank', () => {
    const env = loadEnv({
      ...required,
      NODE_ENV: 'development',
      CHAIN_RPC_URL: '',
      CHAIN_ID: '43113',
    });

    expect(env.CHAIN_RPC_URL).toBe('http://localhost:8545');
    expect(env.CHAIN_ID).toBe(31337);
    expect(env.CONTRACT_ADDRESS).toBeUndefined();
  });

  it('boots production learning without an optional licensing service', () => {
    expect(loadEnv({ ...production, NODE_ENV: 'production' }).CONTRACT_ADDRESS).toBeUndefined();
  });

  it('requires explicit chain configuration when production licensing is enabled', () => {
    expect(() =>
      loadEnv({ ...required, NODE_ENV: 'production', CONTRACT_ADDRESS: `0x${'a'.repeat(40)}` }),
    ).toThrow('production requires explicit CHAIN_RPC_URL and CHAIN_ID configuration');
  });
});

describe('Text AI environment', () => {
  it('supports blank optional provider settings and validates protocol and timeout', () => {
    const env = loadEnv({
      ...required,
      AI_BASE_URL: '',
      AI_TEXT_BASE_URL: '',
      OPENROUTER_API_KEY: '',
    });
    expect(env.AI_TEXT_BASE_URL).toBeUndefined();
    expect(env.AI_TEXT_PROTOCOL).toBe('auto');
    expect(() => loadEnv({ ...required, AI_TEXT_PROTOCOL: 'unknown' })).toThrow('AI_TEXT_PROTOCOL');
    expect(() => loadEnv({ ...required, AI_TEXT_TIMEOUT_MS: '0' })).toThrow('AI_TEXT_TIMEOUT_MS');
  });
});

describe('production configuration safeguards', () => {
  it('rejects demo secrets, insecure cookies and absent object storage', () => {
    expect(() =>
      loadEnv({
        ...production,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me',
      }),
    ).toThrow('JWT_ACCESS_SECRET');
    expect(() =>
      loadEnv({ ...production, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrow('COOKIE_SECURE');
    expect(() => loadEnv({ ...production, NODE_ENV: 'production', S3_BUCKET: '' })).toThrow('S3');
    expect(() =>
      loadEnv({ ...production, NODE_ENV: 'production', PUBLIC_WEB_ORIGIN: 'https://localhost' }),
    ).toThrow('PUBLIC_WEB_ORIGIN');
  });
});
