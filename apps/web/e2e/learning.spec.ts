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
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Lessons', exact: true }).click();
    await page.getByText('Create a lesson', { exact: true }).click();
    await page
      .getByLabel('Approved asset')
      .selectOption({ label: 'Cordless Impact Drill · Tooling' });
    await page.getByLabel('Lesson title (optional)').fill(name);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/lessons') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create draft and edit' }).click();
    lessonId = (await (await created).json()).lesson.id;
    await expect(page.getByRole('heading', { name: 'Review your lesson' })).toBeVisible();
    await page
      .getByRole('textbox', { name: /^narration$/i })
      .fill(
        'Inspect the cordless drill housing before use. Check for visible cracks and confirm the bit is secure. Follow the manufacturer instructions for the specific model.',
      );
    await page.getByRole('button', { name: 'Save and publish' }).click();
    await expect(page.getByRole('heading', { name: 'Lessons' })).toBeVisible();
    await page
      .getByRole('heading', { name, exact: true })
      .locator('..')
      .getByRole('button', { name: 'Start lesson', exact: true })
      .click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByText('3D asset ready.', { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Lesson transcript', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(page.getByText('All progress saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Begin assessment/ }).click();
    await page.getByRole('radio').first().check();
    await expect(page.getByText('All progress saved', { exact: true })).toBeVisible();
    await page.reload();
    await page
      .getByRole('heading', { name, exact: true })
      .locator('..')
      .getByRole('button', { name: 'Start lesson', exact: true })
      .click();
    await expect(page.getByRole('radio').first()).toBeChecked();
    await expect(page.getByText('Saved progress restored', { exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/void-learning-player.png', fullPage: true });
    const roomResponse = await page.request.post('/api/v1/spatial/rooms', {
      data: { title: name, lessonId },
    });
    expect(roomResponse.status()).toBe(201);
    roomId = (await roomResponse.json()).room.id;
    expect((await page.request.post(`/api/v1/spatial/rooms/${roomId}/live`)).status()).toBe(200);
    await page.getByRole('link', { name: 'Spaces', exact: true }).click();
    await page
      .getByRole('heading', { name, exact: true })
      .locator('..')
      .getByRole('button', { name: 'Join space' })
      .click();
    await expect(
      page.getByText('Connected · presence refreshes every 20 seconds', { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel('Follow facilitator steps')).toBeChecked();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByText('3D asset ready.', { exact: false })).toBeVisible({
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
    const room = await page.request.get(`/api/v1/spatial/rooms/${roomId}`);
    expect((await room.json()).room.participants).toHaveLength(0);
    expect(errors).toEqual([]);
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
