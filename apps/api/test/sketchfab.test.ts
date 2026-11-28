import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { sketchfabModelId, modelAllowsAi } from '@void-space/types';
import { UnauthenticatedError } from '../src/lib/errors';
import { envSchema } from '../src/env';
import { sealedCookie, sketchfabRoutes, sketchfabModel } from '../src/modules/tools/sketchfab';
import { sketchfabArchiveToGlb } from '../src/modules/tools/sketchfab-archive';

const uid = '0123456789abcdef0123456789abcdef';
const env = envSchema.parse({
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  PLATFORM_DATABASE_URL: 'postgresql://test:test@localhost/test',
  REDIS_URL: 'redis://localhost',
  JWT_ACCESS_SECRET: 'test-access-secret-value',
  JWT_REFRESH_SECRET: 'test-refresh-secret-value',
  COOKIE_SECURE: 'false',
  SKETCHFAB_CLIENT_ID: 'client',
  SKETCHFAB_CLIENT_SECRET: 'private',
  SKETCHFAB_REDIRECT_URI: 'http://localhost:3000/api/v1/tools/sketchfab/callback',
  SKETCHFAB_WEB_ORIGIN: 'http://localhost:3000',
});
const model = {
  uid,
  name: 'Test model',
  user: { displayName: 'Creator' },
  license: { label: 'CC BY' },
  isDownloadable: true,
};
const glb = sketchfabArchiveToGlb(
  zipSync({
    'scene.gltf': strToU8(
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'mesh.bin', byteLength: 4 }],
        bufferViews: [{ buffer: 0, byteLength: 4 }],
      }),
    ),
    'mesh.bin': new Uint8Array([0, 1, 2, 3]),
  }),
);
async function setup(fetchImpl: typeof fetch, configured = true) {
  const app = Fastify();
  await app.register(cookie);
  app.decorate('authenticate', async (request: any) => {
    if (!request.headers['x-user']) throw new UnauthenticatedError();
    request.principal = {
      tenantId: 'tenant',
      userId: request.headers['x-user'],
      permissions: ['asset:upload-own'],
    };
  });
  app.decorate('requirePermission', () => app.authenticate);
  await app.register(sketchfabRoutes, {
    prefix: '/api/v1',
    env: configured ? env : { ...env, SKETCHFAB_CLIENT_ID: undefined },
    fetchImpl,
  });
  return app;
}
const headers = { 'x-user': 'user' };
const credentials = () =>
  sealedCookie(env.JWT_REFRESH_SECRET, 'credentials').seal({
    actor: 'tenant:user',
    token: 'user-oauth-secret',
    expires: Date.now() + 60000,
  });

describe('Sketchfab model links', () => {
  it('chooses a crisp card preview instead of the smallest provider thumbnail', () => {
    expect(
      sketchfabModel({
        ...model,
        thumbnails: {
          images: [
            { url: 'https://media.sketchfab.com/tiny.jpg', width: 32 },
            { url: 'https://media.sketchfab.com/large.jpg', width: 1920 },
            { url: 'https://media.sketchfab.com/card.jpg', width: 640 },
          ],
        },
      }).thumbnail,
    ).toBe('https://media.sketchfab.com/card.jpg');
  });
  it('requires confirmed AI permission for imported Sketchfab models', () => {
    expect(modelAllowsAi(null)).toBe(true);
    expect(modelAllowsAi({ provenance: { provider: 'sketchfab' } })).toBe(false);
    expect(modelAllowsAi({ provenance: { provider: 'sketchfab', aiUseAllowed: false } })).toBe(
      false,
    );
    expect(modelAllowsAi({ provenance: { provider: 'sketchfab', aiUseAllowed: true } })).toBe(true);
  });
  it('normalizes links and rejects other hosts, protocols and credentials', () => {
    expect(sketchfabModelId(`https://sketchfab.com/3d-models/test-${uid}?foo=1`)).toBe(uid);
    expect(sketchfabModelId(`https://sketchfab.com/models/${uid}/embed`)).toBe(uid);
    for (const value of [
      `http://sketchfab.com/models/${uid}`,
      `https://sketchfab.com.evil.test/models/${uid}`,
      `https://evil@sketchfab.com/models/${uid}`,
      `https://sketchfab.com:8443/models/${uid}`,
      `https://sketchfab.com/3d-models/${uid}/extra`,
    ])
      expect(sketchfabModelId(value)).toBeNull();
  });
  it('encrypts, authenticates and separates state from provider credentials', () => {
    const codec = sealedCookie('test-secret', 'state');
    const value = codec.seal({ private: 'secret' });
    expect(value).not.toContain('secret');
    expect(codec.open(value)).toEqual({ private: 'secret' });
    expect(codec.open(value.slice(0, -6) + 'abcdef')).toBeNull();
    expect(sealedCookie('test-secret', 'credentials').open(value)).toBeNull();
  });
});

