'use client';
import Link from 'next/link';
import { useState } from 'react';
import { InstitutionMembers } from '../../../../components/institution-members';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../../lib/api';
import { useSession } from '../../../../lib/session';
import { LearningLayout, Panel, Notice, action, control } from '../../../../components/learning-ui';
export default function Page() {
  const client = useQueryClient();
  const { can, switchTenant, session } = useSession(),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [fullName, setFullName] = useState(''),
    [role, setRole] = useState('Learner'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [link, setLink] = useState('');
  const q = useQuery({
    queryKey: ['learning-workspace', session?.tenant.id],
    enabled: !!session,
    queryFn: () =>
      apiFetch<{
        workspace: { id: string; name: string; kind: string };
        lessons: { id: string; tenantId: string; title: string; summary: string }[];
      }>('/learning/workspace'),
  });
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <LearningLayout
      title="Institution"
      description="Institution-only lessons belong to a verified workspace. They are separate from private lessons and lessons shared publicly with everyone."
    >
      {error && <Notice error>{error}</Notice>}
      {q.error && <Notice error>{q.error.message}</Notice>}
      {q.isPending && <Notice>Opening your institution…</Notice>}
      {q.data &&
        (q.data.workspace.kind === 'personal' ? (
          <Panel>
            <h2 className="text-xl font-semibold">You’re in your personal workspace</h2>
            <p>
              Create a separate institution workspace when you want to invite students and
              educators. Your personal library, conversations and drafts stay private.
            </p>
            <label className="grid max-w-lg gap-2">
              Institution name
              <input
                className={control}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              className={action}
              disabled={busy || name.trim().length < 2}
              onClick={() =>
                void work(async () => {
                  const r = await apiFetch<{ workspace: { id: string } }>(
                    '/learning/workspace/institution',
                    { method: 'POST', body: { name } },
                  );
                  await switchTenant(r.workspace.id);
                  location.assign('/console/learn/institution');
                })
              }
            >
              Create institution workspace
            </button>
            <Link className="inline-block underline" href="/learn/join-institution">
              Accept an institution invitation
            </Link>
          </Panel>
        ) : (
          <>
            <div className="institution-access-summary">
              <strong>{q.data.workspace.name}</strong>
              <div>
                <strong>
                  Your access:{' '}
                  {can('tenant:manage-users')
                    ? 'Administrator'
                    : can('learning:manage')
                      ? 'Teacher'
                      : 'Student'}
                </strong>
                <p>
                  {can('tenant:manage-users')
                    ? 'Manage members, invitations and institution lessons.'
                    : can('learning:manage')
                      ? 'Create and share reviewed lessons. Member administration belongs to an administrator.'
                      : 'Study institution lessons and create your own private learning material. You cannot change institution access.'}
                </p>
              </div>
            </div>
            <div className="institution-workspace-grid">
              <section className="space-y-3">
                <h2 className="text-xl font-semibold">Institution lessons</h2>
                {q.data?.lessons.map((l) => (
                  <Link
                    className="block rounded-xl border border-hairline p-5"
                    key={l.id}
                    href={`/console/learn/lessons/${l.id}?tenant=${l.tenantId}`}
                  >
                    <h3 className="font-semibold">{l.title}</h3>
                    <p className="mt-2 text-sm text-ink-dim">{l.summary}</p>
                  </Link>
                ))}
                {q.data && !q.data.lessons.length && (
                  <Notice>
                    No institution lessons yet. An educator can review a lesson and publish it with
                    Institution-only visibility.
                  </Notice>
                )}
              </section>
              {can('tenant:manage-users') && (
                <Panel>
                  <h2 className="text-lg font-semibold">Invite a student or educator</h2>
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void work(async () => {
                        const r = await apiFetch<{ invite: { token: string } }>('/users/invite', {
                          method: 'POST',
                          body: { email, fullName, role },
                        });
                        await client.invalidateQueries({ queryKey: ['institution-invites'] });
                        setLink(
                          `${location.origin}/learn/join-institution?token=${encodeURIComponent(r.invite.token)}`,
                        );
                      });
                    }}
                  >
                    <label className="grid gap-2">
                      Full name
                      <input
                        className={control}
                        required
                        minLength={2}
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </label>
                    <label className="grid gap-2">
                      Email
                      <input
                        type="email"
                        required
                        className={control}
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setLink('');
                        }}
                      />
                    </label>
                    <label className="grid gap-2">
                      Access
                      <select
                        aria-label="Invitation access"
                        className={control}
                        value={role}
                        onChange={(e) => {
                          setRole(e.target.value);
                          setLink('');
                        }}
                      >
                        <option value="Learner">Student · learning access</option>
                        <option value="Creator">Educator · authoring access</option>
                      </select>
                    </label>
                    <button
                      className={action}
                      disabled={busy || !email || fullName.trim().length < 2}
                    >
                      Create invitation
                    </button>
                  </form>
                  {link && (
                    <label className="grid gap-2">
                      Send this private invitation to the intended recipient
                      <input className={control} readOnly value={link} />
                    </label>
                  )}
                </Panel>
              )}
            </div>
            {can('tenant:manage-users') && (
              <InstitutionMembers onInvitationRevoked={() => setLink('')} />
            )}
          </>
        ))}
    </LearningLayout>
  );
}
