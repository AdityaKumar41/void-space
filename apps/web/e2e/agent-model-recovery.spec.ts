import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
import { buildGlbFixture } from '../../../packages/db/src/glb-fixture';
loadRootEnv({ override: false });
test('selected model survives a conversation reload and provider failure returns to that model', async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
  let tenant = '';
  try {
    expect(
      (
        await page.request.post('/api/v1/auth/learners', {
          data: {
            fullName: 'Model recovery learner',
            email: `model-recovery-${randomUUID()}@example.test`,
            password: 'ModelRecovery2026!',
            ageBand: '18+',
          },
        })
      ).status(),
    ).toBe(201);
    const user = (await (await page.request.get('/api/v1/auth/me')).json()).user;
    tenant = user.activeTenantId;
    const upload = await page.request.post('/api/v1/learning/library/upload', {
      multipart: {
        file: {
          name: 'recovery-model.glb',
          mimeType: 'model/gltf-binary',
          buffer: buildGlbFixture(12),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const model = (await upload.json()).model;
    await page.goto(`/console/learn/agent?model=${model.id}`);
    const taskId = randomUUID();
    let threadId = '';
    // Reproduce a terminal provider failure without depending on a live external model.
    await page.route('**/api/v1/learning/agent/threads/*/messages', async (route) => {
      const payload = route.request().postDataJSON();
      expect(payload.privateModelId).toBe(model.id);
      threadId = route.request().url().split('/').at(-2)!;
      await db.learningTask.create({
        data: {
          id: taskId,
          tenantId: tenant,
          ownerId: user.id,
          kind: 'agent_turn',
          status: 'failed',
          input: { context: { privateModelId: model.id } },
          error: 'No configured text provider returned a valid response',
          progress: [{ id: 'understand', label: 'Understanding your request', status: 'failed' }],
        },
      });
      await db.learningThread.update({
        where: { id: threadId },
        data: {
          messages: [{ role: 'user', content: payload.message, taskId }],
          revision: { increment: 1 },
        },
      });
      await route.fulfill({ status: 202, json: { taskId, threadId } });
    });
    await page.getByRole('button', { name: 'Explore my 3D model', exact: true }).click();
    await page.getByRole('button', { name: 'Send to personal agent', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`model=${model.id}.*thread=`));
    await expect(
      page.getByRole('alert').filter({ hasText: 'The AI service could not finish' }),
    ).toBeVisible();
    // Reopen from a bare history link, which has no model query parameter.
    await page.goto(`/console/learn/agent?thread=${threadId}`);
    await expect(page).toHaveURL(new RegExp(`model=${model.id}`));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Choose a model for the agent' })).toContainText(
      'recovery-model',
    );
    await page.getByRole('button', { name: /Remove model/ }).click();
    await expect(page).not.toHaveURL(new RegExp(`model=${model.id}`));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Choose a model for the agent' })).toContainText(
      'Choose a model',
    );
    // An explicit selection after removal must also survive reload.
    await page.getByRole('button', { name: 'Choose a model for the agent' }).click();
    await page.getByRole('searchbox', { name: 'Search models' }).fill('recovery-model');
    await page
      .getByRole('dialog', { name: 'Choose a learning model' })
      .getByRole('button', { name: /recovery-model/ })
      .click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Choose a model for the agent' })).toContainText(
      'recovery-model',
    );
    await page
      .getByRole('link', { name: 'Continue with this model without AI', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/library\\?model=${model.id}`));
    await page.getByText('More actions', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Start lesson manually', exact: true }),
    ).toBeVisible();
  } finally {
    if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
    await db.$disconnect();
  }
});
