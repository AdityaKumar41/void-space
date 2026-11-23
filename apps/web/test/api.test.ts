import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, apiDownload } from '../src/lib/api';

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

describe('binary model downloads', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns binary content without attempting JSON parsing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'model/gltf-binary' },
          }),
        ),
    );
    expect(
      new Uint8Array(
        await (await apiDownload('/tools/sketchfab/models/id/download')).arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('reports the API account-connection error consistently', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              code: 'SKETCHFAB_CONNECT_REQUIRED',
              message: 'Connect Sketchfab first',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        ),
    );
    await expect(apiDownload('/tools/sketchfab/models/id/download')).rejects.toMatchObject({
      status: 409,
      code: 'SKETCHFAB_CONNECT_REQUIRED',
      message: 'Connect Sketchfab first',
    });
  });
});
