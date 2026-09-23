'use client';

/** Tenant administration (SRS FR-1.2, FR-1.3, §3.6). Members, roles and workspace policy. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ROLES, type Role } from '@void-space/types';

import { ApiRequestError, apiFetch } from '../../../lib/api';
import { formatNumber, formatRelative } from '../../../lib/format';
import { ErrorNote, Loading, Panel, Stat } from '../../../components/ui-kit';
import { RequirePermission } from '../../../components/permission-gate';

interface Member {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roles: readonly Role[];
  readonly status: 'invited' | 'active' | 'suspended';
  readonly lastLoginAt: string | null;
}

interface TenantDetail {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended';
  readonly createdAt: string;
  readonly settings: {
    readonly defaultPolycountBudget: number | null;
    readonly requiredMetadataFields: readonly string[];
    readonly allowedCategories: readonly string[];
    readonly webhookUrl: string | null;
    readonly webhookEvents: readonly string[];
  };
  readonly counts: { users: number; assets: number; licenses: number; pendingReview: number };
}

/**
 * Permission check happens here, above the queries, not after they fail: a role the §3.6 matrix
 * excludes never sends a request this screen would be refused for.
 */
export default function AdminPage() {
  return (
    <RequirePermission permission="tenant:manage-users">
      <TeamAdministration />
    </RequirePermission>
  );
}

function TeamAdministration() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  const tenant = useQuery<TenantDetail>({
    queryKey: ['tenant'],
    queryFn: () => apiFetch<{ tenant: TenantDetail }>('/tenant').then((r) => r.tenant),
  });

  const members = useQuery<{ users: readonly Member[] }>({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: readonly Member[] }>('/users'),
  });

  const invites = useQuery<{ invites: readonly { id: string; email: string; role: Role; expiresAt: string; acceptedAt: string | null }[] }>({
    queryKey: ['invites'],
    queryFn: () => apiFetch<{ invites: readonly { id: string; email: string; role: Role; expiresAt: string; acceptedAt: string | null }[] }>('/users/invites'),
  });

  async function mutate(label: string, path: string, body: unknown) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ invite?: { token: string; email: string } }>(path, { method: 'PATCH', body });
      setNotice(result.invite ? `Invitation token: ${result.invite.token}` : `${label} applied`);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['invites'] });
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="vs-display text-4xl">Administration</h1>
        <div className="vs-label mt-1">
          {tenant.data ? `${tenant.data.name} / ${tenant.data.slug}` : 'QUERYING'} / RBAC §3.6
        </div>
      </div>

      {error ? <ErrorNote message={error.message} code={error.code} /> : null}
      {notice ? <div className="vs-data vs-signal">&gt;&gt;&gt; {notice}</div> : null}

      <div className="vs-stat-strip grid-cols-2 lg:grid-cols-4">
        <Stat label="Members" value={formatNumber(tenant.data?.counts.users ?? 0)} />
        <Stat label="Assets" value={formatNumber(tenant.data?.counts.assets ?? 0)} />
        <Stat label="Licences" value={formatNumber(tenant.data?.counts.licenses ?? 0)} />
        <Stat label="Awaiting review" value={formatNumber(tenant.data?.counts.pendingReview ?? 0)} tone="accent" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Members" right={members.data ? `${members.data.users.length} RECORDS` : undefined}>
          {members.isLoading ? <Loading /> : null}
          {members.error ? <ErrorNote message={(members.error as Error).message} /> : null}

          {members.data ? (
            <div className="overflow-x-auto">
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th className="text-right">Last login</th>
                    <th className="text-right">Set role</th>
                  </tr>
                </thead>
                <tbody>
                  {members.data.users.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <div className="font-medium">{member.fullName}</div>
                        <div className="vs-label mt-1">{member.email}</div>
                      </td>
                      <td className="vs-data">{member.roles.join('+')}</td>
                      <td className="vs-data uppercase" style={{ color: member.status === 'active' ? 'var(--vs-published)' : 'var(--vs-accent)' }}>
                        {member.status}
                      </td>
                      <td className="vs-data whitespace-nowrap text-right opacity-70">
                        {formatRelative(member.lastLoginAt)}
                      </td>
                      <td className="text-right">
                        <select
                          className="vs-select w-36 py-1 text-[11px] uppercase"
                          value={member.roles[0] ?? ''}
                          disabled={busy !== null}
                          onChange={(event) =>
                            void mutate('ROLE CHANGE', `/users/${member.id}`, { role: event.target.value })
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>

        <div className="space-y-4">
          <Panel title="Workspace policy" right="FR-14.3">
            <div className="p-3">
              {tenant.data ? (
                <dl className="space-y-2">
                  <div className="flex justify-between gap-3">
                    <dt className="vs-label">Polycount budget</dt>
                    <dd className="vs-data">{formatNumber(tenant.data.settings.defaultPolycountBudget)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="vs-label">Required metadata</dt>
                    <dd className="vs-data">{tenant.data.settings.requiredMetadataFields.join(', ') || 'NONE'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="vs-label">Allowed categories</dt>
                    <dd className="vs-data text-right">{tenant.data.settings.allowedCategories.join(' / ') || 'ANY'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="vs-label">Webhook</dt>
                    <dd className="vs-data truncate">{tenant.data.settings.webhookUrl ?? 'NOT CONFIGURED'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="vs-label">Status</dt>
                    <dd className="vs-data uppercase">{tenant.data.status}</dd>
                  </div>
                </dl>
              ) : (
                <Loading />
              )}
            </div>
          </Panel>

          <Panel title="Invitations" right={invites.data ? `${invites.data.invites.length} ON RECORD` : undefined}>
            {invites.data && invites.data.invites.length > 0 ? (
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th className="text-right">State</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.data.invites.map((invite) => (
                    <tr key={invite.id}>
                      <td className="truncate">{invite.email}</td>
                      <td className="vs-data">{invite.role}</td>
                      <td className="vs-data text-right uppercase opacity-80">
                        {invite.acceptedAt ? 'ACCEPTED' : `EXPIRES ${formatRelative(invite.expiresAt)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="vs-data p-3 opacity-60">NO INVITATIONS</div>
            )}
          </Panel>

          <Panel title="Developer surface" right="FR-12.3">
            <div className="p-3 vs-data opacity-80">
              API keys are issued per user under the Developer role; the raw value is shown once at
              creation and only a scrypt hash is stored.
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
