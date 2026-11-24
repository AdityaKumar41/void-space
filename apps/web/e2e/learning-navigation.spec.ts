import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
test('learning notifications and settings keep the learning workspace', async ({ page }) => {
  let tenant = '';
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
  try {
    const r = await page.request.post('/api/v1/auth/learners', {
      data: {
        fullName: 'Navigation learner',
        email: `navigation-${randomUUID()}@example.test`,
        password: 'Navigation2026!',
        ageBand: '18+',
      },
    });
    expect(r.status()).toBe(201);
    const user = (await (await page.request.get('/api/v1/auth/me')).json()).user;
    tenant = user.activeTenantId;
    await db.notification.create({
      data: {
        tenantId: tenant,
        userId: user.id,
        type: 'learning.lesson_ready',
        payload: { title: 'Your lesson is ready', body: 'Open your saved material.' },
      },
    });
    await page.goto('/console/learn');
    await page.getByRole('link', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Learning navigation' })).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your lesson is ready', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await page.getByRole('button', { name: 'Unread 0', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'You’re all caught up', exact: true }),
    ).toBeVisible();
    await page.goto('/console/notifications');
    await expect(page).toHaveURL(/\/console\/learn\/notifications$/);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Learning navigation' })).toBeVisible();
    for (const path of ['settings', 'help', 'sources', 'progress', 'discover', 'institution']) {
      await page.goto(`/console/learn/${path}`);
      await expect(page.getByRole('complementary', { name: 'Learning navigation' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    }
  } finally {
    if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
    await db.$disconnect();
  }
});
