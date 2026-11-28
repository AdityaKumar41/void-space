import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { solidCubeFixture } from './solid-cube-fixture';
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
          name: 'Message your learning agent',
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
        await page.screenshot({
          path: '/private/tmp/void-space-agent-desktop.png',
          caret: 'initial',
        });
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
      await page.getByLabel('Add model', { exact: true }).setInputFiles({
        name: 'learning-cube.glb',
        mimeType: 'model/gltf-binary',
        buffer: solidCubeFixture(),
      });
      await expect(page.getByRole('heading', { name: 'learning-cube', exact: true })).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(1);
      await page.getByRole('link', { name: 'Open annotation editor', exact: true }).click();
      await expect(page).toHaveURL(/\/annotate$/);
      await expect(page.getByRole('navigation', { name: 'Workspace sections' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Add annotation', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Save annotations', exact: true }),
      ).toBeDisabled();
      await page.getByRole('button', { name: '← Back to library', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
      if (mobile) await page.locator('.library-viewport canvas').tap();
      else await page.locator('.library-viewport canvas').click();
      await page.getByLabel('Name', { exact: true }).first().fill('Learning cube');
      await page
        .getByRole('textbox', { name: 'Explanation', exact: true })
        .first()
        .fill('A sample component used to practise model exploration.');
      await page
        .getByRole('checkbox', {
          name: 'I checked names, explanations and positions',
          exact: true,
        })
        .check();
      await page.getByRole('button', { name: 'Save annotations', exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Reviewed annotations saved.' }),
      ).toBeVisible();
      const models = (await (await page.request.get('/api/v1/learning/library')).json()).models;
      expect(models).toHaveLength(1);
      expect(models[0].metadata.labelsReviewed).toBe(true);
      expect(
        models[0].metadata.labels[0].position.some((value: number) => Math.abs(value) > 0),
      ).toBe(true);
      await page.reload();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Learning cube');
      const anonymous = await browser.newContext({ baseURL });
      try {
        expect(
          (await anonymous.request.get(`/api/v1/learning/library/${models[0].id}/file`)).status(),
        ).toBe(401);
      } finally {
        await anonymous.close();
      }
      await page.getByText('More actions', { exact: true }).click();
      await page.getByRole('button', { name: 'Start lesson manually', exact: true }).click();
      await expect(page).toHaveURL(/\/drafts\//);
      await expect(page.locator('canvas')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Learning cube', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Model annotations', exact: true }).click();
      await page.getByRole('button', { name: 'Add component', exact: true }).click();
      await page.getByLabel('Component name', { exact: true }).fill('Cube surface');
      await page
        .getByLabel('Explanation and role', { exact: true })
        .fill('The outer surface encloses this synthetic cube.');
      await expect(
        page.getByRole('button', { name: 'Confirm component and pin', exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole('combobox', { name: 'Model part', exact: true })).toBeEnabled();
      await page
        .getByRole('combobox', { name: 'Model part', exact: true })
        .selectOption({ index: 1 });
      await page.getByText('Adjust pin with keyboard', { exact: true }).click();
      const horizontal = page.getByRole('slider', { name: 'Horizontal position', exact: true });
      await horizontal.focus();
      await page.keyboard.press('ArrowRight');
      await page.getByRole('spinbutton', { name: 'Pin X coordinate', exact: true }).fill('0.123');
      await page.getByRole('button', { name: 'Place pin on model', exact: true }).click();
      await page.locator('.lesson-annotation-workspace canvas').click();
      await expect(
        page.getByRole('button', { name: 'Undo last pin placement', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Undo last pin placement', exact: true }).click();
      await expect(
        page.getByRole('spinbutton', { name: 'Pin X coordinate', exact: true }),
      ).toHaveValue('0.123');
      await page.getByRole('button', { name: 'Confirm component and pin', exact: true }).click();
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: 'Model annotations', exact: true }).click();
      await page.getByRole('button', { name: 'Cube surface Confirmed', exact: true }).click();
      await page.getByText('Adjust pin with keyboard', { exact: true }).click();
      await expect(
        page.getByRole('spinbutton', { name: 'Pin X coordinate', exact: true }),
      ).toHaveValue('0.123');
      await expect(
        page.getByRole('textbox', { name: 'Explanation and role', exact: true }),
      ).toHaveValue('The outer surface encloses this synthetic cube.');
      await page.goto(`/console/learn/library?model=${models[0].id}`);
      await page.getByRole('link', { name: 'Create lesson with AI', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Choose a model for the agent', exact: true }),
      ).toContainText('learning-cube');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.goto('/console/learn/sources');
      await page.getByRole('button', { name: 'Add material', exact: true }).click();
      await page.getByRole('button', { name: 'Write notes', exact: true }).click();
      await page.getByLabel('Source title (optional)', { exact: true }).fill('My geometry notes');
      await page
        .getByLabel('Paste notes', { exact: true })
        .fill(
          'A cube has flat faces. These synthetic geometry notes are private and can ground a lesson.',
        );
      await page.getByRole('button', { name: 'Save private notes', exact: true }).click();
      await page.getByRole('link', { name: 'Use 1 selected source with AI', exact: true }).click();
      await expect(page).toHaveURL(/sources=/);
      await expect(page.getByRole('button', { name: '1 sources', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Attach (1)', exact: true }).click();
      await expect(
        page.getByRole('checkbox', { name: 'My geometry notes · ready', exact: true }),
      ).toBeChecked();
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
