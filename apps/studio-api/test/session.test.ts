import './env';

import { ROLE_PERMISSIONS } from '@void-space/types';
import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../src/lib/errors';
import { permissionsForRoles, requirePermission, sessionFromClaims } from '../src/lib/session';

const CLAIMS = { sub: 'user-1', tid: 'tenant-1', roles: ['Creator'] } as const;

describe('federated session derivation (FR-1.1–1.5)', () => {
  it('re-derives permissions from roles and ignores the token’s own claim (FR-1.3)', () => {
    /*
     * The bug this pins: reading permissions off the token is easier, and it makes a role *revocation*
     * take effect only when the token expires. VOID·SPACE already treats `perms` as advisory in its own
     * auth plugin; the Studio has to match, or a stale token widens access here after it was narrowed
     * there.
     */
    const session = sessionFromClaims(
      { ...CLAIMS, perms: ['asset:publish', 'tenant:manage', 'review:decide'] },
      'Ada',
    );

    expect(session.permissions).toEqual([...ROLE_PERMISSIONS.Creator]);
    expect(session.permissions).not.toContain('asset:publish');
    expect(session.permissions).not.toContain('tenant:manage');
    expect(session.permissions).not.toContain('review:decide');
  });

  it('drops role names it does not know rather than guessing at them', () => {
    // §3.5.1 requires the Studio to reuse VS-SRS-2.0 §3.6's role names exactly. A token naming
    // something else — a newer product, a typo, a hand-minted claim — grants nothing.
    const session = sessionFromClaims({ ...CLAIMS, roles: ['Creator', 'Wizard', 'root'] }, 'Ada');

    expect(session.roles).toEqual(['Creator']);
    expect(session.permissions).toEqual([...ROLE_PERMISSIONS.Creator]);
  });

  it('derives a role’s permission set directly, for callers that have no token', () => {
    // `permissionsForRoles` is exported so it can be asserted on without building a token around it —
    // it is the single place the matrix is applied, so the union tests above depend on it being right.
    expect(permissionsForRoles(['SuperAdmin'])).toEqual([...ROLE_PERMISSIONS.SuperAdmin]);
    expect(permissionsForRoles([])).toEqual([]);
  });

  it('unions the permissions of every role a Creator holds', () => {
    const session = sessionFromClaims({ ...CLAIMS, roles: ['Creator', 'Assessor'] }, 'Ada');

    expect(session.roles).toEqual(['Creator', 'Assessor']);
    expect(session.permissions).toContain('review:decide');
    expect(session.permissions).toContain('asset:upload-own');
    // No role is dropped and none is invented: the union is exactly the two sets merged.
    expect(new Set(session.permissions).size).toBe(session.permissions.length);
  });

  it('grants nothing to a session with no recognised role', () => {
    const session = sessionFromClaims({ ...CLAIMS, roles: [] }, 'Ada');

    expect(session.roles).toEqual([]);
    expect(session.permissions).toEqual([]);
  });

  it('carries the identity through unchanged', () => {
    const session = sessionFromClaims(CLAIMS, 'Ada Lovelace');

    expect(session.userId).toBe('user-1');
    expect(session.tenantId).toBe('tenant-1');
    expect(session.displayName).toBe('Ada Lovelace');
  });
});

describe('permission checks', () => {
  const creator = () => sessionFromClaims(CLAIMS, 'Ada');

  it('lets a held permission through', () => {
    expect(() => requirePermission(creator(), 'asset:upload-own')).not.toThrow();
  });

  it('refuses one the caller’s role does not grant, naming what was needed', () => {
    let thrown: unknown;
    try {
      requirePermission(creator(), 'asset:publish');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ForbiddenError);
    const error = thrown as ForbiddenError;
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('MISSING_PERMISSION');
    // The message has to name the permission and the role, because the person reading it is deciding
    // whether to ask their admin for something.
    expect(error.message).toContain('asset:publish');
    expect(error.message).toContain('Creator');
    expect(error.details).toEqual({ required: 'asset:publish', roles: ['Creator'] });
  });
});
