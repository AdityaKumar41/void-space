import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`playground keeps AI beside the stage and opens study/present (${mobile ? 'touch' : 'desktop'})`, async ({
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
    let tenant = '';
    try {
      const registered = await page.request.post('/api/v1/auth/learners', {
        data: {
          fullName: 'Playground learner',
          email: `playground-${randomUUID()}@example.test`,
          password: 'Playground2026!',
          ageBand: '18+',
        },
      });
      expect(registered.status()).toBe(201);
      const user = (await (await page.request.get('/api/v1/auth/me')).json()).user;
      tenant = user.activeTenantId;
      const plan = (
        await (await page.request.post('/api/v1/learning/lesson-plans/examples/geometry')).json()
      ).plan;
      const task = await db.learningTask.create({
        data: {
          tenantId: tenant,
          ownerId: user.id,
          kind: 'plan_generate',
          status: 'active',
          input: { planId: plan.id },
          progress: [{ id: 'draft', label: 'Refining lesson', status: 'working' }],
        },
      });
      await page.goto(`/console/learn/drafts/${plan.id}?proposal=${task.id}`);
      await expect(page.getByRole('heading', { name: plan.title, exact: true })).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(1);
      await expect(page.getByRole('complementary', { name: 'Learning navigation' })).toHaveCount(0);
      const viewport = page.viewportSize()!;
      const frame = await page.locator('.lesson-playground').boundingBox();
      expect(frame!.x).toBe(0);
      expect(frame!.y).toBe(0);
      expect(Math.abs(frame!.width - viewport.width)).toBeLessThan(2);
      expect(Math.abs(frame!.height - viewport.height)).toBeLessThan(2);
      const timeline = await page
        .getByRole('complementary', { name: 'Lesson outline' })
        .boundingBox();
      expect(timeline!.y + timeline!.height).toBeLessThanOrEqual(viewport.height + 1);

      const stage = page.getByRole('region', { name: 'Lesson stage and timeline' });
      const before = await stage.boundingBox();
      expect(before).toBeTruthy();
      if (mobile) await page.getByRole('button', { name: /^Assistant/ }).click();
      await expect(
        page.getByRole('heading', { name: 'Lesson assistant', exact: true }),
      ).toBeVisible();
      const definition = structuredClone(plan.definition);
      definition.sections[2].activity.targets[0].label = 'Proposed geometry landmark';
      definition.sections[0].body =
        'Explore these geometric components and compare the shape of each surface.';
      await db.learningTask.update({
        where: { id: task.id },
        data: {
          status: 'completed',
          progress: [{ id: 'draft', label: 'Draft ready', status: 'complete' }],
          result: { planId: plan.id, baseRevision: 0, definition, proposal: true },
        },
      });
      await expect(page.getByRole('heading', { name: 'Review the proposal' })).toBeVisible({
        timeout: 10000,
      });
      // Completing AI never adds another canvas or replaces the draft on stage.
      await expect(page.locator('canvas')).toHaveCount(1);
      if (mobile) await page.getByRole('button', { name: 'Lesson', exact: true }).click();
      const after = await stage.boundingBox();
      expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
      expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
      await page.getByRole('button', { name: 'Model annotations', exact: true }).click();
      if (mobile) await page.getByRole('button', { name: /^Assistant/ }).click();
      await page.getByRole('button', { name: 'Preview proposal on stage' }).click();
      await expect(page.getByText(definition.sections[0].body, { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Proposed geometry landmark', exact: true }),
      ).toBeVisible();
      if (mobile) await page.getByRole('button', { name: /^Assistant/ }).click();
      await page.getByRole('button', { name: 'Apply reviewed proposal' }).click();
      if (mobile) await page.getByRole('button', { name: 'Lesson', exact: true }).click();
      await expect(page.getByText(definition.sections[0].body, { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.getByRole('button', { name: 'Study privately', exact: true }).click();
      await expect(page.getByText('Study playground', { exact: true })).toBeVisible();
      await page
        .getByRole('navigation', { name: 'Lesson modes' })
        .getByRole('link', { name: 'Create', exact: true })
        .click();
      await page.getByRole('button', { name: 'Present draft', exact: true }).click();
      await expect(page.getByText('Presenting lesson', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Presenter tools', exact: true }).click();
      await page.getByRole('button', { name: /5\. Recap and next steps/ }).click();
      await expect(
        page.getByRole('heading', { name: 'Recap and next steps', exact: true }),
      ).toBeVisible();
      const presentation = await page.locator('.lesson-playground').boundingBox();
      expect(presentation!.height).toBe(viewport.height);
      const sections = await page
        .getByRole('navigation', { name: 'Lesson sections' })
        .boundingBox();
      expect(sections!.y + sections!.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(
        page.getByRole('button', { name: 'Export editable PPTX', exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
      if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
      await db.$disconnect();
    }
  });
