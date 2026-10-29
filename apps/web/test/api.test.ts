import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, apiFetch } from '../src/lib/api';

describe('apiFetch error responses', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns a plain-text upstream failure into a readable API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Internal Server Error', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );

    await expect(apiFetch('/health')).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 502,
      message: 'The API returned a non-JSON error response (502) for /health',
    });
  });

  it('preserves structured API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code: 'NOT_FOUND', message: 'Missing' }, { status: 404 }),
        ),
    );

    await expect(apiFetch('/health')).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 404,
      message: 'Missing',
    });
  });
});
