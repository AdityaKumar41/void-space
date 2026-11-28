'use client';

/**
 * Tenant administration (SRS FR-1.2, FR-1.3, FR-12.3, FR-18.1, §3.6).
 * Members, invites and API keys — all wired to the API.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ROLES, type Role } from '@void-space/types';

import { ApiRequestError, apiFetch } from '../../../lib/api';
import { formatNumber, formatRelative } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { Panel } from '../../../components/ui/card';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';
import { RequirePermission } from '../../../components/permission-gate';
import {
  EventChip,
  PageHead,
  PersonCell,
  StatCell,
  StatRow,
} from '../../../components/console-kit';

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

interface ApiKeySummary {
  readonly id: string;
  readonly label: string;
  readonly prefix: string;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export default function AdminPage() {
  return (
    <RequirePermission permission="tenant:manage-users">
      <TeamAdministration />
    </RequirePermission>
  );
}

function TeamAdministration() {
  const queryClient = useQueryClient();
  const { session, can } = useSession();
  const tenantId = session?.tenant.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('Creator');
  const [keyLabel, setKeyLabel] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const tenant = useQuery<TenantDetail>({
    queryKey: ['tenant'],
    queryFn: () => apiFetch<{ tenant: TenantDetail }>('/tenant').then((r) => r.tenant),
  });

  const members = useQuery<{ users: readonly Member[] }>({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: readonly Member[] }>('/users'),
  });

  const invites = useQuery<{
    invites: readonly {
      id: string;
      email: string;
      role: Role;
      expiresAt: string;
      acceptedAt: string | null;
      token?: string;
    }[];
  }>({
    queryKey: ['invites'],
    queryFn: () =>
      apiFetch<{
        invites: readonly {
          id: string;
          email: string;
          role: Role;
          expiresAt: string;
          acceptedAt: string | null;
        }[];
      }>('/users/invites'),
  });

  const apiKeys = useQuery<{ items: readonly ApiKeySummary[]; total: number }>({
    queryKey: ['api-keys', tenantId],
    enabled: Boolean(tenantId) && can('apikey:manage'),
    queryFn: () =>
      apiFetch<{ items: readonly ApiKeySummary[]; total: number }>(`/tenants/${tenantId}/api-keys`),
  });

  async function mutate(
    label: string,
    path: string,
    body: unknown,
    method: 'PATCH' | 'POST' | 'DELETE' = 'PATCH',
  ) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{
        invite?: { token: string; email: string };
        key?: string;
        label?: string;
      }>(path, { method, body: method === 'DELETE' ? undefined : body });
      if (result.invite?.token) {
        setNotice(`Invitation created for ${result.invite.email}. Token: ${result.invite.token}`);
      } else if (typeof result.key === 'string') {
        setCreatedKey(result.key);
        setNotice(
          `API key “${result.label ?? 'new'}” created. Copy it now — it will not be shown again.`,
        );
      } else {
        setNotice(`${label} applied`);
      }
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['invites'] });
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      await queryClient.invalidateQueries({ queryKey: ['tenant'] });
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-7">
      <PageHead
        title="Administration"
        meta={
          tenant.data
            ? `${tenant.data.name} · ${tenant.data.slug} · roles follow the §3.6 permission matrix`
            : 'Querying'
        }
      />

      {error ? <ErrorNote message={error.message} code={error.code} /> : null}
      {notice ? (
        <div
          className="relative overflow-hidden rounded-card border border-hairline bg-surface shadow-panel flex items-center gap-3 px-5 py-3.5"
          role="status"
        >
          <span className="font-mono text-[12px] text-ink-dim break-all">{notice}</span>
        </div>
      ) : null}
      {createdKey ? (
        <div className="rounded-card border border-brand/40 bg-heat-8 px-5 py-4">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-warm">
            New API key — copy once
          </div>
          <code className="mt-2 block break-all font-mono text-[13px] text-ink">{createdKey}</code>
          <button
            type="button"
            className="mt-3 text-[13px] font-semibold text-brand-warm"
            onClick={() => {
              void navigator.clipboard.writeText(createdKey);
              setNotice('API key copied to clipboard.');
            }}
          >
            Copy to clipboard
          </button>
        </div>
      ) : null}

      <StatRow>
        <StatCell label="Members" value={formatNumber(tenant.data?.counts.users ?? 0)} />
        <StatCell label="Assets" value={formatNumber(tenant.data?.counts.assets ?? 0)} />
        <StatCell label="Licences" value={formatNumber(tenant.data?.counts.licenses ?? 0)} />
        <StatCell
          label="Awaiting review"
          value={formatNumber(tenant.data?.counts.pendingReview ?? 0)}
          tone={(tenant.data?.counts.pendingReview ?? 0) > 0 ? 'heat' : 'plain'}
        />
      </StatRow>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Panel
          title="Members"
          right={members.data ? `${members.data.users.length} records` : undefined}
        >
          {members.isLoading ? <LoadingBlock label="Loading members" /> : null}
          {members.error ? <ErrorNote message={(members.error as Error).message} /> : null}

          {members.data ? (
            <div className="overflow-x-auto">
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th className="text-right">Last seen</th>
                    <th className="text-right">Set role</th>
                  </tr>
                </thead>
                <tbody>
                  {members.data.users.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <PersonCell name={member.fullName} sub={member.email} />
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {member.roles.map((role) => (
                            <span key={role} className="chip">
                              {role}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <EventChip
                          action={
                            member.status === 'active'
                              ? 'tenant.member_active'
                              : member.status === 'invited'
                                ? 'tenant.user_invited'
                                : 'tenant.member_suspended'
                          }
                        />
                      </td>
                      <td className="font-mono text-[12px] text-ink-dim whitespace-nowrap text-right">
                        {formatRelative(member.lastLoginAt)}
                      </td>
                      <td className="text-right">
                        <label className="relative inline-flex w-auto">
                          <span className="sr-only">{`Set the role for ${member.fullName}`}</span>
                          <select
                            value={member.roles[0] ?? ''}
                            disabled={busy !== null}
                            aria-label={`Set the role for ${member.fullName}`}
                            onChange={(event) =>
                              void mutate('Role change', `/users/${member.id}`, {
                                role: event.target.value,
                              })
                            }
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>

        <div className="space-y-5">
          <Panel title="Workspace policy" right="FR-14.3">
            {tenant.data ? (
              <dl className="px-5 py-2">
                {[
                  {
                    key: 'Polycount budget',
                    value: formatNumber(tenant.data.settings.defaultPolycountBudget),
                  },
                  {
                    key: 'Required metadata',
                    value: tenant.data.settings.requiredMetadataFields.join(', ') || 'None',
                  },
                  {
                    key: 'Allowed categories',
                    value: tenant.data.settings.allowedCategories.join(' / ') || 'Any',
                  },
                  { key: 'Webhook', value: tenant.data.settings.webhookUrl ?? 'Not configured' },
                  { key: 'Status', value: tenant.data.status },
                ].map((row) => (
                  <div className="vs-spec-row" key={row.key}>
                    <span className="vs-spec-key">{row.key}</span>
                    <span className="vs-spec-value break-words">{row.value}</span>
                  </div>
                ))}
              </dl>
            ) : (
              <LoadingBlock label="Loading policy" />
            )}
          </Panel>

          <Panel title="Invite member" right="FR-1.2">
            <form
              className="space-y-3 px-5 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(
                  'Invite',
                  '/users/invite',
                  {
                    email: inviteEmail,
                    fullName: inviteName,
                    role: inviteRole,
                  },
                  'POST',
                ).then(() => {
                  setInviteEmail('');
                  setInviteName('');
                });
              }}
            >
              <label className="block">
                <span className="text-[12px] text-ink-faint">Full name</span>
                <input
                  className="mt-1 h-9 w-full rounded-control border border-hairline bg-surface px-3 text-[13.5px] text-ink"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  required
                  minLength={2}
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-ink-faint">Email</span>
                <input
                  type="email"
                  className="mt-1 h-9 w-full rounded-control border border-hairline bg-surface px-3 text-[13.5px] text-ink"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-ink-faint">Role</span>
                <select
                  className="mt-1 h-9 w-full rounded-control border border-hairline bg-surface px-3 text-[13.5px] text-ink"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                >
                  {ROLES.filter((role) => role !== 'SuperAdmin').map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy !== null}
                className="inline-flex h-9 items-center justify-center rounded-control border border-brand bg-brand px-4 text-[13px] font-semibold text-white"
              >
                {busy === 'Invite' ? 'Sending…' : 'Send invitation'}
              </button>
            </form>
            {invites.data && invites.data.invites.length > 0 ? (
              <div className="overflow-x-auto">
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
                        <td>
                          <span className="chip">{invite.role}</span>
                        </td>
                        <td className="font-mono text-[12px] text-ink-dim whitespace-nowrap text-right">
                          {invite.acceptedAt
                            ? 'Accepted'
                            : `Expires ${formatRelative(invite.expiresAt)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-4 text-[13.5px]" style={{ color: 'var(--vs-fg-faint)' }}>
                No invitations outstanding.
              </div>
            )}
          </Panel>

          <Panel title="API keys" right="FR-12.3">
            {can('apikey:manage') && tenantId ? (
              <div className="space-y-4 px-5 py-4">
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!keyLabel.trim()) return;
                    void mutate(
                      'Create key',
                      `/tenants/${tenantId}/api-keys`,
                      { label: keyLabel.trim() },
                      'POST',
                    ).then(() => setKeyLabel(''));
                  }}
                >
                  <label className="min-w-[12rem] flex-1">
                    <span className="text-[12px] text-ink-faint">Label</span>
                    <input
                      className="mt-1 h-9 w-full rounded-control border border-hairline bg-surface px-3 text-[13.5px] text-ink"
                      value={keyLabel}
                      onChange={(e) => setKeyLabel(e.target.value)}
                      placeholder="CI publish"
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className="inline-flex h-9 items-center justify-center rounded-control border border-brand bg-brand px-4 text-[13px] font-semibold text-white"
                  >
                    Create key
                  </button>
                </form>
                {apiKeys.isLoading ? <LoadingBlock label="Loading keys" /> : null}
                {apiKeys.data && apiKeys.data.items.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="vs-table">
                      <thead>
                        <tr>
                          <th>Label</th>
                          <th>Prefix</th>
                          <th className="text-right">Last used</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apiKeys.data.items.map((key) => (
                          <tr key={key.id}>
                            <td>{key.label}</td>
                            <td className="font-mono text-[12px]">{key.prefix}…</td>
                            <td className="text-right font-mono text-[12px] text-ink-dim">
                              {key.revokedAt
                                ? 'Revoked'
                                : formatRelative(key.lastUsedAt ?? key.createdAt)}
                            </td>
                            <td className="text-right">
                              {!key.revokedAt ? (
                                <button
                                  type="button"
                                  className="text-[12px] font-semibold text-state-failed"
                                  disabled={busy !== null}
                                  onClick={() =>
                                    void mutate(
                                      'Revoke key',
                                      `/tenants/${tenantId}/api-keys/${key.id}`,
                                      undefined,
                                      'DELETE',
                                    )
                                  }
                                >
                                  Revoke
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[13.5px]" style={{ color: 'var(--vs-fg-faint)' }}>
                    No API keys yet. Create one to call `/auth/token` from CI or a storefront.
                  </p>
                )}
              </div>
            ) : (
              <div
                className="px-5 py-5 text-[13.5px] leading-relaxed"
                style={{ color: 'var(--vs-fg-dim)' }}
              >
                API key management requires the Developer permission (`apikey:manage`). Ask a
                workspace admin to grant the Developer role if you need to mint keys.
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
