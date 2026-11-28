import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`composer grows with content and replaces send with working stop (${mobile ? 'touch' : 'desktop'})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    let tenant = '';
    try {
      const registration = await page.request.post('/api/v1/auth/learners', {
        data: {
          fullName: 'Composer learner',
          email: `composer-${randomUUID()}@example.test`,
          password: 'ComposerTest2026!',
          ageBand: '18+',
        },
      });
      expect(registration.status()).toBe(201);
      tenant = (await registration.json()).user.activeTenantId;
      const taskId = randomUUID();
      let cancelled = false;
      await page.route('**/api/v1/learning/agent/threads/*/messages', (route) =>
        route.fulfill({ status: 202, json: { taskId } }),
      );
      await page.route(`**/api/v1/learning/tasks/${taskId}`, (route) =>
        route.fulfill({
          json: {
            task: {
              id: taskId,
              kind: 'agent_turn',
              status: cancelled ? 'cancelled' : 'active',
              error: null,
              progress: [],
            },
          },
        }),
      );
      await page.route(`**/api/v1/learning/agent/runs/${taskId}/events`, (route) =>
        route.fulfill({ contentType: 'text/event-stream', body: '' }),
      );
      await page.route(`**/api/v1/learning/agent/runs/${taskId}/cancel`, (route) => {
        cancelled = true;
        return route.fulfill({ json: { status: 'cancelled' } });
      });
      await page.goto('/console/learn/agent');
      const input = page.getByRole('textbox', { name: 'Message your learning agent', exact: true });
      await expect(input).toBeVisible();
      const height = () => input.evaluate((node) => node.getBoundingClientRect().height);
      const initial = await height();
      expect(initial).toBeLessThanOrEqual(55);
      await input.fill(
        Array.from({ length: 14 }, (_, index) => `Line ${index + 1}: a geometry question.`).join(
          '\n',
        ),
      );
      await expect.poll(height).toBeGreaterThan(initial + 50);
      expect(await height()).toBeLessThanOrEqual(181);
      await input.fill('Explain a cube.');
      await expect.poll(height).toBe(initial);
      await input.press('Shift+Enter');
      await expect(input).toHaveValue('Explain a cube.\n');
      await page.getByRole('button', { name: 'Send to personal agent', exact: true }).click();
      const stop = page.getByRole('button', { name: 'Stop generation', exact: true });
      await expect(stop).toBeEnabled();
      await expect(
        page
          .locator('.agent-composer')
          .getByRole('button', { name: 'Stop generation', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Send to personal agent', exact: true }),
      ).toHaveCount(0);
      await expect.poll(height).toBe(initial);
      await stop.click();
      expect(cancelled).toBe(true);
      await expect(stop).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Send to personal agent', exact: true }),
      ).toBeDisabled();
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
