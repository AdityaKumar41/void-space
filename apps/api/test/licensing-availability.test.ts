import { expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { buildApp } from '../src/app';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login } from './helpers';

it('rejects unconfigured licence publication without queuing a doomed mint', async () => {
  const context = await createTestApp();
  const app = await buildApp({ ...context.env, CONTRACT_ADDRESS: undefined, CHAIN_ID: 31337 });
  let assetId: string | undefined;
  try {
    await app.ready();
    const signed = await login(app, DEMO.users.auroraAssessor);
    const cookie = cookieHeader(signed.cookies, 'vs_access');
    const user = (await app.inject({ url: '/api/v1/auth/me', headers: { cookie } })).json().user;
    assetId = await withTenant(DEMO_TENANT_IDS.aurora, async (db) => {
      const asset = await db.asset.create({
        data: {
          tenantId: DEMO_TENANT_IDS.aurora,
          creatorId: user.id,
          name: 'Licence availability fixture',
          category: 'Tooling',
          tags: [],
          status: 'approved',
        },
      });
      const version = await db.assetVersion.create({
        data: {
          tenantId: DEMO_TENANT_IDS.aurora,
          assetId: asset.id,
          createdById: user.id,
          versionNumber: 1,
          format: '.glb',
          sizeBytes: 100n,
          pinStatus: 'pinned',
          ipfsCid: 'bafylicenceavailabilityfixture',
        },
      });
      await db.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });
      return asset.id;
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/assets/${assetId}/publish`,
      headers: { cookie },
      payload: { licenseType: 'Internal-Only', publishToXr: false },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('LICENSING_UNAVAILABLE');
    expect(
      await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
        db.job.count({ where: { entityId: assetId, queue: 'chain_license' } }),
      ),
    ).toBe(0);
  } finally {
    if (assetId)
      await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
        db.asset.deleteMany({ where: { id: assetId } }),
      );
    await app.close();
    await context.close();
  }
});
