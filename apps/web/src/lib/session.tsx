'use client';

/**
 * Session context (SRS §6.1).
 *
 * The UI shell needs the caller's workspace, roles and permissions on every page, and the
 * API is the only authority for them (`GET /auth/me`). Roles and permissions are re-read
 * server-side on every request, so the client never caches them beyond the query's stale
 * window — a demotion shows up as a 403 and a re-render, not as a stale menu.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect } from 'react';
import type { Permission, Role } from '@void-space/types';

import { apiFetch } from './api';

export interface SessionTenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface SessionView {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly fullName: string;
    readonly activeTenantId: string;
    readonly roles: readonly Role[];
    readonly permissions: readonly Permission[];
  };
  readonly tenant: SessionTenant;
  readonly authMethod: 'jwt' | 'apikey';
  readonly readOnly: boolean;
}

/** Multi-workspace members see a switcher (FR-1.4); the API is the source of the list. */
export interface Membership {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly roles: readonly Role[];
}

interface LoginResult {
  readonly user?: {
    readonly email: string;
    readonly activeTenantId: string;
    readonly tenants: readonly Membership[];
  };
  readonly requiresTenantSelection?: boolean;
  readonly tenants?: readonly Membership[];
}

interface SessionContextValue {
  readonly session: SessionView | undefined;
  readonly memberships: readonly Membership[];
  readonly isLoading: boolean;
  readonly error: unknown;
  can(permission: Permission): boolean;
  hasRole(role: Role): boolean;
  signOut(): Promise<void>;
  switchTenant(tenantId: string): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Memberships are fetched from the workspace list returned by the login/switch payload. */
let cachedMemberships: readonly Membership[] = [];

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const query = useQuery<SessionView>({
    queryKey: ['session'],
    queryFn: () => apiFetch<SessionView>('/auth/me'),
    retry: false,
  });

  // An unauthenticated visitor is sent to the sign-in screen rather than shown a broken shell.
  useEffect(() => {
    const status = (query.error as { status?: number } | null)?.status;
    if (status === 401) router.replace('/login');
  }, [query.error, router]);

  const value: SessionContextValue = {
    session: query.data,
    memberships: cachedMemberships,
    isLoading: query.isLoading,
    error: query.error,
    can: (permission) => query.data?.user.permissions.includes(permission) ?? false,
    hasRole: (role) => query.data?.user.roles.includes(role) ?? false,
    async signOut() {
      await apiFetch('/auth/logout', { method: 'POST' });
      cachedMemberships = [];
      router.replace('/login');
    },
    async switchTenant(tenantId) {
      const result = await apiFetch<LoginResult>('/auth/tenant', {
        method: 'POST',
        body: { tenantId },
      });
      if (result.user?.tenants) cachedMemberships = result.user.tenants;
      await query.refetch();
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Remembers the workspace list a login returned, so the switcher can render immediately. */
export function rememberMemberships(memberships: readonly Membership[]): void {
  cachedMemberships = memberships;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
