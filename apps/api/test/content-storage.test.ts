import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, prisma } from '@void-space/db';
import { assetObjectKey, assetStore, storeAssetBytes } from '@void-space/storage';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';
let ctx: TestApp,
  owner = '',
  other = '',
  address = '',
  assetId = randomUUID();
const tenant = DEMO_TENANT_IDS.aurora;
const bytes = Buffer.from('private content storage regression ' + randomUUID());
beforeAll(async () => {
  ctx = await createTestApp();
  owner = cookieHeader((await login(ctx.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
  other = cookieHeader((await login(ctx.app, DEMO.users.northwindAdmin)).cookies, 'vs_access');
  address = (await storeAssetBytes(bytes)).cid;
  await withTenant(tenant, async (db) => {
    const creator = await db.user.findFirstOrThrow({ where: { email: DEMO.users.auroraCreator } });
    await db.asset.create({
      data: {
        id: assetId,
        tenantId: tenant,
        creatorId: creator.id,
        name: 'Storage QA',
        category: 'QA',
      },
    });
    await db.assetVersion.create({
      data: {
        assetId,
        tenantId: tenant,
        versionNumber: 1,
        format: '.glb',
        sizeBytes: BigInt(bytes.length),
        ipfsCid: address,
        pinStatus: 'pinned',
      },
    });
  });
});
afterAll(async () => {
  if (ctx) {
    await prisma.publicCatalogEntry.deleteMany({ where: { assetId } });
    await withTenant(tenant, (db) => db.asset.deleteMany({ where: { id: assetId } }));
    if (address) await assetStore().delete(assetObjectKey(address));
    await ctx.close();
  }
});
const read = (cookie = '', range?: string) =>
  ctx.app.inject({
    url: `/api/v1/content/${address}`,
    headers: { ...(cookie ? { cookie } : {}), ...(range ? { range } : {}) },
  });
describe('S3 asset gateway', () => {
  it('denies anonymous and other-workspace reads of private model bytes', async () => {
    expect((await read()).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `/api/v1/content/${address}/access` })).statusCode).toBe(
      404,
    );
    expect((await read(other)).statusCode).toBe(404);
  });
  it('serves exact bytes and ranges to the authorized owner without shared caching', async () => {
    const full = await read(owner);
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload).toEqual(bytes);
    expect(full.headers['cache-control']).toBe('private, no-store');
    const partial = await read(owner, 'bytes=0-6');
    expect(partial.statusCode).toBe(206);
    expect(partial.rawPayload).toEqual(bytes.subarray(0, 7));
    expect(partial.headers['content-range']).toBe(`bytes 0-6/${bytes.length}`);
    expect((await read(owner, 'bytes=99999-')).statusCode).toBe(416);
  });
  it('serves published content anonymously and immediately revokes access at takedown', async () => {
    await prisma.publicCatalogEntry.create({
      data: {
        assetId,
        tenantId: tenant,
        tenantName: 'QA',
        name: 'Storage QA',
        category: 'QA',
        format: '.glb',
        sizeBytes: BigInt(bytes.length),
        ipfsCid: address,
        licenseType: 'CC0',
        publishedAt: new Date(),
      },
    });
    expect((await read()).rawPayload).toEqual(bytes);
    expect((await read('vs_access=expired-session')).rawPayload).toEqual(bytes);
    await prisma.publicCatalogEntry.deleteMany({ where: { assetId } });
    expect((await read()).statusCode).toBe(404);
  });
  it('does not mount retired applications or integration adapters', async () => {
    for (const url of [
      '/api/v1/career',
      '/api/v1/ventures',
      '/api/v1/learning/classes',
      '/api/v1/learning/activities',
      '/api/v1/learning/programs',
      '/api/v1/tools/integrations',
    ])
      expect((await ctx.app.inject({ url, headers: { cookie: owner } })).statusCode, url).toBe(404);
  });
});
