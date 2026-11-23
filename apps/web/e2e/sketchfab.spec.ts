import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { demoId } from '../../../packages/db/src/demo-ids';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
const uid = '1b04c610b29e4892a9afdfb8bce6d56c';

test('model references persist through published lessons and shared rooms without entering assessments', async ({
  page,
}) => {
  let lessonId: string | undefined;
  let roomId: string | undefined;
  const title = `Sketchfab reference ${Date.now()}`;
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
  // Embedded provider rendering is checked separately in BrowserOS; this test checks our integration.
  await page.route('https://sketchfab.com/models/**/embed**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Interactive model reference</p>' }),
  );
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Lessons', exact: true })).toBeVisible();
    const created = await page.request.post('/api/v1/lessons', {
      data: {
        title,
        sourceText:
          'Inspect a model from several angles and describe its visible shape. Use the author reference to check its license before reusing it.',
        generateWithAi: false,
      },
    });
    expect(created.status()).toBe(201);
    const lesson = (await created.json()).lesson;
    lessonId = lesson.id;
    const content = {
      title,
      summary: 'Inspect a model reference from several angles.',
      narration:
        'Use the linked model for visual exploration. Read the author license before reusing any geometry.',
      outline: [`Inspect the reference https://sketchfab.com/3d-models/${uid}`],
      questions: [
        {
          id: 'license',
          prompt: 'What should you check before reusing a model?',
          options: ['Its license', 'Its name only'],
          correctOption: 0,
          explanation: 'Check the author license before reuse.',
        },
      ],
      passingScore: 80,
    };
    expect(
      (await page.request.patch(`/api/v1/lessons/${lessonId}`, { data: content })).ok(),
    ).toBeTruthy();
    expect((await page.request.post(`/api/v1/lessons/${lessonId}/publish`)).ok()).toBeTruthy();
    await page.goto(`/console/lessons?lesson=${lessonId}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const viewer = page.getByTitle('Reference model — interactive Sketchfab viewer');
    await expect(viewer).toHaveAttribute('src', new RegExp(`${uid}/embed`));
    await expect(
      page.getByRole('link', { name: 'Original model, license and author' }),
    ).toHaveAttribute('href', `https://sketchfab.com/3d-models/${uid}`);
    await page.getByRole('button', { name: /Start quiz/ }).click();
    await expect(viewer).toHaveCount(0);
    const room = await page.request.post('/api/v1/spatial/rooms', { data: { title, lessonId } });
    expect(room.status()).toBe(201);
    roomId = (await room.json()).room.id;
    expect((await page.request.post(`/api/v1/spatial/rooms/${roomId}/live`)).ok()).toBeTruthy();
    await page.goto(`/console/spaces?room=${roomId}`);
    await expect(page.getByRole('button', { name: 'Leave space', exact: true })).toBeVisible();
    // A fresh room opens the shared study; the external reference is the same released lesson content.
    const roomViewer = page.getByTitle('Reference model — interactive Sketchfab viewer');
    await expect(roomViewer).toBeVisible();
    await page.getByRole('button', { name: 'Leave space', exact: true }).click();
    await page.goto('/console/simulations');
    await page
      .getByText('Free model exploration with Sketchfab and a study guide', { exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Sketchfab model link or search' }),
    ).toBeVisible();
  } finally {
    const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await client
      .$transaction(async (db) => {
        await db.$executeRaw`SELECT set_config('app.current_tenant_id', ${demoId('tenant:aurora')}, true)`;
        if (roomId) await db.spatialRoom.deleteMany({ where: { id: roomId } });
        if (lessonId) await db.lesson.deleteMany({ where: { id: lessonId } });
      })
      .finally(() => client.$disconnect());
  }
});
