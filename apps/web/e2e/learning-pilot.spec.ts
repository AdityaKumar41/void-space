import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`learner signup, three formats, keyboard/touch and reload recovery (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    let tenantId: string | undefined;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    try {
      await page.goto('/learn/signup');
      await page.getByLabel('Full name', { exact: true }).fill('Pilot browser learner');
      await page.getByLabel('Email', { exact: true }).fill(`browser-${randomUUID()}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('PilotBrowser2026!');
      await page.getByLabel('Age range').selectOption('13-17');
      await page.getByRole('button', { name: 'Create learner account' }).click();
      await expect(page.getByRole('heading', { name: 'Ask AI', exact:true })).toBeVisible();
      const me = await (await page.request.get('/api/v1/auth/me')).json();
      tenantId = me.user.activeTenantId;
      expect(me.user.roles).toEqual(['Learner']);
      await page.goto('/console/learn/activities');
      await page.getByRole('button', { name: 'Explore activity', exact: true }).nth(0).click();
      await expect(
        page.getByRole('heading', { name: 'Explore three geometric components', exact: true }),
      ).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(1);
      await page.getByRole('button', { name: 'Guided practice', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Find the sphere', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sphere', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Sphere', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('heading', { name: 'Inspect one component', exact: true }),
      ).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: 'Resume guided practice', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Inspect one component', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Box', exact: true }).click();
      await page.getByRole('button', { name: 'Isolate selected', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Restore the arrangement', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Restore arrangement', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Activity completed', exact: true }),
      ).toBeVisible();
      await page.goto('/console/learn/activities');
      await page.getByRole('button', { name: 'Explore activity', exact: true }).nth(1).click();
      await expect(
        page.getByRole('heading', { name: 'Read a simple circuit diagram', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Guided practice', exact: true }).click();
      await page.getByRole('button', { name: 'Switch', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Match component roles', exact: true }),
      ).toBeVisible();
      await page.getByRole('combobox', { name: 'Supply', exact: true }).selectOption('energy');
      await page.getByRole('combobox', { name: 'Lamp', exact: true }).selectOption('light');
      await page.getByRole('button', { name: 'Check matches', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Activity completed', exact: true }),
      ).toBeVisible();
      await page.goto('/console/learn/activities');
      await page.getByRole('button', { name: 'Explore activity', exact: true }).nth(2).click();
      await expect(
        page.getByRole('heading', { name: 'From source notes to a reviewed lesson', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Guided practice', exact: true }).click();
      await page.getByRole('button', { name: 'Move Review draft up', exact: true }).click();
      await page.getByRole('button', { name: 'Check sequence', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Choose the next action', exact: true }),
      ).toBeVisible();
      await page.getByLabel('Review and correct the answer', { exact: true }).check();
      await page.getByRole('button', { name: 'Check answer', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Activity completed', exact: true }),
      ).toBeVisible();
      expect(await page.locator('body').evaluate((e) => e.scrollWidth <= window.innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    } finally {
      if (tenantId) {
        const db = new PrismaClient({
          datasources: { db: { url: process.env.PLATFORM_DATABASE_URL } },
        });
        try {
          await db.tenant.deleteMany({ where: { id: tenantId } });
        } finally {
          await db.$disconnect();
        }
      }
    }
  });
