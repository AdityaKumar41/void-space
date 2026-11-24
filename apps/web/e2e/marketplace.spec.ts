import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { demoId } from '../../../packages/db/src/demo-ids';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });

test('public model, sign-in return, labelled demo checkout and entitled download', async ({
  page,
}) => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const assetId = randomUUID();
  const buyerTenant = demoId('tenant:aurora');
  const sellerTenant = demoId('tenant:northwind');
  let orderId: string | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const version = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${buyerTenant}, true)`;
      return tx.assetVersion.findFirstOrThrow({
        where: { ipfsCid: { not: null }, asset: { name: 'Cordless Impact Drill' } },
      });
    });
    await db.publicCatalogEntry.create({
      data: {
        assetId,
        tenantId: sellerTenant,
        tenantName: 'Northwind Safety XR',
        name: 'Checkout verification fixture',
        category: 'Tooling',
        tags: [],
        format: '.glb',
        sizeBytes: version.sizeBytes,
        ipfsCid: version.ipfsCid!,
        licenseType: 'Commercial',
        priceCents: 2500,
        currency: 'USD',
        publishedAt: new Date(),
      },
    });
    await page.goto(`/m/${assetId}`);
    await expect(
      page.getByRole('heading', { name: 'Checkout verification fixture', exact: true }),
    ).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByText(/\d+ tris decoded/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Sign in to purchase', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('creator@aurora.dev');
    await page.getByLabel('Password', { exact: true }).fill('VoidSpace!2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/m/${assetId}$`));
    await expect(
      page.getByText('Demo checkout · no payment will be collected.', { exact: true }),
    ).toBeVisible();
    const checkout = page.waitForResponse(
      (response) =>
        response.url().endsWith('/commerce/checkout') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Buy for / }).click();
    const response = await checkout;
    expect(response.status()).toBe(200);
    const result = await response.json();
    orderId = result.orderId;
    expect(result).toMatchObject({ provider: 'dev', status: 'paid', entitled: true });
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download the model', exact: true }).click();
    expect(await (await download).failure()).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    if (orderId) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${sellerTenant}, true)`;
        await tx.royaltyLedger.deleteMany({ where: { orderId } });
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${buyerTenant}, true)`;
        await tx.entitlement.deleteMany({ where: { assetId } });
        await tx.order.deleteMany({ where: { id: orderId } });
      });
    }
    await db.publicCatalogEntry.deleteMany({ where: { assetId } });
    await db.$disconnect();
  }
});
