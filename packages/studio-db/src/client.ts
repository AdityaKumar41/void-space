/**
 * Prisma client instances for VOID·STUDIO (VS2-SRS-1.0 §5.2, §5.3).
 *
 * Two pools, mirroring VOID·SPACE's shape deliberately — an engineer moving between
 * the two products should not have to learn a second tenancy model:
 *
 *  - `studioPrisma`          connects as `voidstudio_app` (STUDIO_DATABASE_URL).
 *                            Row-Level Security applies to every tenant-scoped
 *                            table, so this client may ONLY be used inside
 *                            `withStudioTenant(...)`.
 *  - `studioPlatformPrisma`  connects as `voidstudio_platform`
 *                            (STUDIO_PLATFORM_DATABASE_URL). It has BYPASSRLS but
 *                            table privileges only on `tenants` and `users` —
 *                            never on project, scene, version, publish, copilot or
 *                            job data. Use it exclusively through
 *                            `withStudioPlatform(...)`.
 *
 * That second role exists because §5.1 makes Tenant and User a *federated mirror*
 * of VOID·SPACE identity: reconciling those two rows happens during login, before
 * any tenant is known, which is precisely the operation a tenant-scoped role cannot
 * perform. Everything else has a tenant and must go through the scoped client.
 */
import { PrismaClient } from '../generated/client';

const globalForPrisma = globalThis as unknown as {
  __voidStudioPrisma?: PrismaClient;
  __voidStudioPlatformPrisma?: PrismaClient;
};

function buildClient(url: string | undefined, label: string): PrismaClient {
  if (!url) {
    throw new Error(
      `[studio-db] ${label} is not set. Copy .env.example to .env (see SRS §9.4) and re-run.`,
    );
  }
  return new PrismaClient({
    datasources: { db: { url } },
    log:
      process.env.PRISMA_LOG_QUERIES === 'true'
        ? [
            { emit: 'stdout', level: 'query' },
            { emit: 'stdout', level: 'warn' },
          ]
        : [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ],
  });
}

let _studioPrismaInstance: PrismaClient | undefined;
let _studioPlatformPrismaInstance: PrismaClient | undefined;

function getStudioPrisma(): PrismaClient {
  if (!_studioPrismaInstance) {
    _studioPrismaInstance =
      globalForPrisma.__voidStudioPrisma ??
      buildClient(process.env.STUDIO_DATABASE_URL, 'STUDIO_DATABASE_URL');
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.__voidStudioPrisma = _studioPrismaInstance;
    }
  }
  return _studioPrismaInstance;
}

function getStudioPlatformPrisma(): PrismaClient {
  if (!_studioPlatformPrismaInstance) {
    _studioPlatformPrismaInstance =
      globalForPrisma.__voidStudioPlatformPrisma ??
      buildClient(process.env.STUDIO_PLATFORM_DATABASE_URL, 'STUDIO_PLATFORM_DATABASE_URL');
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.__voidStudioPlatformPrisma = _studioPlatformPrismaInstance;
    }
  }
  return _studioPlatformPrismaInstance;
}

/** Runtime client: subject to RLS. Use inside `withStudioTenant(...)` only. */
export const studioPrisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getStudioPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/** Administrative client: BYPASSRLS, narrow privileges. Use inside `withStudioPlatform(...)`. */
export const studioPlatformPrisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getStudioPlatformPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export interface DatabaseRoleInfo {
  readonly currentUser: string;
  readonly isSuperuser: boolean;
  readonly bypassRls: boolean;
}

/**
 * Reads the connected role's identity and RLS attributes.
 *
 * The API and worker call this at boot and refuse to start if the runtime connection
 * can bypass RLS — a mis-set `STUDIO_DATABASE_URL` would otherwise silently disable
 * tenant isolation (§5.2, and the same guarantee VOID·SPACE enforces in NFR-SEC.5).
 */
export async function inspectStudioDatabaseRole(
  client: PrismaClient = studioPrisma,
): Promise<DatabaseRoleInfo> {
  const [row] = await client.$queryRawUnsafe<
    { current_user: string; is_superuser: boolean; bypass_rls: boolean }[]
  >(
    `SELECT current_user AS current_user,
            current_setting('is_superuser') = 'on' AS is_superuser,
            r.rolbypassrls AS bypass_rls
       FROM pg_roles r
      WHERE r.rolname = current_user`,
  );
  return {
    currentUser: row?.current_user ?? 'unknown',
    isSuperuser: row?.is_superuser ?? false,
    bypassRls: row?.bypass_rls ?? false,
  };
}

/** Throws unless the given client connects as a non-privileged, RLS-subject role. */
export async function assertStudioRlsEnforced(
  client: PrismaClient = studioPrisma,
): Promise<DatabaseRoleInfo> {
  const info = await inspectStudioDatabaseRole(client);
  if (info.isSuperuser || info.bypassRls) {
    throw new Error(
      `[studio-db] refusing to start: role "${info.currentUser}" is superuser=${info.isSuperuser} ` +
        `bypassRls=${info.bypassRls}. The runtime must connect as voidstudio_app so Row-Level ` +
        'Security protects tenant data (SRS §5.2). Check STUDIO_DATABASE_URL.',
    );
  }
  return info;
}

export async function disconnectStudioClients(): Promise<void> {
  await Promise.all([studioPrisma.$disconnect(), studioPlatformPrisma.$disconnect()]);
}
