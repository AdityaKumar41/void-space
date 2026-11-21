import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { demoId } from '../../../packages/db/src/demo-ids';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });

test('author reviews a draft, explores its saved model and joins the lesson room', async ({
  page,
}) => {
  const name = `Inspection walkthrough ${Date.now()}`;
  let lessonId: string | undefined;
  let roomId: string | undefined;
  const errors: string[] = [];
  const failedRequests: string[] = [];
  const roomFrames: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 400)
      failedRequests.push(`${response.status()} ${response.url()}`);
  });
  page.on('websocket', (socket) => {
    if (socket.url().includes('/live-ws'))
      socket.on('framereceived', (frame) => roomFrames.push(frame.payload.toString()));
  });
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Lessons', exact: true }).click();
    await page.getByText('Create a lesson', { exact: true }).click();
    await page
      .getByRole('combobox', { name: '3D model', exact: true })
      .selectOption({ label: 'Cordless Impact Drill · Tooling' });
    await page.getByLabel('Subject', { exact: true }).fill(name);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/lessons') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create lesson', exact: true }).click();
    lessonId = (await (await created).json()).lesson.id;
    await expect(page.getByRole('heading', { name: 'Edit lesson', exact: true })).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Reading', exact: true })
      .fill(
        'Inspect the cordless drill housing before use. Check for visible cracks and confirm the bit is secure. Follow the manufacturer instructions for the specific model.',
      );
    await page.getByRole('button', { name: 'Save and publish' }).click();
    await expect(page.getByRole('heading', { name: 'Lessons' })).toBeVisible();
    await page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
      .getByRole('button', { name: 'Start lesson', exact: true })
      .click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(
      page.getByText('Model ready. Drag to turn it. Scroll to zoom.', { exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /^All progress saved/ })).toBeVisible();
    await page.getByRole('button', { name: /Start quiz/ }).click();
    await page.getByRole('radio').first().check();
    await expect(page.getByRole('status').filter({ hasText: /^All progress saved/ })).toBeVisible();
    await page.reload();
    await page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
      .getByRole('button', { name: 'Start lesson', exact: true })
      .click();
    await expect(page.getByRole('radio').first()).toBeChecked();
    await expect(
      page.getByRole('status').filter({ hasText: /^Saved progress restored/ }),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/void-learning-player.png', fullPage: true });
    const roomResponse = await page.request.post('/api/v1/spatial/rooms', {
      data: { title: name, lessonId },
    });
    expect(roomResponse.status()).toBe(201);
    roomId = (await roomResponse.json()).room.id;
    expect((await page.request.post(`/api/v1/spatial/rooms/${roomId}/live`)).status()).toBe(200);
    await page.context().clearCookies();
    await page.goto(`/console/spaces?room=${roomId}`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=`));
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/console/spaces?room=${roomId}`);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByText('Connected · presence refreshes every 20 seconds', { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel('Follow facilitator steps')).toBeChecked();
    await expect
      .poll(() => roomFrames.some((frame) => JSON.parse(frame).type === 'room.snapshot'))
      .toBe(true);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(
      page.getByText('Model ready. Drag to turn it. Scroll to zoom.', { exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/v1/spatial/rooms/${roomId}`)).json()).room.worldState
            .lessonStep,
      )
      .toBe(2);
    await page.screenshot({ path: '/tmp/void-learning-room.png', fullPage: true });
    await page.getByRole('button', { name: 'Leave space', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Shared learning spaces' })).toBeVisible();
    await expect(page).not.toHaveURL(/room=/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Shared learning spaces' })).toBeVisible();
    const room = await page.request.get(`/api/v1/spatial/rooms/${roomId}`);
    expect((await room.json()).room.participants).toHaveLength(0);
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  } finally {
    const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await client
      .$transaction(async (db) => {
        await db.$executeRaw`SELECT set_config('app.current_tenant_id', ${demoId('tenant:aurora')}, true)`;
        if (roomId) await db.spatialRoom.deleteMany({ where: { id: roomId } });
        if (lessonId) await db.lesson.deleteMany({ where: { id: lessonId } });
      })
      .finally(() => client.$disconnect());
  }
});
