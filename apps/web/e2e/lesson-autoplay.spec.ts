import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`timed presentation and individual progress (${mobile ? 'touch' : 'desktop'})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
    let tenant = '';
    try {
      // Test speech lifecycle without depending on an OS voice or external speech service.
      await page.addInitScript(() => {
        const records = { spoken: [] as string[], canceled: 0, paused: 0, resumed: 0 };
        Object.defineProperty(window, '__narration', { value: records });
        Object.defineProperty(window, 'speechSynthesis', {
          value: {
            speak: (u: SpeechSynthesisUtterance) => records.spoken.push(u.text),
            cancel: () => records.canceled++,
            pause: () => records.paused++,
            resume: () => records.resumed++,
          },
        });
      });
      expect(
        (
          await page.request.post('/api/v1/auth/learners', {
            data: {
              fullName: 'Presentation QA',
              email: `presentation-${randomUUID()}@example.test`,
              password: 'PresentationQA2026!',
              ageBand: '18+',
            },
          })
        ).status(),
      ).toBe(201);
      tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
      const plan = (
        await (await page.request.post('/api/v1/learning/lesson-plans/examples/geometry')).json()
      ).plan;
      const snapshot = await page.request.post(`/api/v1/learning/lesson-plans/${plan.id}/study`);
      expect(snapshot.ok()).toBe(true);
      const { release } = await snapshot.json();
      const url = `/api/v1/learning/lesson-plans/releases/${release.id}?tenant=${tenant}&present=true`;
      const before = (await (await page.request.get(url)).json()).progress;
      let events = 0;
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().includes('/events')) events++;
      });
      await page.goto(`/console/learn/lessons/${release.id}?tenant=${tenant}&present=true`);
      await expect(page.getByRole('button', { name: 'Start autoplay', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Lesson sections' })).not.toBeVisible();
      await page.clock.install();
      await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { __narration: { spoken: string[] } }).__narration.spoken.join(
              ' ',
            ),
          ),
        )
        .toContain(plan.definition.sections[0].title);
      await page.getByRole('button', { name: 'Start autoplay', exact: true }).click();
      await page.clock.fastForward(1000);
      await page.getByRole('button', { name: 'Pause timer', exact: true }).click();
      const paused = await page.getByLabel('Section timer', { exact: true }).textContent();
      await page.clock.fastForward(20000);
      await expect(page.getByLabel('Section timer', { exact: true })).toHaveText(paused!);
      await page.getByRole('button', { name: 'Start timer', exact: true }).click();
      await page.clock.fastForward(plan.definition.sections[0].minutes * 60000 + 1000);
      await expect(
        page.getByRole('heading', { name: plan.definition.sections[1].title, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop autoplay', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Next section', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Start autoplay', exact: true })).toBeVisible();
      const exploration = plan.definition.sections[2];
      await page.getByRole('button', { name: 'Start autoplay', exact: true }).click();
      await page.clock.fastForward((exploration.minutes * 60000) / 3 + 1000);
      await expect(page.getByRole('complementary', { name: 'Selected component' })).toContainText(
        exploration.activity.targets[0].label,
      );
      await page.getByRole('button', { name: 'Stop autoplay', exact: true }).click();
      await page.getByRole('button', { name: 'Presenter tools', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Lesson sections' })).toBeVisible();
      await page.getByRole('button', { name: /5\. Recap and next steps/ }).click();
      await page.getByRole('button', { name: 'Hide presenter tools', exact: true }).click();
      await page.getByRole('button', { name: 'Start autoplay', exact: true }).click();
      await page.clock.fastForward(plan.definition.sections.at(-1).minutes * 60000 + 1000);
      await expect(page.getByRole('region', { name: 'Presentation controls' })).toContainText(
        'Presentation complete.',
      );
      expect(events).toBe(0);
      const after = (await (await page.request.get(url)).json()).progress;
      expect(after).toEqual(before);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    } finally {
      await context.close();
      if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
      await db.$disconnect();
    }
  });
