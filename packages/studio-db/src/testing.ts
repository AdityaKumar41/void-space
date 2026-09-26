/**
 * Fixture helpers for this package's tests.
 *
 * Exported from `@void-space/studio-db/testing` because the API and worker test
 * suites will need the same three operations, and a second copy of "make a tenant"
 * is how two suites end up disagreeing about what a valid tenant looks like.
 *
 * Note which client each helper uses, because it is the point rather than an
 * implementation detail:
 *
 *  - Tenant and User are created through `withStudioPlatform`. §5.1 makes them a
 *    federated mirror reconciled *before* a tenant is known, which is exactly the
 *    case a tenant-scoped client cannot serve.
 *  - Everything else goes through `withStudioTenant`, so the fixtures are subject to
 *    the same RLS policies production traffic is. A fixture written as a privileged
 *    role would pass even if the policies were wrong, which would make the isolation
 *    suite worthless.
 */
import { randomUUID } from 'node:crypto';

import { withStudioPlatform, withStudioTenant } from './tenant';

export interface StudioTenantFixture {
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
}

/** Creates a tenant and one Creator in it. */
export async function createStudioTenant(
  name = `studio-test-${randomUUID().slice(0, 8)}`,
): Promise<StudioTenantFixture> {
  const tenantId = randomUUID();
  const userId = randomUUID();

  await withStudioPlatform(async (db) => {
    await db.tenant.create({
      data: {
        id: tenantId,
        name,
        // 1 GiB — small enough that a quota test can reach it without writing a byte.
        storageQuotaBytes: 1024n * 1024n * 1024n,
      },
    });
    await db.user.create({
      data: {
        id: userId,
        tenantId,
        displayName: 'Test Creator',
        lastSeenRole: 'Creator',
      },
    });
  });

  return { tenantId, userId, name };
}

/** Removes a tenant and, by cascade, every row scoped to it. */
export async function destroyStudioTenant(tenantId: string): Promise<void> {
  await withStudioPlatform(async (db) => {
    await db.tenant.deleteMany({ where: { id: tenantId } });
  });
}

/** Creates a project owned by `userId`, through the tenant-scoped client. */
export async function createStudioProject(
  fixture: StudioTenantFixture,
  name = 'Untitled',
): Promise<string> {
  return withStudioTenant(fixture.tenantId, async (db) => {
    const project = await db.project.create({
      data: {
        tenantId: fixture.tenantId,
        ownerId: fixture.userId,
        name,
      },
    });
    return project.id;
  });
}
