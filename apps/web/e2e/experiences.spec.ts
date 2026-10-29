import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { demoId } from '../../../packages/db/src/demo-ids';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });

test('scene authoring and operation-based experience, consequence, resume and replay', async ({
  page,
}) => {
  let id: string | undefined;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const title = `Spatial interaction ${Date.now()}`;
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Practice', exact: true })).toBeVisible();
    const assets = await page.request.get('/api/v1/lessons/assets');
    const asset = (await assets.json()).assets.find(
      (a: { name: string }) => a.name === 'Cordless Impact Drill',
    );
    expect(asset.media.cid).toBeTruthy();
    const base = {
      weight: 100,
      explanation: 'Inspect the component arrangement of the reviewed model.',
    };
    const created = await page.request.post('/api/v1/simulations', {
      data: {
        title,
        description:
          'Identify a component, separate and isolate real mesh components, restore the model and respond to a reported discrepancy.',
        experience: {
          schemaVersion: 1,
          assetId: asset.id,
          passingScore: 80,
          hotspots: [
            { id: 'housing', label: 'Housing', meshKey: 'mesh-0', position: [-0.25, 0.12, 0.1] },
            { id: 'battery', label: 'Battery', meshKey: 'mesh-2', position: [0, -0.25, 0.1] },
          ],
          steps: [
            {
              ...base,
              id: 'identify',
              kind: 'identify',
              targetId: 'housing',
              title: 'Locate the housing',
              instruction: 'Select the housing marker on the reviewed 3D object.',
            },
            {
              ...base,
              id: 'explode',
              kind: 'operate',
              operation: 'explode',
              title: 'Explore the separated parts',
              instruction: 'Use Explode model to separate the real mesh components.',
            },
            {
              ...base,
              id: 'isolate',
              kind: 'operate',
              operation: 'isolate',
              targetId: 'housing',
              title: 'Isolate the housing',
              instruction: 'Keep the housing selected and use Isolate selected.',
            },
            {
              ...base,
              id: 'assemble',
              kind: 'operate',
              operation: 'assemble',
              title: 'Restore the assembled object',
              instruction: 'Use Reassemble / show all to restore the object.',
            },
            {
              ...base,
              id: 'decision',
              kind: 'decision',
              title: 'Respond to the discrepancy',
              instruction:
                'The source description does not match a component. Choose the next action.',
              correctChoiceId: 'review',
              onIncorrect: 'end',
              choices: [
                {
                  id: 'review',
                  label: 'Request a source review',
                  feedback: 'The discrepancy is recorded for review before the material is reused.',
                },
                {
                  id: 'ignore',
                  label: 'Ignore the discrepancy',
                  feedback: 'The discrepancy remains unresolved. This assessment ends here.',
                },
              ],
            },
          ],
        },
      },
    });
    expect(created.status()).toBe(201);
    id = (await created.json()).scenario.id;
    expect((await page.request.post(`/api/v1/simulations/${id}/publish`)).status()).toBe(200);
    await page.getByRole('link', { name: 'Practice', exact: true }).click();
    await page
      .getByRole('heading', { name: title, exact: true })
      .locator('../..')
      .getByRole('button', { name: 'Enter experience' })
      .click();
    await page.getByRole('button', { name: 'Begin assessment', exact: true }).click();
    await expect(
      page.getByText('Cordless Impact Drill · interactive scene', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Scene target 1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Explore the separated parts' })).toBeVisible();
    await page.getByRole('button', { name: 'Explode model', exact: true }).click();
    await expect(page.locator('.studio[data-exploded=true]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Isolate the housing' })).toBeVisible();
    await page.screenshot({ path: '/tmp/void-spatial-exploded.png', fullPage: true });
    await page.getByRole('button', { name: 'Isolate selected', exact: true }).click();
    await expect(page.locator('.studio[data-isolated-target=housing]')).toBeVisible();
    await page.getByRole('button', { name: 'Reassemble / show all', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Respond to the discrepancy' })).toBeVisible();
    // A reload resumes the server's current task, rather than resetting progress.
    await page.reload();
    await page
      .getByRole('heading', { name: title, exact: true })
      .locator('../..')
      .getByRole('button', { name: 'Enter experience' })
      .click();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Respond to the discrepancy' })).toBeVisible();
    await page.getByRole('button', { name: 'Ignore the discrepancy', exact: true }).click();
    await expect(page.getByText('ATTEMPT FINISHED', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review action replay' }).click();
    await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveAttribute('max', '5');
    await page.getByRole('slider', { name: 'Replay position' }).fill('2');
    await expect(page.locator('.studio[data-exploded=true]')).toBeVisible();
    await page.screenshot({ path: '/tmp/void-spatial-replay.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await db
      .$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${demoId('tenant:aurora')}, true)`;
        if (id) await tx.simulationScenario.deleteMany({ where: { id } });
      })
      .finally(() => db.$disconnect());
  }
});

test('author places a target on actual geometry, saves a draft, reopens it and publishes', async ({
  page,
}) => {
  const title = `Visual authoring ${Date.now()}`;
  let id: string | undefined;
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Practice', exact: true }).click();
    await page.getByRole('button', { name: 'Build an experience', exact: true }).click();
    await page.getByLabel('Experience title', { exact: true }).fill(title);
    await page
      .getByLabel('Learning objective and source context', { exact: true })
      .fill('Locate the battery component on the reviewed drill model.');
    await page
      .getByLabel('Approved source asset', { exact: true })
      .selectOption({ label: 'Cordless Impact Drill' });
    const place = page.getByRole('button', { name: 'Place a target', exact: true });
    await expect(place).toBeEnabled();
    await place.click();
    const canvas = page.locator('.studio canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).toBeTruthy();
    await canvas.click({ position: { x: bounds!.width * 0.5, y: bounds!.height * 0.55 } });
    await page.screenshot({ path: '/tmp/void-spatial-authoring.png', fullPage: true });
    await expect(page.getByLabel('Selected target label', { exact: true })).toBeVisible();
    await page.getByLabel('Selected target label', { exact: true }).fill('Inspection target');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
    const scenarios = await page.request.get('/api/v1/simulations?includeDrafts=true');
    id = (await scenarios.json()).scenarios.find((s: { title: string }) => s.title === title).id;
    const author = (await (await page.request.get(`/api/v1/simulations/${id}/author`)).json())
      .scenario;
    expect(author.definition.hotspots[0].meshKey).toMatch(/^mesh-/);
    expect(author.definition.steps[0].targetId).toBe(author.definition.hotspots[0].id);
    await page.reload();
    await page
      .getByRole('heading', { name: title, exact: true })
      .locator('../..')
      .getByRole('button', { name: 'Continue authoring', exact: true })
      .click();
    await expect(page.getByLabel('Selected target label', { exact: true })).toHaveValue(
      'Inspection target',
    );
    await page.getByRole('button', { name: 'Publish experience', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Spatial learning experiences', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('heading', { name: title, exact: true })
        .locator('../..')
        .getByRole('button', { name: 'Enter experience', exact: true }),
    ).toBeVisible();
  } finally {
    // Only the uniquely named scenario created by this test is removed.
    const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await db
      .$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${demoId('tenant:aurora')}, true)`;
        await tx.simulationScenario.deleteMany({ where: { title, ...(id ? { id } : {}) } });
      })
      .finally(() => db.$disconnect());
  }
});
