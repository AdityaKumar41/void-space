/**
 * Tests for the VOID·SPACE client and its mock.
 *
 * These pin the three properties that are expensive to discover in production:
 *
 *   1. The API key is exchanged **once** and reused, including under concurrency — an API key has no
 *      rotation safety net, so a second exchange is not a retry, it is a second credential.
 *   2. A 401 triggers exactly one re-exchange and then surfaces the failure, rather than looping.
 *   3. The anonymous catalogue call carries **no** credential, because attaching a tenant to a
 *      request that deliberately has none is the one way this client could widen its own access.
 */
import type { CreateAssetMetadataInput } from '@void-space/types';
import { describe, expect, it } from 'vitest';

import { VoidSpaceClient } from '../src/client';
import { VoidSpaceError } from '../src/errors';
import { MockVoidSpaceClient } from '../src/mock';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetch(handler: (call: RecordedCall, index: number) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const call: RecordedCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return await handler(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function authHeader(call: RecordedCall): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.['authorization'];
}

const TOKEN_RESPONSE = {
  accessToken: 'tok-1',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'u1' },
};

function clientWith(impl: typeof fetch) {
  return new VoidSpaceClient({
    baseUrl: 'https://void.test',
    apiKey: 'vs_live_abcdefghijklmnopqrstuvwxyz',
    fetchImpl: impl,
    timeoutMs: 1_000,
  });
}

const GLB = { filename: 'crate.glb', contentType: 'model/gltf-binary', data: new Uint8Array([1, 2, 3]) };
/**
 * Typed as the shared input rather than `as const`: `as const` would make `tags` a readonly tuple,
 * which the mutable `string[]` the request schema expects rejects.
 */
const METADATA: CreateAssetMetadataInput = {
  name: 'Crate',
  category: 'Prop',
  tags: ['wood'],
  submitForReview: true,
};

