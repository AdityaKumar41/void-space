import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });

test('learning and asset pages have no retired editor launch or guide routes', async ({ page }) => {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
  let tenant = '';
  try {
    const response = await page.request.post('/api/v1/auth/learners', {
      data: {
        fullName: 'Platform boundary learner',
        email: `boundary-${randomUUID()}@example.test`,
        password: 'PlatformBoundary2026!',
        ageBand: '18+',
      },
    });
    expect(response.status()).toBe(201);
    tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
    for (const path of [
      '/',
      '/console/learn/agent',
      '/console/learn/library',
      '/console/models',
      '/console/catalog',
      '/console/library',
    ]) {
      await page.goto(path);
      await expect(page.locator('body')).not.toContainText(/Void[·\s]*Studio/i);
      await expect(page.locator('a[href*="/studio"],a[href*="5007"]')).toHaveCount(0);
    }
    for (const path of ['/studio/connect', '/docs', '/docs/modeling']) {
      expect((await page.goto(path))?.status()).toBe(404);
    }
  } finally {
    if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
    await db.$disconnect();
  }
});
