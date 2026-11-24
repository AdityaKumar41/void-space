import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`reviewed lesson presentation, code sharing, study and recap (${mobile ? 'touch' : 'keyboard'})`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const teacherContext = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 1000 },
      }),
      studentContext = await browser.newContext({
        baseURL,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        isMobile: mobile,
        hasTouch: mobile,
      });
    const teacher = await teacherContext.newPage(),
      page = await studentContext.newPage();
    let planId = '',
      tenantId = '',
      teacherTenant = '';
    const errors: string[] = [];
    teacher.on('pageerror', (e) => errors.push(e.message));
    page.on('pageerror', (e) => errors.push(e.message));
    const use = async (locator: Locator) => {
      await expect(locator).toBeEnabled();
      if (mobile) await locator.tap();
      else {
        await locator.focus();
        await expect(locator).toBeFocused();
        await page.keyboard.press('Enter');
      }
    };
    try {
      const registration = await teacher.request.post('/api/v1/auth/register', {
        data: {
          organizationName: `Lesson browser institution ${randomUUID().slice(0, 8)}`,
          fullName: 'Browser educator',
          email: `educator-${randomUUID()}@example.test`,
          password: 'LessonBrowser2026!',
        },
      });
      expect(registration.status()).toBe(201);
      teacherTenant = (await (await teacher.request.get('/api/v1/auth/me')).json()).user
        .activeTenantId;
      await teacher.goto('/console/learn');
      await expect(teacher.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible();
      await teacher.getByText('Try a complete example', { exact: true }).click();
      await expect(
        teacher.getByRole('button', { name: '3D components', exact: true }),
      ).toBeEnabled();
      await teacher.getByRole('button', { name: '3D components', exact: true }).click();
      await expect(teacher).toHaveURL(/\/console\/learn\/drafts\//);
      planId = teacher.url().split('/').at(-1)!;
      await expect(
        teacher.getByRole('button', { name: 'Preview lesson', exact: true }),
      ).toBeEnabled();
      await teacher.getByRole('button', { name: 'Preview lesson', exact: true }).click();
      await teacher.getByRole('button', { name: /3\. Explore and practise/ }).click();
      await expect(teacher.locator('canvas')).toHaveCount(1);
      await teacher.getByRole('button', { name: 'Sphere', exact: true }).click();
      await teacher.getByRole('button', { name: 'Check selected component', exact: true }).click();
      await expect(
        teacher.getByText('Select the box and isolate it.', { exact: true }),
      ).toBeVisible();
      await teacher.getByRole('button', { name: 'Return to editing', exact: true }).click();
      for (const label of [
        'I reviewed the facts and explanations',
        'I checked every quiz answer and explanation',
        'I previewed the visuals and confirmed component mappings',
        'I have permission to use and share these materials',
      ])
        await teacher.getByRole('checkbox', { name: label, exact: true }).check();
      await teacher.getByRole('button', { name: 'Publish reviewed lesson', exact: true }).click();
      await expect(
        teacher.getByRole('link', { name: 'Present published lesson', exact: true }),
      ).toBeVisible();
      await teacher.getByRole('link', { name: 'Present published lesson', exact: true }).click();
      await expect(teacher.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
      await teacher.getByRole('button', { name: 'Start timer', exact: true }).click();
      await teacher.getByRole('button', { name: 'Pause timer', exact: true }).click();
      await teacher.getByRole('link', { name: 'Switch to study', exact: true }).click();
      await teacher.getByRole('button', { name: 'Create lesson link', exact: true }).click();
      const code = await teacher.getByLabel('Lesson code', { exact: true }).inputValue();
      expect(code.split('.')).toHaveLength(3);
      const next = `/console/learn/join?code=${encodeURIComponent(code)}`;
      await page.goto(`/learn/signup?next=${encodeURIComponent(next)}`);
      await page.getByLabel('Full name', { exact: true }).fill('Lesson browser learner');
      await page
        .getByLabel('Email', { exact: true })
        .fill(`lesson-browser-${randomUUID()}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('LessonBrowser2026!');
      await page.getByLabel('Age range').selectOption('13-17');
      await use(page.getByRole('button', { name: 'Create learner account', exact: true }));
      await expect(page).toHaveURL(/\/console\/learn\/join/);
      const me = await (await page.request.get('/api/v1/auth/me')).json();
      tenantId = me.user.activeTenantId;
      expect(me.user.roles).toEqual(['Learner']);
      await expect(page.getByLabel('Lesson code', { exact: true })).toHaveValue(code);
      await use(page.getByRole('button', { name: 'Open lesson', exact: true }));
      await expect(page).toHaveURL(/\/console\/learn\/lessons\//);
      await expect(
        page.getByRole('button', { name: 'Save and continue', exact: true }),
      ).toBeEnabled();
      await use(page.getByRole('button', { name: 'Save and continue', exact: true }));
      await expect(
        page.getByRole('heading', { name: 'Build understanding', exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Build understanding', exact: true }),
      ).toBeVisible();
      await use(page.getByRole('button', { name: 'Save and continue', exact: true }));
      await expect(page.locator('canvas')).toHaveCount(1);
      await use(page.getByRole('button', { name: 'Sphere', exact: true }));
      await use(page.getByRole('button', { name: 'Check selected component', exact: true }));
      await use(page.getByRole('button', { name: 'Box', exact: true }));
      await use(page.getByRole('button', { name: 'Isolate selected component', exact: true }));
      await use(page.getByRole('button', { name: 'Restore arrangement', exact: true }));
      await use(page.getByRole('button', { name: 'Save and continue', exact: true }));
      await expect(
        page.getByRole('heading', { name: 'Check understanding', exact: true }),
      ).toBeVisible();
      const wrong = page.getByRole('checkbox', {
        name: 'Treat a plausible guess as a verified fact',
        exact: true,
      });
      if (mobile) await wrong.tap();
      else await wrong.check();
      await use(page.getByRole('button', { name: 'Check answer', exact: true }));
      await expect(
        page.getByText(
          'That does not match the reviewed activity. Revisit the source and try again.',
          { exact: true },
        ),
      ).toBeVisible();
      const correct = page.getByRole('checkbox', {
        name: 'Consult reviewed sources or ask the author',
        exact: true,
      });
      if (mobile) await correct.tap();
      else await correct.check();
      await use(page.getByRole('button', { name: 'Check answer', exact: true }));
      await use(page.getByRole('button', { name: 'Save and continue', exact: true }));
      await use(page.getByRole('button', { name: 'Finish lesson', exact: true }));
      await expect(
        page.getByRole('heading', { name: 'Your lesson recap', exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
      await use(page.getByRole('button', { name: 'Download personal PDF', exact: true }));
      await expect(page.getByRole('button', { name: 'Save export file', exact: true })).toBeVisible(
        { timeout: 45000 },
      );
      const download = page.waitForEvent('download');
      await use(page.getByRole('button', { name: 'Save export file', exact: true }));
      expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
      await teacher.getByRole('button', { name: 'Revoke this link', exact: true }).click();
      await expect(
        teacher.getByRole('button', { name: 'Revoke this link', exact: true }),
      ).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Lesson access not found' }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await teacherContext.close();
      await studentContext.close();
      const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
      try {
        if (planId) await prisma.lessonPlan.deleteMany({ where: { id: planId } });
        if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
        if (teacherTenant) await prisma.tenant.deleteMany({ where: { id: teacherTenant } });
      } finally {
        await prisma.$disconnect();
      }
    }
  });
