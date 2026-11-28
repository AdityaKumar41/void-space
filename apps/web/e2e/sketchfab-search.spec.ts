import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const touch of [false, true]) {
  test(`Sketchfab search previews and recovery (${touch ? 'touch' : 'desktop'})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: touch,
      hasTouch: touch,
    });
    const page = await context.newPage();
    const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
    let tenant = '';
    const uid = '0123456789abcdef0123456789abcdef';
    const model = {
      uid,
      name: 'Human heart',
      author: 'Test author',
      license: 'CC BY',
      downloadable: true,
      url: `https://sketchfab.com/3d-models/${uid}`,
      thumbnail: 'https://media.sketchfab.com/test-heart.png',
    };
    try {
      const response = await page.request.post('/api/v1/auth/learners', {
        data: {
          fullName: 'Preview learner',
          email: `preview-${randomUUID()}@example.test`,
          password: 'PreviewBrowser2026!',
          ageBand: '18+',
        },
      });
      expect(response.status()).toBe(201);
      tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
      await page.route('**/api/v1/tools/sketchfab/find?**', (route) =>
        route.fulfill({
          json: {
            models: [
              model,
              {
                ...model,
                uid: '1123456789abcdef0123456789abcdef',
                name: 'Missing preview',
                thumbnail: null,
              },
              {
                ...model,
                uid: '2123456789abcdef0123456789abcdef',
                name: 'Broken preview',
                thumbnail: 'https://media.sketchfab.com/broken.png',
              },
            ],
          },
        }),
      );
      await page.route('https://media.sketchfab.com/test-heart.png', (route) =>
        route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5s8AAAAASUVORK5CYII=',
            'base64',
          ),
        }),
      );
      await page.route('https://media.sketchfab.com/broken.png', (route) =>
        route.fulfill({ status: 404 }),
      );
      await page.route('https://sketchfab.com/models/**/embed**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>Interactive preview</p>' }),
      );
      await page.goto('/console/models');
      await page.getByRole('textbox', { name: 'Sketchfab model link or search' }).fill('heart');
      await page.getByRole('button', { name: 'Find model', exact: true }).click();
      const card = page.getByRole('button', { name: 'Preview Human heart', exact: true });
      await expect(card.getByRole('img', { name: 'Human heart' })).toBeVisible();
      await expect(page.getByText('Preview unavailable', { exact: true })).toHaveCount(2);
      await card.click();
      await expect(page.getByTitle('Human heart — interactive Sketchfab viewer')).toBeVisible();
      await expect(card).toHaveAttribute('aria-pressed', 'true');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.route('**/api/v1/tools/sketchfab/find?**', (route) =>
        route.fulfill({ json: { models: [] } }),
      );
      await page.getByRole('textbox', { name: 'Sketchfab model link or search' }).fill('no match');
      await page.getByRole('button', { name: 'Find model', exact: true }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'No downloadable models matched' }),
      ).toBeVisible();
      await expect(page.getByTitle('Human heart — interactive Sketchfab viewer')).toHaveCount(0);
    } finally {
      await context.close();
      if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
      await db.$disconnect();
    }
  });
}
