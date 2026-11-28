'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useSession } from '../lib/session';
import { Panel, Notice, action, control } from './learning-ui';
interface Member {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
  status: string;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
}
const roleName = (role: string) =>
  role === 'Learner'
    ? 'Student'
    : role === 'Creator'
      ? 'Teacher'
      : role === 'TenantAdmin'
        ? 'Administrator'
        : role;
export function InstitutionMembers({ onInvitationRevoked }: { onInvitationRevoked?: () => void }) {
  const { session, can } = useSession(),
    client = useQueryClient();
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [removeId, setRemoveId] = useState('');
  const members = useQuery({
    queryKey: ['institution-members', session?.tenant.id],
    enabled: can('tenant:manage-users'),
    queryFn: () => apiFetch<{ users: Member[] }>('/users'),
  });
  const invites = useQuery({
    queryKey: ['institution-invites', session?.tenant.id],
    enabled: can('tenant:manage-users'),
    queryFn: () => apiFetch<{ invites: Invite[] }>('/users/invites'),
  });
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['institution-members'] }),
        client.invalidateQueries({ queryKey: ['institution-invites'] }),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!can('tenant:manage-users')) return null;
  return (
    <div className="space-y-5">
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <Panel>
        <h2 className="text-lg font-semibold">Pending invitations</h2>
        {invites.isPending && <p role="status">Loading invitations…</p>}
        {invites.error && <Notice error>{invites.error.message}</Notice>}
        {invites.data?.invites
          .filter((i) => !i.acceptedAt)
          .map((i) => (
            <div className="institution-member" key={i.id}>
              <div>
                <strong>{i.email}</strong>
                <p>
                  {roleName(i.role)} · Expires {new Date(i.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <button
                className={action}
                disabled={busy}
                aria-label={`Revoke invitation for ${i.email}`}
                onClick={() =>
                  void work(async () => {
                    await apiFetch(`/users/invites/${i.id}`, { method: 'DELETE' });
                    onInvitationRevoked?.();
                    setMessage('Invitation revoked. Its link can no longer be used.');
                  })
                }
              >
                Revoke
              </button>
            </div>
          ))}
        {invites.data && !invites.data.invites.some((i) => !i.acceptedAt) && (
          <p className="text-sm text-ink-dim">No pending invitations.</p>
        )}
      </Panel>
      <Panel>
        <h2 className="text-lg font-semibold">Members and access</h2>
        {members.isPending && <p role="status">Loading members…</p>}
        {members.error && <Notice error>{members.error.message}</Notice>}
        {members.data?.users.map((m) => (
          <div className="institution-member" key={m.id}>
            <div>
              <strong>
                {m.fullName}
                {m.id === session?.user.id ? ' (you)' : ''}
              </strong>
              <p>
                {m.email} · {m.status === 'active' ? 'Active' : 'Access removed'}
              </p>
            </div>
            <div className="institution-member-actions">
              {m.status === 'active' &&
              m.id !== session?.user.id &&
              !m.roles.includes('SuperAdmin') ? (
                <>
                  <label className="sr-only" htmlFor={`role-${m.id}`}>
                    Access for {m.fullName}
                  </label>
                  <select
                    id={`role-${m.id}`}
                    className={control}
                    value={drafts[m.id] ?? m.roles[0]}
                    disabled={busy}
                    onChange={(e) => setDrafts({ ...drafts, [m.id]: e.target.value })}
                  >
                    {!['Learner', 'Creator', 'TenantAdmin'].includes(m.roles[0] ?? '') && (
                      <option value={m.roles[0]}>{roleName(m.roles[0] ?? '')}</option>
                    )}
                    <option value="Learner">Student</option>
                    <option value="Creator">Teacher</option>
                    <option value="TenantAdmin">Administrator</option>
                  </select>
                  <button
                    className={action}
                    disabled={busy || !drafts[m.id] || drafts[m.id] === m.roles[0]}
                    onClick={() =>
                      void work(async () => {
                        await apiFetch(`/users/${m.id}`, {
                          method: 'PATCH',
                          body: { role: drafts[m.id] },
                        });
                        setMessage('Member access updated. Previous sessions were revoked.');
                      })
                    }
                  >
                    Save access
                  </button>
                  {removeId === m.id ? (
                    <>
                      <button
                        className={action}
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            await apiFetch(`/users/${m.id}`, { method: 'DELETE' });
                            setRemoveId('');
                            setMessage(
                              'Member access removed. Their work and audit history are retained.',
                            );
                          })
                        }
                      >
                        Confirm removal
                      </button>
                      <button className={action} onClick={() => setRemoveId('')}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className={action} disabled={busy} onClick={() => setRemoveId(m.id)}>
                      Remove access
                    </button>
                  )}
                </>
              ) : (
                <span className="text-sm text-ink-dim">
                  {m.roles.map(roleName).join(', ') || 'No active role'}
                </span>
              )}
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
