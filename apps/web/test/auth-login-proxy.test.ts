import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../src/app/api/v1/auth/login/route';

describe('login API proxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes login requests and authentication cookies through to the API', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { email: 'creator@aurora.dev' } }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': 'vs_access=access-token; HttpOnly; Path=/',
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);

    const request = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'existing=session',
        'user-agent': 'VOID·SPACE test',
      },
      body: JSON.stringify({ email: 'creator@aurora.dev', password: 'valid-password' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('set-cookie')).toContain('vs_access=access-token');
    expect(await response.json()).toEqual({ user: { email: 'creator@aurora.dev' } });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4000/api/v1/auth/login');
    expect(options.method).toBe('POST');
    expect(options.cache).toBe('no-store');
    expect((options.headers as Headers).get('cookie')).toBe('existing=session');
    expect((options.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('returns a JSON 503 when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const response = await POST(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'creator@aurora.dev', password: 'valid-password' }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      statusCode: 503,
      code: 'AUTHENTICATION_UNAVAILABLE',
      message: 'The authentication service is temporarily unavailable. Please try again.',
    });
  });

  it('normalizes non-JSON upstream failures into a JSON error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Internal Server Error</html>', {
          status: 500,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    const response = await POST(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'creator@aurora.dev', password: 'valid-password' }),
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      statusCode: 500,
      code: 'AUTHENTICATION_UPSTREAM_ERROR',
      message: 'The authentication service returned an invalid response. Please try again.',
    });
  });
});
