import { expect, test, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { demoId } from '../../../packages/db/src/demo-ids';
import { loadRootEnv } from '../../../packages/db/src/env';
import { buildGlbFixture } from '../../../packages/db/src/glb-fixture';
loadRootEnv({ override: false });
const tenantId = demoId('tenant:aurora');

// Authenticate once for these feature journeys, respecting the production sign-in rate limit.
// Each test receives its own browser context with a copy of the cookie; no tokens are written to disk.
let signInCookies: Awaited<ReturnType<BrowserContext['cookies']>>;
test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/login`);
    await page.getByLabel('Email', { exact: true }).fill('creator@aurora.dev');
    await page.getByLabel('Password', { exact: true }).fill('VoidSpace!2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ask AI', exact: true })).toBeVisible();
    signInCookies = await context.cookies();
  } finally {
    await context.close();
  }
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(signInCookies);
});

test('equipment registration, twin creation and authenticated readings are usable from the UI', async ({
  page,
}) => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let deviceId: string | undefined;
  const label = `Equipment workflow ${Date.now()}`;
  try {
    await page.goto('/console/twins');
    await page.getByLabel('Equipment label', { exact: true }).fill(label);
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    const credentials = page
      .getByText('Save these credentials now. The secret is never shown again.')
      .locator('..');
    await expect(credentials).toBeVisible();
    await expect(credentials.locator('code')).toHaveCount(2);
    // Read only this test's one-time credentials; never log or persist the secret.
    const codes = await credentials.locator('code').allTextContents();
    deviceId = codes[0]!;
    const deviceSecret = codes[1]!;
    await page.getByLabel('Twin label', { exact: true }).fill('Live temperature twin');
    await page.getByRole('button', { name: 'Create twin', exact: true }).click();
    const card = page
      .getByRole('heading', { name: label, exact: true })
      .locator('..')
      .locator('..');
    await expect(
      card.getByRole('heading', { name: 'Live temperature twin', exact: true }),
    ).toBeVisible();
    const sent = await page.request.post('/api/v1/iot/telemetry', {
      headers: { 'x-device-id': deviceId, 'x-device-secret': deviceSecret },
      data: { payload: { temperature: 24, workflow: label } },
    });
    expect(sent.status()).toBe(202);
    await expect(card.getByText(/"temperature": 24/)).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'View telemetry', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: new RegExp(`Telemetry history`) }),
    ).toBeVisible();
    await expect(page.getByText(/"temperature": 24/)).toHaveCount(2);
    await page.reload();
    await expect(
      card.getByRole('heading', { name: 'Live temperature twin', exact: true }),
    ).toBeVisible();
  } finally {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await tx.ioTDevice.deleteMany({ where: { tenantId, label } });
    });
    await db.$disconnect();
  }
});

test('a real upload is processed by the worker, pinned to IPFS and renders again', async ({
  page,
}) => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const title = `Ingest workflow ${Date.now()}`;
  let assetId: string | undefined;
  try {
    await page.goto('/console/library');
    await page.getByRole('button', { name: 'Ingest an asset', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'verification.glb',
      mimeType: 'model/gltf-binary',
      buffer: buildGlbFixture(2500),
    });
    await page.getByLabel('Name', { exact: true }).fill(title);
    await page.getByLabel('Submit for review on upload', { exact: false }).uncheck();
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/assets') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ingest asset', exact: true }).click();
    const uploaded = await response;
    expect(uploaded.status()).toBe(201);
    assetId = (await uploaded.json()).asset.id;
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/v1/assets/${assetId}`)).json()).asset.currentVersion
            .pinStatus,
        { timeout: 60_000 },
      )
      .toBe('pinned');
    const asset = (await (await page.request.get(`/api/v1/assets/${assetId}`)).json()).asset;
    const bytes = await page.request.get(`/ipfs/${asset.currentVersion.ipfsCid}`);
    expect(bytes.status()).toBe(200);
    expect((await bytes.body()).subarray(0, 4).toString()).toBe('glTF');
    await page.goto(`/console/assets/${assetId}`);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByText(/2,500 tris decoded/)).toBeVisible({ timeout: 30_000 });
  } finally {
    if (assetId)
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const asset = await tx.asset.findFirst({
          where: { id: assetId },
          select: { versions: { select: { id: true } } },
        });
        await tx.job.deleteMany({
          where: {
            entityId: { in: [assetId!, ...(asset?.versions.map((version) => version.id) ?? [])] },
          },
        });
        await tx.asset.deleteMany({ where: { id: assetId } });
      });
    await db.$disconnect();
  }
});