describe('VoidSpaceClient — credential handling', () => {
  it('exchanges the API key once and reuses the token for later calls', async () => {
    const { impl, calls } = makeFetch((call) =>
      call.url.endsWith('/auth/token')
        ? json(TOKEN_RESPONSE)
        : json({ asset: { id: 'a1', status: 'pending' } }),
    );
    const client = clientWith(impl);

    await client.getAsset('a1');
    await client.getAsset('a1');

    const tokenCalls = calls.filter((call) => call.url.endsWith('/auth/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(authHeader(calls[1]!)).toBe('Bearer tok-1');
  });

  it('shares one exchange between concurrent callers', async () => {
    const { impl, calls } = makeFetch(async (call) => {
      if (call.url.endsWith('/auth/token')) {
        // A real exchange takes a round trip; the delay is what makes the race reproducible.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return json(TOKEN_RESPONSE);
      }
      return json({ asset: { id: 'a1', status: 'pending' } });
    });
    const client = clientWith(impl);

    await Promise.all([client.getAsset('a1'), client.getAsset('a1'), client.getAsset('a1')]);

    expect(calls.filter((call) => call.url.endsWith('/auth/token'))).toHaveLength(1);
  });

  it('re-exchanges once on a 401 and then succeeds', async () => {
    let tokenIssued = 0;
    const { impl, calls } = makeFetch((call) => {
      if (call.url.endsWith('/auth/token')) {
        tokenIssued += 1;
        return json({ ...TOKEN_RESPONSE, accessToken: `tok-${tokenIssued}` });
      }
      // The first read is rejected as though the token had just expired server-side.
      if (tokenIssued === 1) {
        return json({ code: 'TOKEN_INVALID', message: 'expired', requestId: 'r1' }, 401);
      }
      return json({ asset: { id: 'a1', status: 'approved' } });
    });

    const asset = await clientWith(impl).getAsset('a1');

    expect(asset.status).toBe('approved');
    expect(tokenIssued).toBe(2);
    // The *retried* asset read must carry the fresh token. Indexing by position would pass even if
    // the retry reused the stale one, so the assertion finds the last non-exchange call instead.
    const reads = calls.filter((call) => !call.url.endsWith('/auth/token'));
    expect(reads).toHaveLength(2);
    expect(authHeader(reads[1]!)).toBe('Bearer tok-2');
  });

  it('does not re-exchange when the API simply rejects the request', async () => {
    const { impl, calls } = makeFetch((call) =>
      call.url.endsWith('/auth/token')
        ? json(TOKEN_RESPONSE)
        : json({ code: 'INSUFFICIENT_PERMISSION', message: 'nope', requestId: 'r2' }, 403),
    );

    await expect(clientWith(impl).getAsset('a1')).rejects.toThrowError(/nope/);
    // Re-exchanging on a 403 would burn the rate limit to be told the same thing twice.
    expect(calls.filter((call) => call.url.endsWith('/auth/token'))).toHaveLength(1);
  });

  it('reports an unreachable API as a status-0 error rather than a credential failure', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const error = await clientWith(impl).getAsset('a1').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(VoidSpaceError);
    expect((error as VoidSpaceError).status).toBe(0);
    expect((error as VoidSpaceError).code).toBe('NETWORK_ERROR');
    // A blip says nothing about the credential, so the token must survive it.
    expect((error as VoidSpaceError).isCredentialFailure).toBe(false);
  });
});

describe('VoidSpaceClient — uploads and the public catalogue', () => {
  it('sends upload metadata before the file, and authenticated', async () => {
    const { impl, calls } = makeFetch((call) =>
      call.url.endsWith('/auth/token')
        ? json(TOKEN_RESPONSE)
        : json({ asset: { id: 'a1', status: 'pending' } }, 201),
    );

    await clientWith(impl).uploadAsset({ metadata: METADATA, file: GLB });

    const upload = calls.find((call) => call.url.endsWith('/api/v1/assets'));
    expect(upload).toBeDefined();
    expect(authHeader(upload!)).toBe('Bearer tok-1');
    expect((upload!.init.headers as Record<string, string>)['content-type']).toMatch(
      /^multipart\/form-data; boundary=/,
    );

    const text = new TextDecoder().decode(upload!.init.body as Uint8Array);
    expect(text.indexOf('name="name"')).toBeLessThan(text.indexOf('filename="crate.glb"'));
    // Arrays must be joined, not stringified — `[object Object]` here would look like a successful
    // upload that silently lost every tag.
    expect(text).toContain('wood');
  });

  it('replaces a version rather than creating a second asset (FR-14.4)', async () => {
    const { impl, calls } = makeFetch((call) =>
      call.url.endsWith('/auth/token')
        ? json(TOKEN_RESPONSE)
        : json({ asset: { id: 'a1', status: 'pending' } }, 201),
    );

    await clientWith(impl).replaceAssetVersion('a1', { file: GLB });

    expect(calls.some((call) => call.url.endsWith('/api/v1/assets/a1/versions'))).toBe(true);
  });

  it('sends no credential when browsing the anonymous catalogue (FR-15.2)', async () => {
    const { impl, calls } = makeFetch(() => json({ total: 0, limit: 24, offset: 0, items: [] }));

    const page = await clientWith(impl).browsePublicCatalog({ search: 'crate' });

    expect(page.total).toBe(0);
    // No token exchange at all: the catalogue endpoint is public, so authenticating would attach a
    // tenant context the request never asked for.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/v1/public/catalog?search=crate');
    expect(authHeader(calls[0]!)).toBeUndefined();
  });

  it('surfaces the API error code and request id, not just the message', async () => {
    const { impl } = makeFetch((call) =>
      call.url.endsWith('/auth/token')
        ? json(TOKEN_RESPONSE)
        : json(
            {
              statusCode: 403,
              error: 'Forbidden',
              code: 'INSUFFICIENT_PERMISSION',
              message: 'Missing permission: asset:upload-own',
              details: { required: 'asset:upload-own' },
              requestId: 'req-99',
              timestamp: '2026-09-21T09:12:44.031Z',
            },
            403,
          ),
    );

    const error = (await clientWith(impl)
      .getAsset('a1')
      .catch((cause: unknown) => cause)) as VoidSpaceError;

    expect(error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(error.requestId).toBe('req-99');
    expect(error.details).toEqual({ required: 'asset:upload-own' });
    // A validation or permission failure fails identically on retry, so it must not be marked
    // retryable — the publish path relies on this to avoid re-uploading in a loop.
    expect(error.isRetryable).toBe(false);
  });
});


describe('MockVoidSpaceClient', () => {
  const MANIFEST: CreateAssetMetadataInput = {
    name: 'Crate',
    category: 'Prop',
    tags: [],
    submitForReview: true,
  };

  it('lands an upload as pending, not published', async () => {
    const mock = new MockVoidSpaceClient();
    const asset = await mock.uploadAsset({ metadata: MANIFEST, file: GLB });

    expect(asset.status).toBe('pending');
    expect(asset.license).toBeNull();
    expect(asset.canDelete).toBe(true);
  });

  it('walks the review lifecycle and mints a licence only at publish', async () => {
    const mock = new MockVoidSpaceClient();
    const upload = await mock.uploadAsset({ metadata: MANIFEST, file: GLB });

    const approved = mock.decide(upload.id, 'approved');
    expect(approved.status).toBe('approved');
    expect(approved.decisions).toHaveLength(1);
    // Still no licence: on the real platform the mint is a worker step after approval (SDD §2.6).
    expect(approved.license).toBeNull();

    const published = mock.publish(upload.id);
    expect(published.status).toBe('published');
    expect(published.license?.status).toBe('active');
    // FR-3.6: an asset carrying a licence cannot be deleted, and the flag the UI reads says so.
    expect(published.canDelete).toBe(false);
    expect(published.canRevoke).toBe(true);
  });

  it('requires a reason for a rejection or a revision, as the real API does', async () => {
    const mock = new MockVoidSpaceClient();
    const upload = await mock.uploadAsset({ metadata: MANIFEST, file: GLB });

    expect(() => mock.decide(upload.id, 'rejected')).toThrowError(/requires a comment/);
    const revised = mock.decide(upload.id, 'revision', 'Polycount too high for XR');
    expect(revised.status).toBe('revision');
    expect(revised.decisions[0]?.comment).toBe('Polycount too high for XR');
  });

  it('stops waiting once the asset reaches a terminal state', async () => {
    const mock = new MockVoidSpaceClient();
    const upload = await mock.uploadAsset({ metadata: MANIFEST, file: GLB });

    const pending = mock.waitForAssetStatus(upload.id, { intervalMs: 1, timeoutMs: 500 });
    mock.decide(upload.id, 'rejected', 'Does not match the brief');
    await pending;

    expect((await mock.getAsset(upload.id)).status).toBe('rejected');
  });

  it('hides non-published assets from the anonymous catalogue', async () => {
    const mock = new MockVoidSpaceClient();
    const upload = await mock.uploadAsset({ metadata: MANIFEST, file: GLB });

    expect((await mock.browsePublicCatalog()).total).toBe(0);

    mock.publish(upload.id);
    const page = await mock.browsePublicCatalog();
    expect(page.total).toBe(1);
    expect(page.items[0]?.assetId).toBe(upload.id);
  });

  it('keeps the previous version and retires its `isCurrent` flag on re-publish', async () => {
    const mock = new MockVoidSpaceClient();
    const upload = await mock.uploadAsset({ metadata: MANIFEST, file: GLB });

    const republished = await mock.replaceAssetVersion(upload.id, { file: GLB });

    expect(republished.versions).toHaveLength(2);
    expect(republished.versions.filter((version) => version.isCurrent)).toHaveLength(1);
    expect(republished.versions[1]?.versionNumber).toBe(2);
    // Re-publishing returns the asset to review; it is not a silent live edit.
    expect(republished.status).toBe('pending');
  });
});

