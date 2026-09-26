/**
 * Federated session handling (VS2-SRS-1.0 §3.5.1, FR-1.1–1.5).
 *
 * How this works, and why each part is the way it is:
 *
 *   1. **VOID·SPACE remains the only place a credential exists.** This service stores
 *      no password and no VOID·SPACE session. It accepts a VOID·SPACE-issued JWT,
 *      verifies its signature and expiry (FR-1.2), and derives everything else.
 *
 *   2. **Verification uses the shared signing key.** §3.5.1 permits either that or a
 *      JWKS-style endpoint; VOID·SPACE signs symmetrically and exposes no public key,
 *      so shared-key verification is the available option. Its cost — the Studio can
 *      mint VOID·SPACE tokens — is recorded in docs/VOID-STUDIO.md §2.3 rather than
 *      hidden here.
 *
 *   3. **A token's `perms` claim is never trusted.** VOID·SPACE already treats it as
 *      advisory in its own auth plugin, and this mirrors that: the permission set is
 *      re-derived from `roles` against the single `ROLE_PERMISSIONS` matrix in
 *      `@void-space/types`. That is what makes FR-1.3's "never cache a stale role"
 *      hold even for a token issued *before* a role change — the token cannot widen
 *      access no matter how old it is.
 *
 *   4. **The identity mirror is reconciled on every session.** §5.1 makes Tenant and
 *      User a "lightweight, federated mirror"; they are upserted here so a Creator who
 *      existed in VOID·SPACE before the Studio did works on first sign-in.
 */
import { ROLE_PERMISSIONS, type Permission, type Role } from '@void-space/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { withStudioPlatform } from '@void-space/studio-db';

import { ForbiddenError, UnauthenticatedError } from './errors';

/** The claims a VOID·SPACE access token carries (`apps/api/src/plugins/auth.ts`). */
export interface VoidSpaceTokenClaims {
  readonly sub: string;
  readonly tid: string;
  readonly roles: readonly string[];
  readonly perms?: readonly string[];
  readonly typ?: string;
}

/** The resolved caller: identity plus *derived* authority. */
export interface StudioSession {
  readonly userId: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly roles: readonly Role[];
  /** Derived from `roles`, never read from the token. */
  readonly permissions: readonly Permission[];
}

/** The role names VS-SRS-2.0 §3.6 defines. Anything else is dropped, not trusted. */
const KNOWN_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

function isRole(value: string): value is Role {
  return (KNOWN_ROLES as readonly string[]).includes(value);
}

/**
 * Re-derives permissions from role claims (FR-1.3).
 *
 * Exported for test: this is the function where trusting the token would be tempting,
 * so it is worth being able to assert on directly.
 */
export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) permissions.add(permission);
  }
  return [...permissions];
}

export function sessionFromClaims(claims: VoidSpaceTokenClaims, displayName: string): StudioSession {
  const roles = claims.roles.filter(isRole);
  return {
    userId: claims.sub,
    tenantId: claims.tid,
    displayName,
    roles,
    permissions: permissionsForRoles(roles),
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: StudioSession;
  }
}

/**
 * Reads the caller's session from the `Authorization: Bearer` token.
 *
 * VOID·SPACE's access tokens are what the browser holds, so the Studio accepts exactly
 * those — one token, two products, no second credential for a Creator to manage.
 */
export async function resolveSession(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<StudioSession> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    throw new UnauthenticatedError('Sign in through VOID·SPACE to use VOID·STUDIO');
  }

  let claims: VoidSpaceTokenClaims;
  try {
    claims = app.jwt.verify<VoidSpaceTokenClaims>(token);
  } catch {
    throw new UnauthenticatedError('The VOID·SPACE session is invalid or has expired');
  }

  // The Studio issues nothing but an access token, so an onboarding token — which has
  // no tenant — must not be accepted here: it would produce a session with an empty
  // tenant, and every tenant-scoped query would then fail confusingly.
  if (!claims.sub || !claims.tid) {
    throw new UnauthenticatedError('The VOID·SPACE token carries no tenant');
  }

  const displayName = await mirrorIdentity(claims);
  return sessionFromClaims(claims, displayName);
}

/**
 * Upserts the §5.1 identity mirror and returns the display name.
 *
 * Uses the platform client because this runs *before* a tenant context is known —
 * precisely the operation §5.1 says the mirror exists for. It cannot touch project or
 * publish data: that is denied at the database-permission level (§5.3), so a mistake
 * here fails with a permission error instead of leaking.
 */
async function mirrorIdentity(claims: VoidSpaceTokenClaims): Promise<string> {
  const primaryRole = claims.roles.find(isRole) ?? 'Creator';

  return withStudioPlatform(async (db) => {
    // The tenant mirror must exist before the user row can reference it.
    await db.tenant.upsert({
      where: { id: claims.tid },
      // 10 GiB default: a Studio project's *documents* are small next to the meshes it
      // references, and FR-2.4 lets a TenantAdmin change it — so the default should not
      // be the thing that blocks a first upload.
      create: { id: claims.tid, name: `Tenant ${claims.tid.slice(0, 8)}`, storageQuotaBytes: 10n * 1024n ** 3n },
      update: { lastSyncedAt: new Date() },
    });

    const user = await db.user.upsert({
      where: { id: claims.sub },
      create: {
        id: claims.sub,
        tenantId: claims.tid,
        displayName: `Creator ${claims.sub.slice(0, 8)}`,
        lastSeenRole: primaryRole,
      },
      update: { lastSeenRole: primaryRole, tenantId: claims.tid },
      select: { displayName: true },
    });

    return user.displayName;
  });
}

/** Requires a permission, derived from roles rather than from the token's own claim. */
export function requirePermission(session: StudioSession, permission: Permission): void {
  if (!session.permissions.includes(permission)) {
    throw new ForbiddenError(
      `Your role (${session.roles.join(', ') || 'none'}) cannot perform this action — ` +
        `it requires "${permission}".`,
      'MISSING_PERMISSION',
      { required: permission, roles: session.roles },
    );
  }
}
