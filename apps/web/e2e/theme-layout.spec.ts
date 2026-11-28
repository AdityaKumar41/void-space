import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`login and settings follow the shared theme without clipping (${mobile ? 'mobile' : 'desktop'})`, async ({
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
    try {
      await page.goto('/login');
      const story = await page.getByRole('region', { name: 'Welcome to Void Space' }).boundingBox(),
        form = await page
          .locator('form')
          .filter({ has: page.getByRole('button', { name: 'Sign in', exact: true }) })
          .boundingBox();
      expect(story).toBeTruthy();
      expect(form).toBeTruthy();
      if (!mobile) {
        expect(form!.x).toBeGreaterThan(story!.x + story!.width);
        expect(form!.y).toBeLessThan(350);
      } else expect(form!.x + form!.width).toBeLessThanOrEqual(390);
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeInViewport();
      const r = await page.request.post('/api/v1/auth/learners', {
        data: {
          fullName: 'Theme learner',
          email: `theme-${randomUUID()}@example.test`,
          password: 'ThemeBrowser2026!',
          ageBand: '18+',
        },
      });
      expect(r.status()).toBe(201);
      tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
      await page.goto('/console/learn/settings');
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
      const main = await page.getByRole('main').boundingBox(),
        heading = await page.getByRole('heading', { name: 'Settings', exact: true }).boundingBox();
      expect(heading!.x - main!.x).toBeGreaterThanOrEqual(16);
      const theme = await page.locator('.agent-workspace').evaluate((el) => ({
        accent: getComputedStyle(el).getPropertyValue('--fc-heat').trim(),
        font: getComputedStyle(el).fontFamily,
      }));
      expect(theme.accent).toBe('#fa5d19');
      expect(theme.font).toContain('Plus Jakarta Sans');
      await page.goto('/console/learn');
      await expect(page.getByRole('link', { name: 'Create lesson', exact: true })).toHaveCSS(
        'background-color',
        'rgb(250, 93, 25)',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
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

test('credential forms remain inert before JavaScript hydration', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const path of ['/learn/signup', '/login', '/learn/join-institution']) {
      await page.goto(path);
      await expect(page.locator('form').first()).toHaveAttribute('method', 'post');
      const password = path === '/learn/join-institution'
        ? page.getByLabel(/^Set a password/)
        : page.getByLabel('Password', { exact: true });
      await expect(password).toBeDisabled();
    }
  } finally {
    await context.close();
  }
});
