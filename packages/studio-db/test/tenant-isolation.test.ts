/**
 * Cross-tenant isolation, proven against a real PostgreSQL (VS2-SRS-1.0 §5.2, §5.3).
 *
 * These tests are the security regression net for the Studio's data tier: if RLS is
 * ever disabled, unforced, mis-scoped, or bypassed by using the wrong client, they
 * fail. They are written to be *negative* — each one asserts that something is
 * refused — because a positive "I can read my own rows" assertion passes just as
 * happily against a database with no isolation at all.
 */
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { studioPlatformPrisma, studioPrisma } from '../src/client';
import {
  createStudioProject,
  createStudioTenant,
  destroyStudioTenant,
  type StudioTenantFixture,
} from '../src/testing';
import {
  StudioTenantContextMissingError,
  studioDb,
  withStudioPlatform,
  withStudioTenant,
} from '../src/tenant';

const dbAvailable = await new Promise<boolean>((resolve) => {
  const socket = net.createConnection({ host: 'localhost', port: 5433 });
  socket.setTimeout(300);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('timeout', () => {
    socket.destroy();
    resolve(false);
  });
});

describe.skipIf(!dbAvailable)('studio tenant isolation (RLS)', () => {
  let alpha: StudioTenantFixture;
  let beta: StudioTenantFixture;
  let alphaProjectId: string;
  let betaProjectId: string;

  beforeAll(async () => {
    alpha = await createStudioTenant('isolation-alpha');
    beta = await createStudioTenant('isolation-beta');
    alphaProjectId = await createStudioProject(alpha, 'Alpha model');
    betaProjectId = await createStudioProject(beta, 'Beta model');
  });

  afterAll(async () => {
    await destroyStudioTenant(alpha.tenantId);
    await destroyStudioTenant(beta.tenantId);
    await studioPrisma.$disconnect();
    await studioPlatformPrisma.$disconnect();
  });

  it('creates two tenants that both own a project (precondition)', async () => {
    expect(alpha.tenantId).not.toBe(beta.tenantId);

    const [alphaProjects, betaProjects] = await Promise.all([
      withStudioTenant(alpha.tenantId, (db) => db.project.findMany({ select: { id: true } })),
      withStudioTenant(beta.tenantId, (db) => db.project.findMany({ select: { id: true } })),
    ]);

    expect(alphaProjects.map((p) => p.id)).toContain(alphaProjectId);
    expect(betaProjects.map((p) => p.id)).toContain(betaProjectId);
  });

  it("lists only the active tenant's rows", async () => {
    const [alphaProjects, betaProjects] = await Promise.all([
      withStudioTenant(alpha.tenantId, (db) =>
        db.project.findMany({ select: { id: true, tenantId: true } }),
      ),
      withStudioTenant(beta.tenantId, (db) =>
        db.project.findMany({ select: { id: true, tenantId: true } }),
      ),
    ]);

    expect(alphaProjects.every((p) => p.tenantId === alpha.tenantId)).toBe(true);
    expect(betaProjects.every((p) => p.tenantId === beta.tenantId)).toBe(true);

    const alphaIds = new Set(alphaProjects.map((p) => p.id));
    expect(betaProjects.filter((p) => alphaIds.has(p.id))).toEqual([]);
  });

  it("cannot read another tenant's row even when its id is known", async () => {
    const found = await withStudioTenant(alpha.tenantId, (db) =>
      db.project.findUnique({ where: { id: betaProjectId } }),
    );

    // Not "forbidden" — simply absent, which is the point: the row is invisible rather
    // than protected by a check someone could forget to make.
    expect(found).toBeNull();
  });

  it("cannot update another tenant's row", async () => {
    const result = await withStudioTenant(alpha.tenantId, (db) =>
      db.project.updateMany({ where: { id: betaProjectId }, data: { name: 'hijacked' } }),
    );

    expect(result.count).toBe(0);

    const untouched = await withStudioTenant(beta.tenantId, (db) =>
      db.project.findUnique({ where: { id: betaProjectId }, select: { name: true } }),
    );
    expect(untouched?.name).toBe('Beta model');
  });

  it("cannot delete another tenant's row", async () => {
    const result = await withStudioTenant(alpha.tenantId, (db) =>
      db.project.deleteMany({ where: { id: betaProjectId } }),
    );

    expect(result.count).toBe(0);
  });

  it('cannot insert a row attributed to another tenant (the WITH CHECK half)', async () => {
    /*
     * A read-only policy would pass every test above and still let a caller *write* a
     * row into another tenant — and, worse, would let it write a row whose own
     * `tenant_id` disagrees with the context, which is how a row escapes isolation
     * permanently. This is the assertion that covers that direction.
     */
    await expect(
      withStudioTenant(alpha.tenantId, (db) =>
        db.project.create({
          data: { tenantId: beta.tenantId, ownerId: beta.userId, name: 'smuggled' },
        }),
      ),
    ).rejects.toThrow();

    const betaProjects = await withStudioTenant(beta.tenantId, (db) =>
      db.project.findMany({ select: { name: true } }),
    );
    expect(betaProjects.map((p) => p.name)).not.toContain('smuggled');
  });

  it('refuses a tenant-scoped query with no tenant context', async () => {
    await expect(studioPrisma.project.findMany()).rejects.toThrow();
  });

  it('refuses access to the scoped client outside a context', () => {
    expect(() => studioDb()).toThrow(StudioTenantContextMissingError);
  });

  it('rejects a tenant id that is not a UUID before reaching the database', async () => {
    await expect(withStudioTenant('not-a-uuid', async () => 1)).rejects.toThrow(/UUID/);
  });

  it('denies the platform role the project tables outright (§5.3)', async () => {
    /*
     * The boundary is a *database permission*, not a convention. If this ever starts
     * succeeding, the narrow grant in rls.sql has been widened and the platform role
     * has become a second way to read tenant data.
     */
    await expect(studioPlatformPrisma.project.findMany()).rejects.toThrow();

    // The mirror it *is* allowed to touch, so the assertion above cannot pass merely
    // because the client is broken.
    const mirrored = await withStudioPlatform((db) =>
      db.tenant.findUnique({ where: { id: alpha.tenantId } }),
    );
    expect(mirrored?.name).toBe('isolation-alpha');
  });
});
