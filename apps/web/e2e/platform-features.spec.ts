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
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Practice', exact: true })).toBeVisible();
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

test('venture plans preserve every field and owners can edit saved plans', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const title = `Venture workflow ${Date.now()}`;
  try {
    await page.goto('/console/ventures');
    await page.getByLabel('Venture title', { exact: true }).fill(title);
    await page
      .getByLabel('Customer problem', { exact: true })
      .fill('Teams need reliable evidence of maintenance training.');
    await page.getByLabel('Target customer', { exact: true }).fill('Maintenance teams');
    await page
      .getByLabel('Your solution', { exact: true })
      .fill('A reviewed model and repeatable guided practice.');
    await page.getByLabel('Next milestone', { exact: true }).fill('Run a pilot');
    await page.getByRole('button', { name: 'Save venture plan', exact: true }).click();
    const card = page.getByRole('heading', { name: title, exact: true }).locator('..');
    await expect(
      card.getByText('A reviewed model and repeatable guided practice.', { exact: true }),
    ).toBeVisible();
    await card.getByRole('button', { name: 'Edit plan', exact: true }).click();
    await expect(page.getByLabel('Customer problem', { exact: true })).toHaveValue(
      'Teams need reliable evidence of maintenance training.',
    );
    await page.getByLabel('Next milestone', { exact: true }).fill('Complete the first pilot');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(card.getByText('Complete the first pilot', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Complete the first pilot', { exact: true })).toBeVisible();
    await page.goto('/console/help');
    await expect(
      page.getByRole('heading', { name: 'Find your next step', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Account and wallets', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Account and wallets', exact: true }),
    ).toBeVisible();
  } finally {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await tx.venturePlan.deleteMany({ where: { tenantId, title } });
    });
    await db.$disconnect();
  }
});

test('a QR field-guide link survives sign-in and can be completed and left', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let guideId: string | undefined;
  const title = `Guide workflow ${Date.now()}`;
  try {
    await page.goto('/console');
    await expect(page.getByRole('link', { name: 'Field guides', exact: true })).toBeVisible();
    const lessons = await (await page.request.get('/api/v1/lessons')).json();
    expect(lessons.lessons.length).toBeGreaterThan(0);
    const created = await page.request.post('/api/v1/field-guides', {
      data: {
        title,
        description: 'Read and acknowledge each instruction for the verification workflow.',
        lessonId: lessons.lessons[0].id,
        steps: [
          {
            id: 'inspect',
            instruction: 'Inspect the reviewed component.',
            safetyNote: 'Stop if the component does not match.',
          },
          { id: 'record', instruction: 'Record the inspection outcome.' },
        ],
      },
    });
    expect(created.status()).toBe(201);
    guideId = (await created.json()).guide.id;
    expect((await page.request.post(`/api/v1/field-guides/${guideId}/publish`)).status()).toBe(200);
    await page.context().clearCookies();
    await page.goto(`/console/field-guides?guide=${guideId}`);
    expect(new URL(page.url()).searchParams.get('next')).toBe(
      `/console/field-guides?guide=${guideId}`,
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByText('Stop if the component does not match.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Acknowledge and continue', exact: true }).click();
    await page.getByRole('button', { name: 'Acknowledge and complete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Guide completed', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to field guides', exact: true }).click();
    await expect(page).not.toHaveURL(/guide=/);
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Acknowledge and complete', exact: true }),
    ).toHaveCount(0);
    await page.goto('/console/career');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  } finally {
    if (guideId)
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx.fieldGuide.deleteMany({ where: { id: guideId } });
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

test('a program can be authored, released, enrolled in and opened at its lesson', async ({
  page,
}) => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const title = `Program workflow ${Date.now()}`;
  let courseId: string | undefined;
  try {
    await page.goto('/console/campus');
    await expect(
      page.getByRole('heading', { name: 'Your learning programs', exact: true }),
    ).toBeVisible();
    const lessons = (await (await page.request.get('/api/v1/lessons')).json()).lessons;
    expect(lessons.length).toBeGreaterThan(0);
    const lesson = lessons[0];
    await page.getByText('Build a program', { exact: true }).click();
    await page.getByLabel('Program title', { exact: true }).fill(title);
    await page.getByLabel('Program slug', { exact: true }).fill(`program-workflow-${Date.now()}`);
    await page
      .getByLabel('Program description', { exact: true })
      .fill('Follow the published source lesson and record passing evidence.');
    await page.getByRole('checkbox', { name: lesson.title, exact: true }).check();
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/courses') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create draft program', exact: true }).click();
    const created = await response;
    expect(created.status()).toBe(201);
    courseId = (await created.json()).course.id;
    const card = page.getByRole('heading', { name: title, exact: true }).locator('../..');
    await card.getByRole('button', { name: 'Publish program', exact: true }).click();
    await card.getByRole('button', { name: 'Enroll', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Enroll', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(card.getByRole('button', { name: 'Enroll', exact: true })).toHaveCount(0);
    await card.getByRole('link').click();
    await expect(page.getByRole('heading', { name: lesson.title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: '← All lessons', exact: true }).click();
    await expect(page).not.toHaveURL(/lesson=/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible();
  } finally {
    if (courseId)
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx.course.deleteMany({ where: { id: courseId } });
      });
    await db.$disconnect();
  }
});
