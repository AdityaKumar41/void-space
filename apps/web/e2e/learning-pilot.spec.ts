import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`clear entry, prompt handoff, current lesson formats and old-link recovery (${mobile ? 'touch' : 'desktop'})`, async ({
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
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Ask. Explore. Understand.' })).toBeVisible();
      await page
        .getByRole('textbox', { name: 'What would you like to learn?' })
        .fill('Create a 30-minute lesson about circuits');
      await page.getByRole('button', { name: 'Start a lesson with AI' }).click();
      await expect(page).toHaveURL(/login/);
      await page.getByRole('link', { name: 'Create an account', exact: true }).click();
      await page.getByLabel('Full name', { exact: true }).fill('Pilot learner');
      await page.getByLabel('Email', { exact: true }).fill(`ux-pilot-${randomUUID()}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('PilotBrowser2026!');
      await page.getByLabel('Age range').selectOption('13-17');
      await page.getByRole('button', { name: 'Create learner account' }).click();
      await expect(
        page.getByRole('textbox', {
          name: 'Ask me anything — I’m your personal learning agent.',
          exact: true,
        }),
      ).toHaveValue('Create a 30-minute lesson about circuits');
      tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
      await page.goto('/console/learn/activities');
      await expect(page).toHaveURL(/\/console\/learn$/);
      await page.goto('/console/learn/49ee3f12-2d11-4dbb-a2ce-66bd88df99aa');
      await expect(page).toHaveURL(/\/console\/learn$/);
      for (const label of ['An educational diagram', 'A process and sequence']) {
        await page.getByText('Try a complete example', { exact: true }).click();
        await page.getByRole('button', { name: label, exact: true }).click();
        await expect(page).toHaveURL(/\/drafts\//);
        await expect(
          page.getByRole('button', { name: 'Edit this lesson', exact: true }),
        ).toBeVisible();
        await expect(page.getByLabel('Lesson title', { exact: true })).not.toBeVisible();
        await page.getByRole('button', { name: /3\. Explore and practise/ }).click();
        await expect(
          page.getByRole('img', {
            name:
              label === 'An educational diagram'
                ? 'Component diagram; use the component list below to explore'
                : 'Process connections; use the component list below to explore',
          }),
        ).toBeVisible();
        if (label === 'An educational diagram') {
          await page.getByRole('button', { name: 'Switch', exact: true }).click();
          await page.getByRole('button', { name: 'Check selected component', exact: true }).click();
          await page.getByRole('combobox', { name: 'Supply', exact: true }).selectOption('energy');
          await page.getByRole('combobox', { name: 'Lamp', exact: true }).selectOption('light');
          await page.getByRole('button', { name: 'Check matches', exact: true }).click();
        } else {
          await page.getByRole('button', { name: 'Move up Review draft', exact: true }).click();
          await page.getByRole('button', { name: 'Check sequence', exact: true }).click();
          await page.getByLabel('Review and correct the answer', { exact: true }).check();
          await page.getByRole('button', { name: 'Check answer', exact: true }).click();
        }
        await expect(page.getByText(/Activity complete\./)).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await page.goto('/console/learn');
      }
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
