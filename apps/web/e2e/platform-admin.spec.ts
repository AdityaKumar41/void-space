import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
import { totp } from '../../api/src/modules/platform/totp';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`central administrator enrolls MFA and locks the console (${mobile ? 'touch' : 'desktop'})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage(),
      db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
    let userId = '',
      tenantId = '';
    try {
      const registration = await page.request.post('/api/v1/auth/learners', {
        data: {
          fullName: 'Console test administrator',
          email: `console-admin-${randomUUID()}@example.test`,
          password: 'ConsoleAdmin2026!',
          ageBand: '18+',
        },
      });
      expect(registration.status()).toBe(201);
      const user = (await (await page.request.get('/api/v1/auth/me')).json()).user;
      userId = user.id;
      tenantId = user.activeTenantId;
      await page.goto('/console/platform');
      await expect(
        page.getByRole('heading', { name: 'Central access has not been granted' }),
      ).toBeVisible();
      await db.platformAccess.create({ data: { userId, role: 'PlatformAdmin' } });
      await page.reload();
      await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
      const secret = await page.locator('.platform-enrollment code').textContent();
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      await page
        .getByLabel('Authenticator or recovery code', { exact: true })
        .fill(totp(secret!, Math.floor(Date.now() / 30000)));
      await page
        .getByRole('button', { name: 'Verify and open administration', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
      await page.getByRole('button', { name: 'I saved them', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Accounts and access', exact: true }),
      ).toBeVisible();
      await page.getByLabel('Find an account').fill(user.email);
      await expect(page.getByRole('article').filter({ hasText: user.email })).toContainText(
        'PlatformAdmin',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.getByRole('button', { name: 'Lock administration' }).click();
      await expect(
        page.getByRole('button', { name: 'Verify and open administration' }),
      ).toBeVisible();
      expect((await page.request.get('/api/v1/platform/overview')).status()).toBe(403);
    } finally {
      await context.close();
      if (userId) {
        await db.platformConsoleSession.deleteMany({ where: { userId } });
        await db.platformAccess.deleteMany({ where: { userId } });
        await db.platformEvent.deleteMany({ where: { actorId: userId } });
      }
      if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } });
      await db.$disconnect();
    }
  });
