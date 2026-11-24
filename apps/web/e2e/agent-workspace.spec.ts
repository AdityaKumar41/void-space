import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { buildGlbFixture } from '../../../packages/db/src/glb-fixture';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`personal agent workspace, folders and private model library (${mobile ? 'touch' : 'desktop'})`, async ({
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
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.log('Browser error at', page.url(), e.stack);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().toLowerCase().includes('hydrat')) console.log(m.text());
    });
    try {
      await page.goto('/learn/signup');
      await page.getByLabel('Full name', { exact: true }).fill('Private library learner');
      await page
        .getByLabel('Email', { exact: true })
        .fill(`agent-browser-${randomUUID()}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('AgentBrowser2026!');
      await page.getByLabel('Age range').selectOption('13-17');
      await page.getByRole('button', { name: 'Create learner account', exact: true }).click();
      await expect(page).toHaveURL(/\/console\/learn\/agent/);
      await expect(page.getByRole('heading', { name: 'Ask AI', exact: true })).toBeVisible();
      tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
      await expect(
        page.getByRole('textbox', {
          name: 'Ask me anything — I’m your personal learning agent.',
          exact: true,
        }),
      ).toBeVisible();
      if (mobile) {
        const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
        await menu.tap();
        await expect(
          page
            .getByRole('navigation', { name: 'Asset tools' })
            .getByRole('link', { name: 'Marketplace', exact: true }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeFocused();
        await expect(page.getByRole('link', { name: 'My lessons', exact: true })).not.toBeVisible();
      } else {
        await expect(
          page
            .getByRole('navigation', { name: 'Asset tools' })
            .getByRole('link', { name: 'Marketplace', exact: true }),
        ).toBeVisible();
        await page.screenshot({ path: '/private/tmp/void-space-agent-desktop.png' });
      }
      await page.getByRole('button', { name: 'Create conversation folder', exact: true }).click();
      await page.getByLabel('Folder name', { exact: true }).fill('My learning notes');
      await page.getByRole('button', { name: 'Create folder', exact: true }).click();
      await expect(page.getByLabel('Folder name', { exact: true })).toHaveCount(0);
      const folder = (
        await (await page.request.get('/api/v1/learning/agent/threads')).json()
      ).folders.find((f: { title: string }) => f.title === 'My learning notes');
      expect(folder).toBeTruthy();
      const response = await page.request.post('/api/v1/learning/agent/threads', {
        data: { title: 'Learning model exploration', folderId: folder.id },
      });
      expect(response.status()).toBe(201);
      const id = (await response.json()).thread.id;
      await page.goto(`/console/learn/agent?thread=${id}`);
      await expect(page.getByRole('combobox', { name: 'Folder', exact: true })).toHaveValue(
        folder.id,
      );
      await page.reload();
      await expect(page.getByRole('combobox', { name: 'Folder', exact: true })).toHaveValue(
        folder.id,
      );
      await page.goto('/console/learn/library');
      await page.getByLabel('Add a private 3D model', { exact: true }).setInputFiles({
        name: 'learning-cube.glb',
        mimeType: 'model/gltf-binary',
        buffer: buildGlbFixture(12),
      });
      await expect(page.getByRole('heading', { name: 'learning-cube', exact: true })).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(1);
      await page
        .getByRole('button', { name: 'Start from model component names', exact: true })
        .click();
      await page.getByLabel('Component name', { exact: true }).first().fill('Learning cube');
      await page
        .getByRole('textbox', { name: 'What does this component do?', exact: true })
        .first()
        .fill('A sample component used to practise model exploration.');
      await page
        .getByRole('checkbox', {
          name: 'I confirmed these names, explanations and model mappings.',
          exact: true,
        })
        .check();
      await page.getByRole('button', { name: 'Save reviewed labels', exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Reviewed model labels saved.' }),
      ).toBeVisible();
      const models = (await (await page.request.get('/api/v1/learning/library')).json()).models;
      expect(models).toHaveLength(1);
      expect(models[0].metadata.labelsReviewed).toBe(true);
      const anonymous = await browser.newContext({ baseURL });
      try {
        expect(
          (await anonymous.request.get(`/api/v1/learning/library/${models[0].id}/file`)).status(),
        ).toBe(401);
      } finally {
        await anonymous.close();
      }
      await page
        .getByRole('link', { name: 'Create a lesson with this model', exact: true })
        .click();
      await expect(
        page.getByRole('combobox', { name: 'Choose a model for the agent', exact: true }),
      ).toHaveValue(`private:${models[0].id}`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      if (tenant) {
        const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
        try {
          await prisma.tenant.deleteMany({ where: { id: tenant } });
        } finally {
          await prisma.$disconnect();
        }
      }
    }
  });
