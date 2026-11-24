import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`marketplace and public entry stay in the current theme (${mobile ? 'touch' : 'desktop'})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let tenant = '';
    const noOverflow = async () =>
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Ask. Explore. Understand.' })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Start a lesson with AI', exact: true }),
      ).toBeVisible();
      await noOverflow();
      await page.goto('/catalog');
      await expect(
        page.getByRole('heading', { name: 'A new way to see what you’re learning.' }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
      await page
        .getByRole('searchbox', { name: 'Search the catalogue' })
        .fill('no-model-has-this-name-34891');
      await expect(page).toHaveURL(/search=no-model-has-this-name-34891/);
      await noOverflow();
      await page.reload();
      await expect(page.getByRole('searchbox', { name: 'Search the catalogue' })).toHaveValue(
        'no-model-has-this-name-34891',
      );
      expect(
        (
          await page.request.post('/api/v1/auth/learners', {
            data: {
              fullName: 'Catalog theme learner',
              email: `catalog-theme-${randomUUID()}@example.test`,
              password: 'CatalogTheme2026!',
              ageBand: '18+',
            },
          })
        ).status(),
      ).toBe(201);
      tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
      await page.goto('/console/catalog');
      await expect(
        page.getByRole('heading', { name: 'Find your next learning model.' }),
      ).toBeVisible();
      await expect(page.locator('.workspace-theme')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Published modules' })).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: 'Your model collection starts here' }),
      ).toBeVisible();
      await page
        .getByRole('searchbox', { name: 'Search by name, category or tag' })
        .fill('missing model');
      await expect(
        page.getByRole('heading', { name: 'No models match your search' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await expect(
        page.getByRole('searchbox', { name: 'Search by name, category or tag' }),
      ).toHaveValue('');
      await page.getByRole('combobox', { name: 'Licence', exact: true }).selectOption('active');
      await expect(
        page.getByRole('heading', { name: 'No models match your search' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await noOverflow();
      await page.goto('/console/classes');
      await expect(page).toHaveURL(/\/console\/learn$/);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      if (tenant) {
        const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
        try {
          await db.tenant.deleteMany({ where: { id: tenant } });
        } finally {
          await db.$disconnect();
        }
      }
    }
  });
