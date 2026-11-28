'use client';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { ShieldCheck, KeyRound, Users, Building2, LockKeyhole } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { LearningLayout, Notice, Panel, control, action } from '../../../components/learning-ui';
interface Access {
  granted: boolean;
  role: string | null;
  enrolled: boolean;
  elevated: boolean;
}
interface Person {
  id: string;
  fullName: string;
  email: string;
  status: string;
  platformRole: string | null;
  tenant: { name: string; kind: string };
}
interface Workspace {
  id: string;
  name: string;
  kind: string;
  status: string;
}
export default function PlatformPage() {
  const client = useQueryClient();
  const access = useQuery({
    queryKey: ['platform-access'],
    queryFn: () => apiFetch<Access>('/platform/access'),
    refetchInterval: 30000,
  });
  const overview = useQuery({
    queryKey: ['platform-overview'],
    enabled: !!access.data?.elevated,
    retry: false,
    queryFn: () =>
      apiFetch<{
        role: string;
        counts: { institutions: number; individuals: number; activeUsers: number };
        tenants: Workspace[];
      }>('/platform/overview'),
  });
  const events = useQuery({
    queryKey: ['platform-events'],
    enabled: !!access.data?.elevated && access.data.role === 'PlatformAdmin',
    retry: false,
    queryFn: () =>
      apiFetch<{
        events: { id: string; action: string; targetId: string | null; createdAt: string }[];
      }>('/platform/events'),
  });
  const [person, setPerson] = useState<Person | null>(null),
    [search, setSearch] = useState(''),
    [term, setTerm] = useState(''),
    [role, setRole] = useState('PlatformModerator'),
    [revoke, setRevoke] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const people = useInfiniteQuery({
    queryKey: ['platform-users', term],
    enabled: !!access.data?.elevated && access.data.role === 'PlatformAdmin',
    retry: false,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      apiFetch<{ users: Person[]; nextCursor: string | null }>(
        `/platform/users?q=${encodeURIComponent(term)}${pageParam ? `&cursor=${pageParam}` : ''}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [code, setCode] = useState(''),
    [secret, setSecret] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [recoveryCodes, setRecoveryCodes] = useState<string[]>([]),
    [reason, setReason] = useState(''),
    [target, setTarget] = useState<Workspace | null>(null);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ['platform-access'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <LearningLayout
      title="Platform administration"
      description="Manage institutions and individual accounts. This authority is separate from workspace membership."
    >
      {access.isPending && <p role="status">Checking platform access…</p>}
      {(error || access.error || overview.error) && (
        <Notice error>{error || access.error?.message || overview.error?.message}</Notice>
      )}
      {access.data && !access.data.granted && (
        <Panel>
          <LockKeyhole size={28} />
          <h2>Central access has not been granted</h2>
          <p>
            Institution administrators manage their own institution. Central platform administration
            requires an explicit account grant and an authenticator.
          </p>
        </Panel>
      )}
      {access.data?.granted && !access.data.elevated && (
        <section className="platform-verification">
          <ShieldCheck size={28} />
          <h2>Verify your administrator identity</h2>
          <p>
            Your account has{' '}
            {access.data.role === 'PlatformAdmin' ? 'platform administrator' : 'moderator'} access.
            Verification opens a 15-minute administration session.
          </p>
          {!access.data.enrolled && !secret && (
            <button
              className={action}
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  const r = await apiFetch<{ secret: string }>('/platform/mfa/enroll', {
                    method: 'POST',
                  });
                  setSecret(r.secret);
                })
              }
            >
              <KeyRound size={16} />
              Set up authenticator
            </button>
          )}
          {secret && (
            <div className="platform-enrollment">
              <p>
                Add this manual setup key to your authenticator. Choose a time-based, six-digit
                code.
              </p>
              <code>{secret}</code>
              <p>Keep this key private. It is shown only during this setup.</p>
            </div>
          )}
          {(access.data.enrolled || secret) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  const result = await apiFetch<{ recoveryCodes: string[] }>(
                    '/platform/mfa/verify',
                    { method: 'POST', body: { code } },
                  );
                  setRecoveryCodes(result.recoveryCodes);
                  setCode('');
                  setSecret('');
                });
              }}
            >
              <label className="grid gap-2">
                Authenticator or recovery code
                <input
                  className={control}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={80}
                  required
                />
              </label>
              <button className={action} disabled={busy || code.trim().length < 6}>
                Verify and open administration
              </button>
            </form>
          )}
        </section>
      )}
      {!!recoveryCodes.length && (
        <Panel>
          <h2>Save your recovery codes</h2>
          <p>Each code works once. These are shown only now. Store them somewhere private.</p>
          <pre className="platform-recovery">{recoveryCodes.join('\n')}</pre>
          <button
            className={action}
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([recoveryCodes.join('\n')], { type: 'text/plain' }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = 'void-space-platform-recovery.txt';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download recovery codes
          </button>
          <button className={action} onClick={() => setRecoveryCodes([])}>
            I saved them
          </button>
        </Panel>
      )}
      {access.data?.elevated && overview.data && (
        <>
          <div className="platform-overview">
            <div>
              <Building2 size={20} />
              <strong>{overview.data.counts.institutions}</strong>
              <span>Institutions</span>
            </div>
            <div>
              <Users size={20} />
              <strong>{overview.data.counts.individuals}</strong>
              <span>Personal workspaces</span>
            </div>
            <div>
              <ShieldCheck size={20} />
              <strong>{overview.data.counts.activeUsers}</strong>
              <span>Active accounts</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <h2 id="platform-workspaces" className="text-xl font-semibold">
              Workspaces
            </h2>
            <button
              className={action}
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await apiFetch('/platform/logout', { method: 'POST' });
                  client.removeQueries({ queryKey: ['platform-overview'] });
                  client.removeQueries({ queryKey: ['platform-events'] });
                })
              }
            >
              Lock administration
            </button>
          </div>
          <p className="text-sm text-ink-dim">
            Private file contents and lesson documents are not included in this console.
          </p>
          <div className="platform-workspaces">
            {overview.data.tenants.map((t) => (
              <article key={t.id}>
                <div>
                  <h3>{t.name}</h3>
                  <p>
                    {t.kind === 'personal' ? 'Individual' : 'Institution'} · {t.status}
                  </p>
                </div>
                {overview.data?.role === 'PlatformAdmin' && (
                  <button
                    className={action}
                    onClick={() => {
                      setTarget(t);
                      setReason('');
                    }}
                  >
                    {t.status === 'suspended' ? 'Restore workspace' : 'Suspend workspace'}
                  </button>
                )}
              </article>
            ))}
          </div>
          {target && (
            <Panel>
              <h3 className="font-semibold">
                {target.status === 'suspended' ? 'Restore' : 'Suspend'} {target.name}
              </h3>
              <p>
                Suspension blocks access for this workspace. Files and ownership records are
                retained.
              </p>
              <label className="grid gap-2">
                Reason
                <input
                  className={control}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="flex gap-3">
                <button
                  className={action}
                  disabled={busy || reason.trim().length < 5}
                  onClick={() =>
                    void work(async () => {
                      await apiFetch(`/platform/tenants/${target.id}/status`, {
                        method: 'PATCH',
                        body: { suspended: target.status !== 'suspended', reason },
                      });
                      setTarget(null);
                      await overview.refetch();
                      await events.refetch();
                    })
                  }
                >
                  Confirm {target.status === 'suspended' ? 'restore' : 'suspension'}
                </button>
                <button className={action} onClick={() => setTarget(null)}>
                  Cancel
                </button>
              </div>
            </Panel>
          )}
          {overview.data.role === 'PlatformAdmin' && (
            <section id="platform-accounts" className="space-y-5">
              <h2 className="text-xl font-semibold">Accounts and access</h2>
              <label className="grid gap-2 max-w-lg">
                Find an account
                <input
                  className={control}
                  type="search"
                  value={search}
                  maxLength={120}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name or sign-in email"
                />
              </label>
              {people.isPending && <p role="status">Loading accounts…</p>}
              {people.error && <Notice error>{people.error.message}</Notice>}
              <div className="platform-workspaces">
                {people.data?.pages
                  .flatMap((page) => page.users)
                  .map((user) => (
                    <article key={user.id}>
                      <div>
                        <h3>{user.fullName}</h3>
                        <p>
                          {user.email} · {user.tenant.name}
                        </p>
                        <p>
                          {user.status}
                          {user.platformRole ? ` · ${user.platformRole}` : ''}
                        </p>
                      </div>
                      <button
                        className={action}
                        onClick={() => {
                          setPerson(user);
                          setRole(user.platformRole ?? 'PlatformModerator');
                          setRevoke(false);
                          setReason('');
                        }}
                      >
                        Manage account
                      </button>
                    </article>
                  ))}
              </div>
              {people.hasNextPage && (
                <button
                  className={action}
                  disabled={people.isFetchingNextPage}
                  onClick={() => void people.fetchNextPage()}
                >
                  Load more accounts
                </button>
              )}
              {person && (
                <Panel>
                  <h3 className="font-semibold">Manage {person.fullName}</h3>
                  <p>
                    {person.email} · {person.tenant.name}
                  </p>
                  <p className="text-sm text-ink-dim">
                    Central access is separate from this account’s institution role. New central
                    administrators must enroll their own authenticator.
                  </p>
                  <label className="grid gap-2">
                    Central role
                    <select
                      className={control}
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option value="PlatformModerator">Platform moderator</option>
                      <option value="PlatformAdmin">Platform administrator</option>
                    </select>
                  </label>
                  {person.platformRole && (
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={revoke}
                        onChange={(e) => setRevoke(e.target.checked)}
                      />
                      Revoke central access
                    </label>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      className={action}
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          await apiFetch(`/platform/access/${person.id}`, {
                            method: 'PUT',
                            body: { role, revoked: revoke },
                          });
                          setPerson(null);
                          await people.refetch();
                          await events.refetch();
                        })
                      }
                    >
                      Confirm access change
                    </button>
                    <button className={action} onClick={() => setPerson(null)}>
                      Cancel
                    </button>
                  </div>
                  <label className="grid gap-2">
                    Account suspension reason
                    <input
                      className={control}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                    />
                  </label>
                  <button
                    className={action}
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      void work(async () => {
                        await apiFetch(`/platform/users/${person.id}/status`, {
                          method: 'PATCH',
                          body: { active: person.status !== 'active', reason },
                        });
                        setPerson(null);
                        await people.refetch();
                        await events.refetch();
                      })
                    }
                  >
                    {person.status === 'active' ? 'Confirm account suspension' : 'Restore account'}
                  </button>
                </Panel>
              )}
            </section>
          )}
          {events.data && (
            <details id="platform-audit" className="lesson-options">
              <summary>Platform audit history</summary>
              <ol className="space-y-3">
                {events.data.events.map((event) => (
                  <li key={event.id} className="text-sm">
                    <strong>{event.action.replaceAll('.', ' ')}</strong>
                    <p>
                      {new Date(event.createdAt).toLocaleString()}
                      {event.targetId ? ` · ${event.targetId}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </LearningLayout>
  );
}
