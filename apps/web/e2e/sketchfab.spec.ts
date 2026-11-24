import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
import { lessonTemplate } from '../../../packages/types/src/dto/lesson-template';
loadRootEnv({ override: false });
const uid = '1b04c610b29e4892a9afdfb8bce6d56c';
test('Sketchfab reference previews in current lessons and stays out of quizzes', async ({
  page,
}) => {
  let tenant = '';
  await page.route(`**/api/v1/tools/sketchfab/models/${uid}`, (route) =>
    route.fulfill({
      json: {
        model: {
          uid,
          name: 'Reference model',
          author: 'Reference author',
          license: 'CC BY',
          downloadable: true,
          thumbnail: null,
          url: `https://sketchfab.com/3d-models/${uid}`,
        },
      },
    }),
  );
  await page.route('https://sketchfab.com/models/**/embed**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Interactive model reference</p>' }),
  );
  try {
    const response = await page.request.post('/api/v1/auth/learners', {
      data: {
        fullName: 'Model learner',
        email: `sketch-${randomUUID()}@example.test`,
        password: 'SketchBrowser2026!',
        ageBand: '18+',
      },
    });
    expect(response.status()).toBe(201);
    tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
    const definition = lessonTemplate({
      topic: 'Inspect a model reference',
      audience: 'Learners aged 13+',
      durationMinutes: 30,
      instructions: '',
      sourceIds: [],
      sketchfabUrl: `https://sketchfab.com/3d-models/${uid}`,
    });
    const created = await page.request.post('/api/v1/learning/lesson-plans', { data: definition });
    expect(created.status()).toBe(201);
    const plan = (await created.json()).plan;
    await page.goto(`/console/learn/drafts/${plan.id}`);
    await page.getByRole('button', { name: /3\. Explore and practise/ }).click();
    await expect(page.getByTitle('Reference model — interactive Sketchfab viewer')).toBeVisible();
    await page.getByRole('button', { name: 'Study privately', exact: true }).click();
    await expect(page).toHaveURL(/\/lessons\//);
    await page.getByRole('button', { name: /3\. Explore and practise/ }).click();
    const viewer = page.getByTitle('Reference model — interactive Sketchfab viewer');
    await expect(viewer).toHaveAttribute('src', new RegExp(`${uid}/embed`));
    await page.getByRole('button', { name: /4\. Check understanding/ }).click();
    await expect(viewer).toHaveCount(0);
  } finally {
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
