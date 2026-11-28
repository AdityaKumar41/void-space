import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });
for (const mobile of [false, true])
  test(`institution administrator, teacher and student access (${mobile ? 'touch' : 'desktop'})`, async ({
    browser,
    baseURL,
  }) => {
    const admin = await browser.newContext({
      baseURL,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await admin.newPage(),
      db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
    const contexts = [admin];
    let tenant = '',
      privateSourceId = '';
    const joined: { id: string; email: string }[] = [];
    try {
      const r = await page.request.post('/api/v1/auth/register', {
        data: {
          organizationName: 'Institution browser check',
          fullName: 'Test institution owner',
          email: `admin-${randomUUID()}@example.test`,
          password: 'Institution2026!',
        },
      });
      expect(r.status()).toBe(201);
      tenant = (await r.json()).user.activeTenantId;
      await page.goto('/console/learn/institution');
      await expect(page.getByText('Your access: Administrator', { exact: true })).toBeVisible();
      for (const role of ['Learner', 'Creator']) {
        const label = role === 'Learner' ? 'Student' : 'Teacher',
          email = `${label.toLowerCase()}-${randomUUID()}@example.test`;
        await page.getByLabel('Full name', { exact: true }).fill(`Test ${label}`);
        await page.getByLabel('Email', { exact: true }).fill(email);
        await page
          .getByRole('combobox', { name: 'Invitation access', exact: true })
          .selectOption(role);
        await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
        await expect(
          page.getByRole('button', { name: `Revoke invitation for ${email}`, exact: true }),
        ).toBeVisible();
        const url = await page.locator('input[readonly]').inputValue();
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        const member = await context.newPage();
        await member.goto(url);
        await member.getByLabel('Full name', { exact: true }).fill(`Test ${label}`);
        await member.getByLabel(/^Set a password/).fill('InstitutionMember2026!');
        await member.getByRole('button', { name: 'Accept invitation', exact: true }).click();
        await expect(member).toHaveURL(/\/console\/learn\/institution/);
        await expect(member.getByText(`Your access: ${label}`, { exact: true })).toBeVisible();
        await expect(
          member.getByRole('heading', { name: 'Members and access', exact: true }),
        ).toHaveCount(0);
        await expect(
          member.getByRole('button', { name: 'Create invitation', exact: true }),
        ).toHaveCount(0);
        const profile = await member.request.get('/api/v1/auth/me');
        joined.push({ id: (await profile.json()).user.id, email });
        expect((await member.request.get('/api/v1/learning/workspace/profile')).status()).toBe(200);
        expect(
          (
            await member.request.post('/api/v1/users/invite', {
              data: {
                email: `forbidden-${randomUUID()}@example.test`,
                fullName: 'Forbidden escalation',
                role: 'TenantAdmin',
              },
            })
          ).status(),
        ).toBe(403);
        if (role === 'Learner') {
          await expect(
            member.getByRole('link', { name: 'My progress', exact: true }),
          ).toBeVisible();
          const source = (
            await (
              await member.request.post('/api/v1/learning/sources', {
                data: {
                  title: 'Private student notes',
                  text: 'Synthetic student notes stay private even from institution teachers and administrators.',
                },
              })
            ).json()
          ).source;
          privateSourceId = source.id;
          const ownSources = await (await member.request.get('/api/v1/learning/sources')).json();
          expect(JSON.stringify(ownSources)).toContain(privateSourceId);
          const adminSources = await (await page.request.get('/api/v1/learning/sources')).json();
          expect(JSON.stringify(adminSources)).not.toContain(privateSourceId);
        } else {
          const teacherSources = await (
            await member.request.get('/api/v1/learning/sources')
          ).json();
          expect(JSON.stringify(teacherSources)).not.toContain(privateSourceId);
          await expect(
            member.getByRole('link', { name: 'My teaching materials', exact: true }),
          ).toBeVisible();
          await expect(member.getByRole('link', { name: 'My progress', exact: true })).toHaveCount(
            0,
          );
        }
      }
      await page.reload();
      const studentRow = page.locator('.institution-member').filter({ hasText: joined[0].email });
      await studentRow
        .getByRole('combobox', { name: 'Access for Test Student', exact: true })
        .selectOption('Creator');
      await studentRow.getByRole('button', { name: 'Save access', exact: true }).click();
      await expect(
        page.getByText('Member access updated. Previous sessions were revoked.', { exact: true }),
      ).toBeVisible();
      const users = await (await page.request.get('/api/v1/users')).json();
      expect(users.users.find((u: { id: string }) => u.id === joined[0].id).roles).toEqual([
        'Creator',
      ]);
      const teacherRow = page.locator('.institution-member').filter({ hasText: joined[1].email });
      await teacherRow.getByRole('button', { name: 'Remove access', exact: true }).click();
      await teacherRow.getByRole('button', { name: 'Confirm removal', exact: true }).click();
      await expect(teacherRow.getByText('No active role', { exact: true })).toBeVisible();
      expect((await contexts[2].request.get('/api/v1/learning/workspace/profile')).status()).toBe(
        401,
      );
      const email = `revoke-${randomUUID()}@example.test`;
      await page.getByLabel('Full name', { exact: true }).fill('Revoked invite');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
      const revoke = page.getByRole('button', {
        name: `Revoke invitation for ${email}`,
        exact: true,
      });
      await expect(revoke).toBeVisible();
      await revoke.click();
      await expect(revoke).toHaveCount(0);
      await expect(page.locator('input[readonly]')).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    } finally {
      for (const c of contexts) await c.close();
      if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
      await db.$disconnect();
    }
  });
