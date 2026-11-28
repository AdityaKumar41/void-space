import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
test('image generation failure stays in history and can be resumed after reload', async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
  let tenant = '';
  try {
    expect(
      (
        await page.request.post('/api/v1/auth/learners', {
          data: {
            fullName: 'Image learner',
            email: `image-browser-${randomUUID()}@example.test`,
            password: 'ImageBrowser2026!',
            ageBand: '18+',
          },
        })
      ).status(),
    ).toBe(201);
    const user = (await (await page.request.get('/api/v1/auth/me')).json()).user;
    tenant = user.activeTenantId;
    const taskId = randomUUID(),
      retryId = randomUUID();
    await page.route('**/api/v1/learning/agent/images', async (route) => {
      const body = route.request().postDataJSON();
      expect(body.prompt).toContain('sphere');
      await db.learningTask.create({
        data: {
          id: taskId,
          tenantId: tenant,
          ownerId: user.id,
          kind: 'image_generate',
          status: 'failed',
          input: body,
          error:
            'The image service could not load Flux. Ask the server administrator to check model access.',
          progress: [{ id: 'image', label: 'Creating an illustration', status: 'failed' }],
        },
      });
      await route.fulfill({ status: 202, json: { task: { id: taskId, status: 'failed' } } });
    });
    await page.route('**/api/v1/learning/agent/activity/*/retry', async (route) => {
      await db.learningTask.create({
        data: {
          id: retryId,
          tenantId: tenant,
          ownerId: user.id,
          kind: 'image_generate',
          status: 'failed',
          input: { prompt: 'An illustration of a blue sphere' },
          error: 'Flux is still unavailable.',
          progress: [{ id: 'image', label: 'Creating an illustration', status: 'failed' }],
        },
      });
      await route.fulfill({ status: 202, json: { task: { id: retryId, status: 'failed' } } });
    });
    // Exercise recovery independently of the local administrator's paused Flux setting.
    // Generation and retry above remain intercepted; this never calls an image provider.
    await page.route(/\/api\/v1\/learning\/agent\/activity(?:\?.*)?$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), imageAvailable: true } });
    });
    await page.goto('/console/learn/agent');
    await page
      .getByRole('textbox', {
        name: 'Message your learning agent',
        exact: true,
      })
      .fill('An illustration of a blue sphere');
    await page.getByRole('button', { name: 'Create image', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`task=${taskId}`));
    await expect(page.getByRole('region', { name: 'Conversations', exact: true })).toContainText(
      'could not load Flux',
    );
    await expect(page.getByRole('button', { name: 'Retry image', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Search conversations' }).click();
    await page.getByRole('button', { name: 'All AI work', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry image', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Conversations', exact: true })).toContainText(
      'An illustration of a blue sphere',
    );
    await page.getByRole('button', { name: 'Retry image', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`task=${retryId}`));
    await page.reload();
    await page.getByRole('button', { name: 'Search conversations' }).click();
    await expect(page.getByRole('region', { name: 'Conversations', exact: true })).toContainText(
      'Flux is still unavailable.',
    );
    await page.route(/\/api\/v1\/learning\/agent\/activity(?:\?.*)?$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), imageAvailable: false },
      });
    });
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Images unavailable', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Search conversations' }).click();
    await page.getByRole('button', { name: 'All AI work', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry image', exact: true })).toHaveCount(2);
    for (const retry of await page.getByRole('button', { name: 'Retry image', exact: true }).all())
      await expect(retry).toBeDisabled();
  } finally {
    if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
    await db.$disconnect();
  }
});
