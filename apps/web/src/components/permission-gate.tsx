'use client';

/**
 * Permission gate for console screens (SRS §3.6).
 *
 * The API is the authority: every request is re-checked server-side against the §3.6 matrix, and a
 * role that lacks a permission gets a 403 whatever the UI does. But a screen that mounts its
 * queries first and *then* discovers it is not allowed produces the worst of both worlds — two
 * failed requests per visit, a browser console full of 403s, and a page that renders a broken
 * version of a tool the caller cannot use.
 *
 * So the check happens before the subtree mounts. The gate is keyed on the same permission the API
 * enforces and the navigation uses to decide whether to show the door at all, which keeps one
 * matrix in charge of all three.
 *
 * The refusal is deliberately informative rather than blank: it names the permission, the roles the
 * caller actually holds, and states plainly that nothing was requested — because "why can't I open
 * this?" is the only question the screen needs to answer.
 */
import Link from 'next/link';

import type { Permission } from '@void-space/types';

import { useSession } from '../lib/session';
import { Loading, Panel } from './ui-kit';

/** Human wording for the permissions a whole screen is gated behind. */
const PERMISSION_LABEL: Partial<Record<Permission, string>> = {
  'review:view-queue': 'Review the submission queue',
  'review:decide': 'Approve, reject or request changes',
  'audit:view': 'Read the audit ledger',
  'tenant:manage-users': 'Manage workspace members and roles',
  'catalog:view': 'View the catalogue',
  'asset:upload-own': 'Upload assets',
  'tenant:manage': 'Change workspace settings',
};

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  /** Mounted only when the caller holds the permission, so no doomed request is ever sent. */
  children: React.ReactNode;
}) {
  const { can, session, isLoading } = useSession();

  if (can(permission)) return <>{children}</>;

  // Before the session resolves there is nothing to refuse yet. Showing the panel here would make
  // every first paint claim a permission problem, so the gate stays neutral instead.
  if (isLoading || !session) return <Loading label="RESOLVING PERMISSIONS" />;

  return (
    <div className="mx-auto max-w-2xl py-6">
      <Panel
        title="Access refused"
        right={<span className="vs-data opacity-60">§3.6</span>}
      >
        <div className="p-6">
          <div className="vs-display text-3xl">
            This screen is not open to{' '}
            <em className="vs-accent">{session.user.roles.join(' / ') || 'this role'}</em>.
          </div>

          <p className="mt-4 text-[13px] leading-relaxed opacity-80">
            Opening it needs <strong>{PERMISSION_LABEL[permission] ?? permission}</strong> (
            <code className="vs-data">{permission}</code>), which the §3.6 permission matrix does not
            grant to {session.user.roles.length > 1 ? 'any of your roles' : 'your role'} in{' '}
            {session.tenant.name}.
          </p>

          <p className="vs-label mt-3">
            Nothing was requested — the check ran before this page loaded, so the API was never
            asked for data you cannot read.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/console" className="vs-btn vs-btn-primary">
              Back to overview
            </Link>
            <Link href="/console/notifications" className="vs-btn">
              Your notifications
            </Link>
          </div>

          <div className="vs-label mt-6 border-t pt-4" style={{ borderColor: 'var(--vs-line)' }}>
            Ask a workspace administrator if you need this access — the request has to come from
            them, in this workspace, because roles are per-workspace and the change takes effect on
            your next request.
          </div>
        </div>
      </Panel>
    </div>
  );
}
