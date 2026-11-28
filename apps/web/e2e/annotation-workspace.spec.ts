import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
import { solidCubeFixture } from './solid-cube-fixture';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`model study and precise AI annotation workspace (${mobile ? 'touch' : 'desktop'})`, async ({
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
    const rootUnmountErrors: string[] = [];
    page.on('console', (event) => {
      if (event.type() === 'error' && event.text().includes('synchronously unmount a root'))
        rootUnmountErrors.push(event.text());
    });
    let tenant = '';
    try {
      const registration = await page.request.post('/api/v1/auth/learners', {
        data: {
          fullName: 'Annotation learner',
          email: `annotations-${randomUUID()}@example.test`,
          password: 'AnnotationTest2026!',
          ageBand: '18+',
        },
      });
      expect(registration.status()).toBe(201);
      const user = (await registration.json()).user;
      tenant = user.activeTenantId;
      const upload = async (name: string) => {
        const result = await page.request.post('/api/v1/learning/library/upload', {
          multipart: {
            file: {
              name: `${name}.glb`,
              mimeType: 'model/gltf-binary',
              buffer: solidCubeFixture(),
            },
          },
        });
        expect(result.status()).toBe(201);
        return (await result.json()).model;
      };
      const model = await upload('Study cube');
      await upload('Other model');
      const label = {
        id: 'surface',
        meshKey: model.metadata.parts[0].key,
        label: 'Cube surface',
        explanation: 'The outer surface encloses the cube.',
        position: [0.1, 0.1, 0.1],
        sourceRefs: [],
      };
      expect(
        (
          await page.request.patch(`/api/v1/learning/library/${model.id}/labels`, {
            data: { revision: 0, reviewed: true, labels: [label] },
          })
        ).status(),
      ).toBe(200);
      await page.goto('/console/learn/library');
      await expect(page.locator('.library-model-card')).toHaveCount(2);
      await page.locator('.library-model-card').filter({ hasText: 'Study cube' }).click();
      await expect(page).toHaveURL(new RegExp(`/library/${model.id}$`));
      await expect(page.getByRole('complementary', { name: 'Your private models' })).toHaveCount(0);
      await expect(page.getByText('Other model', { exact: true })).toHaveCount(0);
      await expect(page.getByText(label.explanation, { exact: true })).toBeVisible();
      const study = page.locator('.library-browser.is-model');
      const studyBounds = await study.boundingBox();
      const mainBounds = await page.locator('#main').boundingBox();
      expect(studyBounds!.x - mainBounds!.x).toBeGreaterThanOrEqual(mobile ? 16 : 19);
      expect(
        mainBounds!.x + mainBounds!.width - studyBounds!.x - studyBounds!.width,
      ).toBeGreaterThanOrEqual(mobile ? 16 : 19);
      const stageBounds = await page.locator('.library-viewport canvas').boundingBox();
      expect(stageBounds!.height).toBeLessThanOrEqual(mobile ? 421 : 581);
      await expect(page.locator('.agent-topbar')).toContainText('Library / Model');
      if (!mobile)
        await expect(page.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute(
          'aria-current',
          'page',
        );
      await expect(
        page.getByRole('button', { name: 'Start lesson manually', exact: true }),
      ).not.toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);

      await page.getByRole('link', { name: 'Open annotation editor', exact: true }).click();
      await expect(page).toHaveURL(/\/annotate$/);
      await expect(page.getByRole('navigation', { name: 'Workspace sections' })).toHaveCount(0);
      for (const view of ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso']) {
        await page.getByLabel('Camera angle', { exact: true }).selectOption(view);
        await expect(page.getByLabel('Camera angle', { exact: true })).toHaveValue(view);
      }
      await page.getByLabel('Viewport shading', { exact: true }).selectOption('wireframe');
      await page.getByLabel('Viewport shading', { exact: true }).selectOption('shaded');
      await page.getByRole('button', { name: 'Perspective', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Orthographic', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'Frame model', exact: true }).click();
      await page.getByRole('button', { name: 'Move pin in 3D', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Move pin in 3D', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByLabel('Camera angle', { exact: true }).selectOption('front');
      await page.getByRole('button', { name: 'Frame model', exact: true }).click();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: mobile ? '/tmp/pin-gizmo-touch.png' : '/tmp/pin-gizmo-desktop.png',
      });
      if (!mobile) {
        const pin = await page
          .getByRole('button', { name: 'Scene target 1', exact: true })
          .boundingBox();
        expect(pin).toBeTruthy();
        const x = pin!.x + pin!.width / 2,
          y = pin!.y + pin!.height / 2;
        await page.mouse.move(x - 40, y);
        await page.mouse.down();
        await page.mouse.move(x - 75, y, { steps: 8 });
        await page.mouse.up();
      }
      await page.getByRole('button', { name: 'Move pin in 3D', exact: true }).click();
      await page.getByText('Advanced: mesh attachment & sources', { exact: true }).click();
      if (!mobile) {
        await expect(page.getByLabel('Pin X coordinate', { exact: true })).not.toHaveValue('0.1');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(page.getByLabel('Pin X coordinate', { exact: true })).toHaveValue('0.1');
      }
      await page.getByLabel('Pin X coordinate', { exact: true }).fill('0.25');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByLabel('Pin X coordinate', { exact: true })).toHaveValue('0.1');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.getByLabel('Pin X coordinate', { exact: true })).toHaveValue('0.25');
      await page.getByRole('button', { name: 'Confirm pin coordinates', exact: true }).click();
      await page.getByRole('button', { name: 'Save annotations', exact: true }).click();
      await expect(page.getByText('All changes saved', { exact: false })).toBeVisible();
      let latestTask = '';
      await page.route('**/api/v1/learning/agent/threads/*/messages', async (route) => {
        const payload = route.request().postDataJSON();
        expect(payload.annotationWorkspace).toBe(true);
        expect(payload.privateModelId).toBe(model.id);
        const saved = await db.learningSource.findUniqueOrThrow({ where: { id: model.id } });
        const meta = saved.metadata as { revision: number };
        latestTask = randomUUID();
        await db.learningTask.create({
          data: {
            id: latestTask,
            tenantId: tenant,
            ownerId: user.id,
            kind: 'agent_turn',
            status: 'completed',
            input: {},
            result: {
              modelId: model.id,
              modelRevision: meta.revision,
              labels: [
                {
                  ...label,
                  label: 'AI surface draft',
                  explanation: 'A proposed description that needs author review.',
                  position: [0.2, 0.2, 0.2],
                  confidence: 'named',
                },
              ],
            },
          },
        });
        await route.fulfill({ status: 202, json: { taskId: latestTask } });
      });
      await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Ask AI to annotate this model', exact: true })
        .fill('Improve the annotation explanation.');
      const originalCanvas = await page.locator('.library-viewport canvas').elementHandle();
      await page.getByRole('button', { name: 'Send annotation request', exact: true }).click();
      await expect(
        page.getByText('AI proposal · review on the model', { exact: true }),
      ).toBeVisible();
      expect(
        await originalCanvas!.evaluate(
          (node) => node === document.querySelector('.library-viewport canvas'),
        ),
      ).toBe(true);
      await expect(
        page.getByText('AI changes are ready while you have unsaved edits.', { exact: false }),
      ).toHaveCount(0);
      expect(
        (await db.learningSource.findUniqueOrThrow({ where: { id: model.id } })).metadata,
      ).not.toMatchObject({ labels: [{ label: 'AI surface draft' }] });
      await page.getByRole('tab', { name: /Annotations \(1\)/ }).click();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('AI surface draft');
      await page.getByLabel('Name', { exact: true }).fill('Reviewed cube surface');
      await page
        .getByRole('checkbox', { name: 'I checked names, explanations and positions', exact: true })
        .check();
      await page.getByRole('button', { name: 'Save annotations', exact: true }).click();
      await expect(page.getByText('Reviewed annotations saved.', { exact: true })).toBeVisible();
      await page.goto(`/console/learn/library/${model.id}`);
      await expect(
        page.getByRole('heading', { name: 'Reviewed cube surface', exact: true }),
      ).toBeVisible();
      await page.getByText('More actions', { exact: true }).click();
      await page.getByRole('button', { name: 'Start lesson manually', exact: true }).click();
      await expect(page).toHaveURL(/\/drafts\//);
      await expect(
        page.getByRole('button', { name: 'Reviewed cube surface', exact: true }),
      ).toBeVisible();
      // A delayed proposal cannot overwrite the newer saved revision.
      await page.goto(`/console/learn/library/${model.id}/annotate?proposal=${latestTask}`);
      await expect(
        page.getByRole('alert').filter({ hasText: 'older model revision' }),
      ).toBeVisible();
      await page.getByRole('tab', { name: /Annotations/ }).click();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Reviewed cube surface');
      await page.goto(`/console/learn/agent?model=${model.id}`);
      await page
        .getByRole('textbox', { name: 'Message your learning agent', exact: true })
        .fill('Improve the annotations on this model.');
      await page.getByRole('button', { name: 'Send to personal agent', exact: true }).click();
      await expect(page).toHaveURL(/\/annotate\?thread=/);
      await expect(page.getByRole('region', { name: 'Model AI assistant' })).toBeVisible();
      await expect(
        page.getByText('AI proposal · review on the model', { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      expect(rootUnmountErrors).toEqual([]);
    } finally {
      await context.close();
      if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
      await db.$disconnect();
    }
  });
