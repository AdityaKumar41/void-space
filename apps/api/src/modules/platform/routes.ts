import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withPlatform, type Prisma } from '@void-space/db';
import { z } from 'zod';
import type { ApiEnv } from '../../env';
import { ForbiddenError, ConflictError } from '../../lib/errors';
import { sealedCookie } from '../tools/sketchfab';
import { digest, newTotpSecret, totpStep } from './totp';
export const PLATFORM_COOKIE = 'void_platform_console';
const cookieName = PLATFORM_COOKIE;
const platformTransaction = <T>(fn: (db: Prisma.TransactionClient) => Promise<T>) =>
  withPlatform((db) => db.$transaction(fn));
const roleSchema = z.enum(['PlatformAdmin', 'PlatformModerator']);
const verification = z.object({ code: z.string().trim().min(6).max(80) }).strict();
export const requirePlatformConsole = async (
  request: FastifyRequest,
  admin = false,
): Promise<{
  access: { userId: string; role: string };
  user: { id: string; tenantId: string };
}> => {
  const token = request.cookies[cookieName];
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new ForbiddenError('Verify your authenticator to open platform administration');
  const result = await platformTransaction(async (db) => {
    const session = await db.platformConsoleSession.findUnique({
      where: { tokenHash: digest(token) },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    const access = await db.platformAccess.findUnique({ where: { userId: session.userId } });
    const user = await db.user.findUnique({
      where: { id: session.userId },
      include: { tenant: true },
    });
    if (
      !access ||
      access.revokedAt ||
      !access.secretCipher ||
      !user ||
      user.status !== 'active' ||
      user.tenant.status !== 'active' ||
      session.credentialHash !==
        digest(`${user.passwordHash ?? ''}:${user.googleId ?? ''}:${access.secretCipher}`)
    )
      return null;
    return { access, user };
  });
  if (!result || (admin && result.access.role !== 'PlatformAdmin'))
    throw new ForbiddenError('Platform session expired or lacks this permission');
  return result;
};

export async function platformRoutes(app: FastifyInstance, { env }: { env: ApiEnv }) {
  app.addHook('preHandler', async (request) => {
    const origin = request.headers.origin;
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      origin &&
      !env.CORS_ORIGINS.includes(origin)
    )
      throw new ForbiddenError('Platform changes must come from an allowed application origin');
  });
  const secrets = sealedCookie(env.JWT_REFRESH_SECRET, 'platform-mfa');
  const cookie = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1',
  };
  const currentAccess = async (request: FastifyRequest) => {
    await app.authenticate(request);
    if (request.principal!.authMethod !== 'jwt')
      throw new ForbiddenError('Platform access requires a browser sign-in');
    const access = await withPlatform((db) =>
      db.platformAccess.findUnique({ where: { userId: request.principal!.userId } }),
    );
    if (!access || access.revokedAt)
      throw new ForbiddenError('No central platform access has been granted to this account');
    return access;
  };
  app.get('/platform/access', { preHandler: app.authenticate }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const access =
      request.principal!.authMethod === 'jwt'
        ? await withPlatform((db) =>
            db.platformAccess.findUnique({ where: { userId: request.principal!.userId } }),
          )
        : null;
    let elevated = false;
    let elevatedRole: string | null = null;
    try {
      const identity = await requirePlatformConsole(request);
      elevatedRole = identity.access.role;
      elevated = true;
    } catch {
      /* A normal session cannot imply elevation. */
    }
    return {
      granted: elevated || (!!access && !access.revokedAt),
      role: elevatedRole ?? (access && !access.revokedAt ? access.role : null),
      enrolled: elevated || !!access?.secretCipher,
      elevated,
    };
  });
  app.post(
    '/platform/mfa/enroll',
    { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const access = await currentAccess(request);
      if (access.secretCipher)
        throw new ConflictError(
          'An authenticator is already enrolled. Use a recovery code if access was lost.',
        );
      const secret = newTotpSecret();
      await platformTransaction(async (db) => {
        await db.platformAccess.update({
          where: { userId: access.userId },
          data: { pendingCipher: secrets.seal({ secret }) },
        });
        await db.platformEvent.create({
          data: { actorId: access.userId, action: 'platform.mfa.enrollment_started' },
        });
      });
      reply.header('Cache-Control', 'no-store');
      return {
        secret,
        uri: `otpauth://totp/${encodeURIComponent('Void Space Platform:' + request.principal!.email)}?secret=${secret}&issuer=Void%20Space&algorithm=SHA1&digits=6&period=30`,
      };
    },
  );
  app.post(
    '/platform/mfa/verify',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const access = await currentAccess(request),
        { code } = verification.parse(request.body);
      const encrypted = access.secretCipher ?? access.pendingCipher;
      const decoded = z
        .object({ secret: z.string() })
        .safeParse(secrets.open(encrypted ?? undefined));
      if (!decoded.success) throw new ForbiddenError('Enroll an authenticator first');
      const step = totpStep(decoded.data.secret, code);
      const recoveryHash = digest(code);
      const recovery = !!access.secretCipher && access.recoveryHashes.includes(recoveryHash);
      if (step === null && !recovery)
        throw new ForbiddenError('Invalid authenticator or recovery code');
      const recoveryCodes = !access.secretCipher
        ? Array.from({ length: 10 }, () => randomBytes(12).toString('hex'))
        : [];
      const token = randomBytes(32).toString('hex');
      await platformTransaction(async (db) => {
        const changed = await db.platformAccess.updateMany({
          where: {
            userId: access.userId,
            revokedAt: null,
            secretCipher: access.secretCipher,
            pendingCipher: access.pendingCipher,
            ...(recovery
              ? { recoveryHashes: { has: recoveryHash } }
              : { lastTotpStep: { lt: BigInt(step!) } }),
          },
          data: {
            secretCipher: encrypted,
            pendingCipher: null,
            ...(step !== null ? { lastTotpStep: BigInt(step) } : {}),
            ...(recoveryCodes.length
              ? { recoveryHashes: recoveryCodes.map(digest) }
              : recovery
                ? { recoveryHashes: access.recoveryHashes.filter((hash) => hash !== recoveryHash) }
                : {}),
          },
        });
        if (changed.count !== 1)
          throw new ForbiddenError('This verification code was already used or access changed');
        const user = await db.user.findUniqueOrThrow({ where: { id: access.userId } });
        await db.platformConsoleSession.create({
          data: {
            tokenHash: digest(token),
            userId: access.userId,
            credentialHash: digest(
              `${user.passwordHash ?? ''}:${user.googleId ?? ''}:${encrypted}`,
            ),
            expiresAt: new Date(Date.now() + 15 * 60000),
          },
        });
        await db.platformEvent.create({
          data: {
            actorId: access.userId,
            action: recovery ? 'platform.mfa.recovery_used' : 'platform.mfa.verified',
          },
        });
      });
      reply.clearCookie(cookieName, { ...cookie, path: '/api/v1/platform' });
      reply
        .setCookie(cookieName, token, { ...cookie, maxAge: 900 })
        .header('Cache-Control', 'no-store');
      return { verified: true, recoveryCodes, expiresInSeconds: 900 };
    },
  );
  app.post('/platform/logout', async (request, reply) => {
    const token = request.cookies[cookieName];
    if (token)
      await withPlatform((db) =>
        db.platformConsoleSession.deleteMany({ where: { tokenHash: digest(token) } }),
      );
    reply.clearCookie(cookieName, cookie);
    return { signedOut: true };
  });
  app.get('/platform/overview', async (request, reply) => {
    const { access } = await requirePlatformConsole(request);
    reply.header('Cache-Control', 'no-store');
    return withPlatform(async (db) => ({
      role: access.role,
      counts: {
        institutions: await db.tenant.count({ where: { kind: 'organization' } }),
        individuals: await db.tenant.count({ where: { kind: 'personal' } }),
        activeUsers: await db.user.count({ where: { status: 'active' } }),
      },
      tenants: await db.tenant.findMany({
        select: { id: true, name: true, kind: true, status: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
    }));
  });
  app.get('/platform/users', async (request, reply) => {
    await requirePlatformConsole(request, true);
    const { q, cursor } = z
      .object({ q: z.string().trim().max(120).default(''), cursor: z.string().uuid().optional() })
      .parse(request.query);
    reply.header('Cache-Control', 'no-store');
    return withPlatform(async (db) => {
      const users = await db.user.findMany({
        where: q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { fullName: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        select: {
          id: true,
          email: true,
          fullName: true,
          status: true,
          tenantId: true,
          tenant: { select: { name: true, kind: true } },
        },
      });
      const grants = await db.platformAccess.findMany({
        where: { userId: { in: users.map((user) => user.id) }, revokedAt: null },
        select: { userId: true, role: true },
      });
      return {
        users: users.slice(0, 24).map((user) => ({
          ...user,
          platformRole: grants.find((grant) => grant.userId === user.id)?.role ?? null,
        })),
        nextCursor: users.length > 24 ? users[23]!.id : null,
      };
    });
  });
  app.patch('/platform/users/:id/status', async (request) => {
    const { access } = await requirePlatformConsole(request, true);
    const userId = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const { active, reason } = z
      .object({ active: z.boolean(), reason: z.string().trim().min(5).max(500) })
      .strict()
      .parse(request.body);
    await platformTransaction(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(78261342)::text`;
      const grant = await db.platformAccess.findUnique({ where: { userId } });
      if (
        !active &&
        (userId === access.userId || (grant?.role === 'PlatformAdmin' && !grant.revokedAt))
      )
        throw new ConflictError(
          'Revoke administrator access before deactivating this account; you cannot deactivate yourself',
        );
      await db.user.update({
        where: { id: userId },
        data: { status: active ? 'active' : 'suspended' },
      });
      await db.platformConsoleSession.deleteMany({ where: { userId } });
      await db.platformEvent.create({
        data: {
          actorId: access.userId,
          targetId: userId,
          action: active ? 'platform.user.activated' : 'platform.user.deactivated',
          details: { reason },
        },
      });
    });
    return { updated: true };
  });
  app.get('/platform/events', async (request, reply) => {
    await requirePlatformConsole(request, true);
    reply.header('Cache-Control', 'no-store');
    return withPlatform(async (db) => ({
      events: await db.platformEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    }));
  });
  app.patch('/platform/tenants/:id/status', async (request) => {
    const { access } = await requirePlatformConsole(request, true);
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const { suspended, reason } = z
      .object({ suspended: z.boolean(), reason: z.string().trim().min(5).max(500) })
      .strict()
      .parse(request.body);
    await platformTransaction(async (db) => {
      const actor = await db.user.findUniqueOrThrow({ where: { id: access.userId } });
      if (id === actor.tenantId)
        throw new ConflictError('You cannot suspend your own administration workspace');
      await db.tenant.update({
        where: { id },
        data: {
          status: suspended ? 'suspended' : 'active',
          suspendedAt: suspended ? new Date() : null,
          suspendedReason: suspended ? reason : null,
        },
      });
      await db.platformEvent.create({
        data: {
          actorId: access.userId,
          action: suspended ? 'platform.tenant.suspended' : 'platform.tenant.restored',
          targetId: id,
          details: { reason },
        },
      });
    });
    // Tenant authentication checks status on every request, including existing sessions.
    return { updated: true };
  });
  app.put('/platform/access/:id', async (request) => {
    const { access } = await requirePlatformConsole(request, true);
    const userId = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const { role, revoked } = z
      .object({ role: roleSchema, revoked: z.boolean().default(false) })
      .strict()
      .parse(request.body);
    await platformTransaction(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(78261342)::text`;
      const previous = await db.platformAccess.findUnique({ where: { userId } });
      if (
        previous?.role === 'PlatformAdmin' &&
        !previous.revokedAt &&
        (revoked || role !== 'PlatformAdmin')
      ) {
        if (
          (await db.platformAccess.count({ where: { role: 'PlatformAdmin', revokedAt: null } })) <=
          1
        )
          throw new ConflictError('The last active platform administrator cannot be removed');
      }
      await db.user.findUniqueOrThrow({ where: { id: userId } });
      await db.platformAccess.upsert({
        where: { userId },
        create: { userId, role, revokedAt: revoked ? new Date() : null },
        update: { role, revokedAt: revoked ? new Date() : null },
      });
      await db.platformConsoleSession.deleteMany({ where: { userId } });
      await db.platformEvent.create({
        data: {
          actorId: access.userId,
          action: 'platform.access.changed',
          targetId: userId,
          details: { role, revoked },
        },
      });
    });
    return { updated: true };
  });
}
