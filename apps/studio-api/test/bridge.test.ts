import './env';

import { MockVoidSpaceClient } from '@void-space/voidspace-client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from './harness';

/**
 * The §6.4 route surface, over real HTTP through the Fastify instance, with `VOIDSPACE_CLIENT_MODE=mock`.
 *
 * This is the suite that would have caught the mistakes the unit tests cannot: a route registered
 * under the wrong prefix, an envelope the editor's error handling does not recognise, or a payload
 * whose shape the panel does not match. It runs with no database and no VOID·SPACE, which is what
 * §9.1 asks for — the read/browse surface is exercisable from a clean checkout.
 *
 * The authenticated project routes are deliberately not exercised past their rejection paths: they
 * issue a query, and a suite that needs rows belongs against a migrated database rather than being
 * faked here. What is asserted is that the rejection happens *before* any query, which is the property
 * that keeps an unauthenticated request cheap.
 *
 * The simulator is stateful, so the last case is ordered after the ones that expect an empty
 * catalogue.
 */
describe('the Studio API surface', () => {
  let app: FastifyInstance;
  let gateway: MockVoidSpaceClient;

  beforeAll(async () => {
    const built = await buildTestApp();
    app = built.app;
    gateway = built.bridge.gateway as MockVoidSpaceClient;
  });

  afterAll(async () => {
    await app.close();
  });

  it('describes itself as the control plane behind /studio/api/v1', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.service).toBe('VOID·STUDIO API');
    // Deliberately not VOID·SPACE's /api/v1 — a shared prefix is how two products end up proxying
    // each other's routes.
    expect(body.prefix).toBe('/studio/api/v1');
    expect(body.voidspace).toEqual({ mode: 'mock', apiBaseUrl: '(in-process mock)' });
  });

  it('reports VOID·SPACE reachability as part of its own health', async () => {
    const response = await app.inject({ method: 'GET', url: '/studio/api/v1/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('void-studio-api');
    expect(body.dependencies.voidspace.status).toBe('up');
    expect(body.dependencies.voidspace.mode).toBe('mock');
    expect(body.dependencies.publishCredential).toBe('configured');
  });

  it('reports where VOID·SPACE is and what the editor should poll at', async () => {
    const response = await app.inject({ method: 'GET', url: '/studio/api/v1/voidspace/status' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mode).toBe('mock');
    expect(body.apiBaseUrl).toBe('(in-process mock)');
    expect(body.reachable).toBe(true);
    expect(body.links.consoleUrl).toBe('https://void.example');
    expect(body.publish).toEqual({ enabled: true, requirement: null, pollIntervalMs: 30_000 });
    // Nothing has been published into the simulator yet.
    expect(body.catalog.publishedAssets).toBe(0);
    expect(body.provenance).toBeNull();
  });

  it('browses the catalogue anonymously, with a destination per row (FR-15.2)', async () => {
    const response = await app.inject({ method: 'GET', url: '/studio/api/v1/voidspace/catalog' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
    expect(body.consoleUrl).toBe('https://void.example');
  });

  it('rejects an out-of-range query with the shared error envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/studio/api/v1/voidspace/catalog?limit=999',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.issues[0].path).toBe('limit');
    // Correlates a Creator's report with the server log line for the same request.
    expect(body.requestId).toBeTruthy();
  });

  it('refuses a protected route with no VOID·SPACE session, before any query', async () => {
    const response = await app.inject({ method: 'GET', url: '/studio/api/v1/projects' });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(body.message).toContain('VOID·SPACE');
    expect(body.requestId).toBeTruthy();
  });

  it('refuses a token it cannot verify', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/studio/api/v1/projects',
      headers: { authorization: 'Bearer not.a.real.token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('mirrors the publish lifecycle the simulator models (FR-14.2/14.3)', async () => {
    const uploaded = await gateway.uploadAsset({
      metadata: { name: 'Cargo Crate', category: 'Prop', tags: [], submitForReview: true },
      file: {
        filename: 'crate.glb',
        contentType: 'model/gltf-binary',
        data: new Uint8Array([1, 2, 3, 4]),
      },
    });

    /*
     * An upload lands `pending`, not `published`: the licence is minted by a worker (SDD §2.6), so a
     * mock that jumped straight to published would train the Studio's status strip on a future it never
     * sees. The catalogue therefore stays empty until the review completes.
     */
    const pending = (
      await app.inject({ method: 'GET', url: '/studio/api/v1/voidspace/catalog' })
    ).json();
    expect(pending.total).toBe(0);

    gateway.decide(uploaded.id, 'approved');
    gateway.publish(uploaded.id);

    const catalog = (
      await app.inject({ method: 'GET', url: '/studio/api/v1/voidspace/catalog' })
    ).json();
    expect(catalog.total).toBe(1);
    expect(catalog.items[0].name).toBe('Cargo Crate');
    // The URL is the Studio's own addition, so a catalogue row is followable rather than a dead end.
    expect(catalog.items[0].url).toBe(`https://void.example/catalog/${uploaded.id}`);

    const status = (
      await app.inject({ method: 'GET', url: '/studio/api/v1/voidspace/status' })
    ).json();
    expect(status.catalog.publishedAssets).toBe(1);
    expect(status.catalog.categories).toEqual(['Prop']);
    // Provenance comes from VOID·SPACE, never from the chain (§3.5.2): the Studio holds no chain
    // credential at all.
    expect(status.provenance.name).toBe('Cargo Crate');
    expect(status.provenance.tokenId).toBeTruthy();
    expect(status.provenance.url).toBe(`https://void.example/catalog/${uploaded.id}`);
  });

  it('answers /auth/session with unauthenticated state when no token is provided', async () => {
    const response = await app.inject({ method: 'GET', url: '/studio/api/v1/auth/session' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
  });
});

