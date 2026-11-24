import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
test('owned AI edit progress survives reload and failure offers manual recovery', async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
  let tenant = '';
  try {
    expect(
      (
        await page.request.post('/api/v1/auth/learners', {
          data: {
            fullName: 'Progress learner',
            email: `progress-${randomUUID()}@example.test`,
            password: 'ProgressBrowser2026!',
            ageBand: '18+',
          },
        })
      ).status(),
    ).toBe(201);
    const me = (await (await page.request.get('/api/v1/auth/me')).json()).user;
    tenant = me.activeTenantId;
    const plan = (
      await (await page.request.post('/api/v1/learning/lesson-plans/examples/geometry')).json()
    ).plan;
    const task = await db.learningTask.create({
      data: {
        tenantId: tenant,
        ownerId: me.id,
        kind: 'plan_generate',
        status: 'active',
        input: { planId: plan.id },
        progress: [{ id: 'write', label: 'Writing your lesson', status: 'working' }],
      },
    });
    const key = `lesson-draft:${tenant}:${me.id}:${plan.id}:task`;
    await page.addInitScript(
      ({ key, taskId }) => {
        if (!sessionStorage.getItem('progress-fixture-ready')) {
          sessionStorage.setItem(key, taskId);
          sessionStorage.setItem('progress-fixture-ready', 'true');
        }
      },
      {
        key,
        taskId: task.id,
      },
    );
    await page.goto(`/console/learn/drafts/${plan.id}`);
    await expect(page.getByRole('region', { name: 'Agent activity' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Writing your lesson/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: /Writing your lesson/ })).toBeVisible();
    await db.learningTask.update({
      where: { id: task.id },
      data: {
        status: 'failed',
        error: 'The provider took too long. Your draft is saved.',
        progress: [{ id: 'write', label: 'Writing your lesson', status: 'failed' }],
      },
    });
    await expect(
      page.getByRole('button', { name: /The agent needs your attention/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'The provider took too long' }),
    ).toBeVisible();
    await expect(page.getByLabel('Agent activity').locator('.animate-spin')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit this lesson', exact: true }).click();
    await expect(page.getByLabel('Section title', { exact: true })).toBeVisible();
    const changed = structuredClone(plan.definition);
    changed.sections[2].activity.steps[0].title = 'A revised component check';
    await db.learningTask.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        error: null,
        result: {
          planId: plan.id,
          baseRevision: plan.revision,
          definition: changed,
          proposal: true,
        },
        progress: [{ id: 'write', label: 'Writing your lesson', status: 'complete' }],
      },
    });
    await page.reload();
    await expect(page.getByRole('button', { name: /Ready for your review/ })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Apply reviewed proposal', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: /3\. Explore and practise/ }).click();
    await page.getByRole('button', { name: 'Sphere', exact: true }).click();
    await page.getByRole('button', { name: 'Check selected component', exact: true }).click();
    await page.getByRole('button', { name: 'Box', exact: true }).click();
    await page.getByRole('button', { name: 'Isolate selected component', exact: true }).click();
    await page.getByRole('button', { name: 'Restore arrangement', exact: true }).click();
    await expect(page.getByText(/Activity complete\./)).toBeVisible();
    await page.getByRole('button', { name: 'Apply reviewed proposal', exact: true }).click();
    await expect(page.getByText('A revised component check', { exact: true })).toBeVisible();
    await expect(page.getByText(/Activity complete\./)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Agent activity' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit this lesson', exact: true })).toBeVisible();
  } finally {
    if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
    await db.$disconnect();
  }
});
