import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/db/generated/client/index.js';
import { loadRootEnv } from '../../../packages/db/src/env';
loadRootEnv({ override: false });

test('expired access cookie recovers a valid refresh session and preserves the destination', async ({
  page,
  context,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
  let tenant = '';
  try {
    const signup = await page.request.post('/api/v1/auth/learners', {
      data: {
        fullName: 'Session recovery learner',
        email: `session-recovery-${randomUUID()}@example.test`,
        password: 'SessionRecovery2026!',
        ageBand: '18+',
      },
    });
    expect(signup.status()).toBe(201);
    tenant = (await (await page.request.get('/api/v1/auth/me')).json()).user.activeTenantId;
    await context.clearCookies({ name: 'vs_access' });
    await page.goto('/console/learn/settings?audit=resume');
    await expect(page).toHaveURL(/\/console\/learn\/settings\?audit=resume$/);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect((await context.cookies()).some((cookie) => cookie.name === 'vs_access')).toBe(true);
    const access = (await context.cookies()).find((cookie) => cookie.name === 'vs_access')!;
    await context.addCookies([{ ...access, value: 'stale-access-token' }]);
    await page.goto('/console/learn/settings?audit=stale');
    await expect(page).toHaveURL(/\/console\/learn\/settings\?audit=stale$/);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect((await context.cookies()).find((cookie) => cookie.name === 'vs_access')?.value).not.toBe(
      'stale-access-token',
    );
    await context.clearCookies();
    await page.goto('/console/learn/settings');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  } finally {
    if (tenant) await db.tenant.deleteMany({ where: { id: tenant } });
    await db.$disconnect();
  }
});
