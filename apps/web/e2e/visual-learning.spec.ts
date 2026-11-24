import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`the model is the learning surface from the first section (${mobile ? 'touch' : 'desktop'})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
        baseURL,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        isMobile: mobile,
        hasTouch: mobile,
      }),
      page = await context.newPage();
    let tenant = '';
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      expect(
        (
          await page.request.post('/api/v1/auth/learners', {
            data: {
              fullName: 'Visual learner',
              email: `visual-${randomUUID()}@example.test`,
              password: 'VisualBrowser2026!',
              ageBand: '18+',
            },
          })
        ).status(),
      ).toBe(201);
      tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
      await page.goto('/console/learn');
      await expect(page.getByRole('link', { name: 'Choose a 3D model' })).toBeVisible();
      await page.getByRole('button', { name: '3D components', exact: true }).click();
      await expect(page).toHaveURL(/\/drafts\//);
      await expect(
        page.getByRole('heading', { name: 'Start with a question', exact: true }),
      ).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(1);
      await page.getByRole('button', { name: 'Scene target Sphere', exact: true }).click();
      await expect(
        page
          .getByRole('complementary', { name: 'Selected component' })
          .getByRole('heading', { name: 'Sphere', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Isolate part', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Scene target Box', exact: true })).toHaveCount(
        0,
      );
      await page.getByRole('button', { name: 'Show all parts', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Scene target Box', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Separate parts', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Separate parts', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Reset view', exact: true }).click();
      await page.getByRole('button', { name: 'Study privately', exact: true }).click();
      await expect(page).toHaveURL(/\/lessons\//);
      await expect(page.locator('canvas')).toHaveCount(1);
      await page.getByRole('button', { name: 'Scene target Box', exact: true }).click();
      await expect(
        page.getByText('This component is a box with flat rectangular faces.', { exact: true }),
      ).toBeVisible();
      const release = new URL(page.url()).pathname.split('/').at(-1);
      const before = (
        await (
          await page.request.get(
            `/api/v1/learning/lesson-plans/releases/${release}?tenant=${tenant}`,
          )
        ).json()
      ).progress;
      expect(before.state.completed).toEqual([]);
      expect(before.state.activities).toEqual({});
      await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Build understanding', exact: true }),
      ).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(1);
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Build understanding', exact: true }),
      ).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(1);
      await page.goto('/console/learn');
      await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('drafts');
      await expect(page.getByRole('link', { name: 'Open lesson', exact: true })).toHaveCount(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
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