describe('Sketchfab routes', () => {
  it('requires app authentication, and reports registration honestly', async () => {
    const app = await setup(vi.fn(), false);
    try {
      expect((await app.inject('/api/v1/tools/sketchfab/status')).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/v1/tools/sketchfab/status', headers })).json()).toEqual(
        { configured: false, connected: false },
      );
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/tools/sketchfab/connect', headers }))
          .statusCode,
      ).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('binds connection cookies to the current tenant and user', async () => {
    const app = await setup(vi.fn());
    try {
      expect(
        (
          await app.inject({
            url: '/api/v1/tools/sketchfab/status',
            headers: { ...headers, cookie: `void_sketchfab=${credentials()}` },
          })
        ).json().connected,
      ).toBe(true);
      expect(
        (
          await app.inject({
            url: '/api/v1/tools/sketchfab/status',
            headers: { 'x-user': 'other', cookie: `void_sketchfab=${credentials()}` },
          })
        ).json().connected,
      ).toBe(false);
    } finally {
      await app.close();
    }
  });
  it('validates state before exchanging codes and stores tokens only in HttpOnly encrypted cookies', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'provider-secret', expires_in: 3600 })),
      );
    const app = await setup(fetcher);
    try {
      const start = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/sketchfab/connect',
        headers,
      });
      const state = new URL(start.json().url).searchParams.get('state')!;
      const stored = start.cookies.find((c) => c.name === 'void_sketchfab_state')!;
      expect(stored.httpOnly).toBe(true);
      const bad = await app.inject({
        url: `/api/v1/tools/sketchfab/callback?code=code&state=${state}`,
        headers,
      });
      expect(bad.statusCode).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
      const good = await app.inject({
        url: `/api/v1/tools/sketchfab/callback?code=code&state=${state}`,
        headers: { ...headers, cookie: `void_sketchfab_state=${stored.value}` },
      });
      expect(good.statusCode).toBe(302);
      expect(good.headers.location).toBe('http://localhost:3000/console/models');
      expect(good.cookies.find((c) => c.name === 'void_sketchfab')?.httpOnly).toBe(true);
      expect(JSON.stringify(good.headers)).not.toContain('provider-secret');
      expect(String(fetcher.mock.calls[0]![1].body)).toContain('grant_type=authorization_code');
    } finally {
      await app.close();
    }
  });
  it('rejects expired or cross-user callback state before contacting the provider', async () => {
    const fetcher = vi.fn();
    const app = await setup(fetcher);
    try {
      const codec = sealedCookie(env.JWT_REFRESH_SECRET, 'state');
      for (const actor of ['tenant:other', 'tenant:user']) {
        const state = codec.seal({
          actor,
          expires: actor.endsWith('other') ? Date.now() + 60000 : Date.now() - 1,
          nonce: 'test',
        });
        const result = await app.inject({
          url: `/api/v1/tools/sketchfab/callback?code=code&state=${state}`,
          headers: { ...headers, cookie: `void_sketchfab_state=${state}` },
        });
        expect(result.statusCode).toBe(403);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('handles cancellation and disconnect without exposing provider credentials', async () => {
    const fetcher = vi.fn();
    const app = await setup(fetcher);
    try {
      const start = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/sketchfab/connect',
        headers,
      });
      const state = new URL(start.json().url).searchParams.get('state')!;
      const result = await app.inject({
        url: `/api/v1/tools/sketchfab/callback?error=access_denied&state=${state}`,
        headers: { ...headers, cookie: `void_sketchfab_state=${start.cookies[0]!.value}` },
      });
      expect(result.headers.location).toBe(
        'http://localhost:3000/console/models?sketchfab=cancelled',
      );
      const disconnected = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/sketchfab/disconnect',
        headers,
      });
      expect(disconnected.json()).toEqual({ disconnected: true });
      expect(disconnected.cookies[0]!.value).toBe('');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('requires a fresh end-user connection and respects the author download setting', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ...model, isDownloadable: false })),
    );
    const app = await setup(fetcher);
    try {
      const missing = await app.inject({
        url: `/api/v1/tools/sketchfab/models/${uid}/download`,
        headers,
      });
      expect(missing.statusCode).toBe(409);
      expect(fetcher).not.toHaveBeenCalled();
      const denied = await app.inject({
        url: `/api/v1/tools/sketchfab/models/${uid}/download`,
        headers: { ...headers, cookie: `void_sketchfab=${credentials()}` },
      });
      expect(denied.statusCode).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  it('downloads via end-user OAuth and sends no credentials to the media host', async () => {
    const fetcher = vi.fn(async (url: any, init: any) => {
      if (String(url).endsWith('/download')) {
        expect(init.headers.Authorization).toBe('Bearer user-oauth-secret');
        return new Response(
          JSON.stringify({
            glb: { url: 'https://sketchfab-prod-media.s3.amazonaws.com/file.glb' },
          }),
        );
      }
      if (String(url).includes('s3.amazonaws.com')) {
        expect(init.headers).toBeUndefined();
        expect(init.redirect).toBe('error');
        return new Response(glb);
      }
      return new Response(JSON.stringify(model));
    });
    const app = await setup(fetcher);
    try {
      const response = await app.inject({
        url: `/api/v1/tools/sketchfab/models/${uid}/download`,
        headers: { ...headers, cookie: `void_sketchfab=${credentials()}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(glb);
      expect(response.headers['content-type']).toBe('model/gltf-binary');
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
  it('blocks provider download URLs to arbitrary hosts without fetching them', async () => {
    const fetcher = vi.fn(
      async (url: any) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/download')
              ? { gltf: { url: 'https://169.254.169.254/secret' } }
              : model,
          ),
        ),
    );
    const app = await setup(fetcher);
    try {
      const response = await app.inject({
        url: `/api/v1/tools/sketchfab/models/${uid}/download`,
        headers: { ...headers, cookie: `void_sketchfab=${credentials()}` },
      });
      expect(response.statusCode).toBe(400);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});

describe('Sketchfab archive conversion', () => {
  it('packs separate buffers and textures into an aligned self-contained GLB', () => {
    const result = sketchfabArchiveToGlb(
      zipSync({
        'model/scene.gltf': strToU8(
          JSON.stringify({
            asset: { version: '2.0' },
            buffers: [
              { uri: 'scene.bin', byteLength: 3 },
              { uri: 'extra.bin', byteLength: 2 },
            ],
            bufferViews: [{ buffer: 1, byteLength: 2 }],
            images: [{ uri: 'textures/map.png' }],
          }),
        ),
        'model/scene.bin': new Uint8Array([1, 2, 3]),
        'model/extra.bin': new Uint8Array([4, 5]),
        'model/textures/map.png': new Uint8Array([6, 7]),
      }),
    );
    expect(result.readUInt32LE(8)).toBe(result.length);
    const json = JSON.parse(result.subarray(20, 20 + result.readUInt32LE(12)).toString());
    expect(json.buffers).toEqual([{ byteLength: 12 }]);
    expect(json.bufferViews[0]).toEqual({ buffer: 0, byteLength: 2, byteOffset: 4 });
    expect(json.images[0]).toEqual({ bufferView: 1, mimeType: 'image/png' });
    expect(json.bufferViews[1].byteOffset).toBe(8);
  });
  it('rejects traversal, external resources, missing textures and multiple scene ambiguity', () => {
    const scene = (uri: string) =>
      strToU8(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri, byteLength: 1 }] }));
    for (const uri of ['../secret', 'https://example.com/file', 'missing.bin'])
      expect(() => sketchfabArchiveToGlb(zipSync({ 'scene.gltf': scene(uri) }))).toThrow();
    expect(() => sketchfabArchiveToGlb(zipSync({ '../secret': new Uint8Array([1]) }))).toThrow();
    expect(() =>
      sketchfabArchiveToGlb(zipSync({ 'a.gltf': scene('x'), 'b.gltf': scene('x') })),
    ).toThrow();
  });
});

it('refuses archives whose declared expansion exceeds the extraction limit', () => {
  const archive = Buffer.from(zipSync({ 'file.bin': new Uint8Array([1]) }));
  const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  archive.writeUInt32LE(300 * 1024 * 1024, central + 24);
  expect(() => sketchfabArchiveToGlb(archive)).toThrow('extraction limits');
});
