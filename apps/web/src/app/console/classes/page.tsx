'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { LearningLayout, Panel, Notice, control, action } from '../../../components/learning-ui';
interface Assignment {
  id: string;
  title: string;
  kind: string;
  releaseId: string;
}
interface Class {
  id: string;
  title: string;
  ownerId: string;
  _count: { members: number };
  assignments: Assignment[];
}
export default function Classes() {
  const { can, switchTenant, session } = useSession(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState<Record<string, string>>({}),
    [report, setReport] = useState<
      Record<
        string,
        {
          members: {
            id: string;
            name: string;
            runs: {
              status: string;
              mode: string;
              mistakes: number;
              objectives: { id: string; label: string }[];
            }[];
          }[];
        }
      >
    >({});
  const classes = useQuery({
    queryKey: ['learning-classes'],
    queryFn: () => apiFetch<{ classes: Class[] }>('/learning/classes'),
  });
  const activities = useQuery({
    queryKey: ['learning-activities'],
    queryFn: () =>
      apiFetch<{ activities: { id: string; title: string; status: string; scope: string }[] }>(
        '/learning/activities',
      ),
    enabled: can('learning:manage'),
  });
  const programs = useQuery({
    queryKey: ['courses'],
    queryFn: () =>
      apiFetch<{ courses: { id: string; title: string; isPublished: boolean }[] }>('/courses'),
    enabled: can('learning:manage'),
  });
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await classes.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <LearningLayout
      title="Classes"
      description="Join with your teacher’s invitation, then complete work in the class workspace. Your personal sources remain private."
    >
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <div className="grid gap-6 md:grid-cols-2">
        <Panel>
          <h2 className="text-xl font-semibold">Join a class</h2>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void work(async () => {
                const r = await apiFetch<{ tenantId: string; title: string }>(
                  '/learning/classes/join',
                  {
                    method: 'POST',
                    body: {
                      code: data.get('code'),
                      ...(data.get('password') ? { password: data.get('password') } : {}),
                    },
                  },
                );
                await switchTenant(r.tenantId);
                setMessage(`Joined ${r.title} as a learner.`);
              });
            }}
          >
            <label className="grid gap-2">
              Invitation code
              <input className={control} name="code" required autoComplete="off" />
            </label>
            <details>
              <summary className="cursor-pointer text-sm underline">
                Already have an account in that workspace?
              </summary>
              <label className="mt-3 grid gap-2 text-sm">
                Verify that account’s password
                <input
                  className={control}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                />
              </label>
            </details>
            <button className={action} disabled={busy}>
              Join class
            </button>
          </form>
          <p className="text-sm text-ink-dim">
            Invitations expire and can be revoked. Joining never grants teaching or administration
            permissions.
          </p>
        </Panel>
        {can('learning:manage') && (
          <Panel>
            <h2 className="text-xl font-semibold">Create a class</h2>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void work(async () => {
                  await apiFetch('/learning/classes', {
                    method: 'POST',
                    body: Object.fromEntries(data),
                  });
                  setMessage('Class created. Generate an invitation to add learners.');
                });
              }}
            >
              <label className="grid gap-2">
                Class name
                <input className={control} name="title" required minLength={3} maxLength={200} />
              </label>
              <button className={action} disabled={busy}>
                Create class
              </button>
            </form>
          </Panel>
        )}
      </div>
      {classes.error && <Notice error>{classes.error.message}</Notice>}
      {classes.isPending && <Notice>Loading classes…</Notice>}
      {classes.data?.classes.map((c) => (
        <Panel key={c.id}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">{c.title}</h2>
            <span className="text-sm text-ink-dim">{c._count.members} learners</span>
          </div>
          <h3 className="font-medium">Assigned work</h3>
          {c.assignments.length ? (
            c.assignments.map((a) => (
              <p key={a.id}>
                <Link
                  className="underline"
                  href={
                    a.kind === 'activity'
                      ? `/console/learn/${a.releaseId}`
                      : a.kind === 'program'
                        ? `/console/learn/programs/${a.releaseId}`
                        : `/console/lessons?lesson=${a.releaseId}`
                  }
                >
                  {a.title}
                </Link>
              </p>
            ))
          ) : (
            <p className="text-ink-dim">No work assigned yet.</p>
          )}
          {can('learning:manage') && c.ownerId === session?.user.id && (
            <>
              <div className="flex flex-wrap gap-3">
                <button
                  className={action}
                  disabled={busy}
                  onClick={() =>
                    work(async () => {
                      const r = await apiFetch<{ code: string }>(
                        `/learning/classes/${c.id}/invite`,
                        { method: 'POST' },
                      );
                      setInvite((v) => ({ ...v, [c.id]: r.code }));
                    })
                  }
                >
                  Generate 7-day invitation
                </button>
                <button
                  className={action}
                  disabled={busy}
                  onClick={() =>
                    work(async () => {
                      await apiFetch(`/learning/classes/${c.id}/invite`, { method: 'DELETE' });
                      setInvite((v) => ({ ...v, [c.id]: '' }));
                      setMessage('Invitation revoked. Existing members remain in the class.');
                    })
                  }
                >
                  Revoke invitation
                </button>
              </div>
              {invite[c.id] && (
                <label className="grid gap-2 text-sm">
                  Share this invitation code
                  <input
                    className={control}
                    readOnly
                    value={invite[c.id]}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
              <form
                className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  const [kind, releaseId] = String(data.get('release')).split(':');
                  void work(async () => {
                    await apiFetch(`/learning/classes/${c.id}/assignments`, {
                      method: 'POST',
                      body: { title: data.get('title'), kind, releaseId },
                    });
                    setMessage(
                      'Published work assigned. Learners keep their own answers and progress.',
                    );
                  });
                }}
              >
                <label className="grid gap-2">
                  Assignment title
                  <input className={control} name="title" required minLength={3} />
                </label>
                <label className="grid gap-2">
                  Published material
                  <select name="release" className={control} required>
                    <option value="">Choose a release</option>
                    {activities.data?.activities
                      .filter((a) => a.status === 'published' && a.scope === 'workspace')
                      .map((a) => (
                        <option key={a.id} value={`activity:${a.id}`}>
                          {a.title}
                        </option>
                      ))}
                    {programs.data?.courses
                      .filter((p) => p.isPublished)
                      .map((p) => (
                        <option key={p.id} value={`program:${p.id}`}>
                          Program: {p.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button className={action + ' self-end'} disabled={busy}>
                  Assign
                </button>
              </form>
              <button
                className={action}
                disabled={busy}
                onClick={() =>
                  work(async () => {
                    const r = await apiFetch<{
                      members: {
                        id: string;
                        name: string;
                        runs: {
                          status: string;
                          mode: string;
                          mistakes: number;
                          objectives: { id: string; label: string }[];
                        }[];
                      }[];
                    }>(`/learning/classes/${c.id}/report`);
                    setReport((v) => ({ ...v, [c.id]: r }));
                  })
                }
              >
                View learner progress
              </button>
              {report[c.id] && (
                <div className="overflow-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Individual progress for {c.title}</caption>
                    <thead>
                      <tr>
                        <th className="p-3">Learner</th>
                        <th className="p-3">Practice / assessment</th>
                        <th className="p-3">Revision needs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report[c.id]!.members.map((m) => (
                        <tr className="border-t border-hairline" key={m.id}>
                          <th className="p-3">{m.name}</th>
                          <td className="p-3">
                            {m.runs.length
                              ? m.runs.map((r, i) => (
                                  <p key={i}>
                                    {r.mode} · {r.status}
                                  </p>
                                ))
                              : 'Not started'}
                          </td>
                          <td className="p-3">
                            {m.runs
                              .filter((r) => r.mistakes > 0)
                              .map((r, i) => (
                                <p key={i}>
                                  {r.mistakes} mistakes ·{' '}
                                  {r.objectives.map((o) => o.label).join(', ')}
                                </p>
                              ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Panel>
      ))}
    </LearningLayout>
  );
}
