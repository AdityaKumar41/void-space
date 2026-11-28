import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
test('conversation history is visible and preserves every saved task after reload', async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
  let tenant = '';
  try {
    expect(
      (
        await page.request.post('/api/v1/auth/learners', {
          data: {
            fullName: 'History learner',
            email: `history-${randomUUID()}@example.test`,
            password: 'HistoryLearner2026!',
            ageBand: '18+',
          },
        })
      ).status(),
    ).toBe(201);
    const user = (await (await page.request.get('/api/v1/auth/me')).json()).user;
    tenant = user.activeTenantId;
    const thread = (
      await (
        await page.request.post('/api/v1/learning/agent/threads', {
          data: { title: 'My saved visual lesson' },
        })
      ).json()
    ).thread;
    const ids = [randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries())
      await db.learningTask.create({
        data: {
          id,
          tenantId: tenant,
          ownerId: user.id,
          kind: 'agent_turn',
          status: index ? 'failed' : 'completed',
          input: {
            threadId: thread.id,
            context: { message: index ? 'Revise the recap' : 'Create the lesson' },
          },
          error: index ? 'The provider is temporarily unavailable.' : null,
          progress: [
            {
              id: 'tool',
              label: index ? 'Revising your lesson' : 'Creating your lesson',
              status: index ? 'failed' : 'complete',
            },
          ],
          result: index ? undefined : { action: 'respond', message: 'Your draft is ready.' },
        },
      });
    await db.learningThread.update({
      where: { id: thread.id },
      data: {
        messages: [
          { role: 'user', content: 'Create the lesson', taskId: ids[0] },
          { role: 'assistant', content: 'Your draft is ready.', taskId: ids[0] },
          { role: 'user', content: 'Revise the recap', taskId: ids[1] },
        ],
      },
    });
    await page.goto('/console/learn/agent');
    const composer = page.getByRole('textbox', {
      name: 'Message your learning agent',
      exact: true,
    });
    const initialHeight = (await composer.boundingBox())!.height;
    await page.getByRole('button', { name: 'Search conversations' }).click();
    await expect(page.getByRole('region', { name: 'Conversations', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Search conversations' })).toBeFocused();
    await page.getByRole('button', { name: 'Search conversations' }).click();
    await page.getByRole('button', { name: 'My saved visual lesson', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(composer).toHaveCSS('min-height', '48px');
    expect((await composer.boundingBox())!.height).toBe(initialHeight);
    await composer.focus();
    await expect(composer).toHaveCSS('outline-style', 'none');
    await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toContainText(
      'Your draft is ready.',
    );
    await page
      .getByRole('region', { name: 'Conversation', exact: true })
      .getByRole('button', { name: /Ready for your review/ })
      .click();
    await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toContainText(
      'Creating your lesson',
    );
    await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toContainText(
      'Revising your lesson',
    );
    await page.reload();
    await page
      .getByRole('region', { name: 'Conversation', exact: true })
      .getByRole('button', { name: /Ready for your review/ })
      .click();
    await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toContainText(
      'Creating your lesson',
    );
  } finally {
    if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
    await db.$disconnect();
  }
});

test('teaching memberships hide personal progress while students keep it', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
  let tenant = '';
  try {
    expect(
      (
        await page.request.post('/api/v1/auth/register', {
          data: {
            organizationName: 'Role-aware institution',
            fullName: 'Role teacher',
            email: `role-teacher-${randomUUID()}@example.test`,
            password: 'RoleTeacher2026!',
          },
        })
      ).status(),
    ).toBe(201);
    const user = (await (await page.request.get('/api/v1/auth/me')).json()).user;
    tenant = user.activeTenantId;
    await page.goto('/console/learn');
    await expect(
      page.getByRole('link', { name: 'My teaching materials', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'My progress', exact: true })).toHaveCount(0);
    await page.goto('/console/learn/progress');
    await expect(
      page.getByRole('heading', { name: 'Teaching workspace', exact: true }),
    ).toBeVisible();
    await db.userRole.deleteMany({ where: { userId: user.id } });
    const learner = await db.role.findUniqueOrThrow({ where: { name: 'Learner' } });
    await db.userRole.create({ data: { tenantId: tenant, userId: user.id, roleId: learner.id } });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'My progress', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My progress', exact: true })).toBeVisible();
  } finally {
    await context.close();
    if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
    await db.$disconnect();
  }
});
