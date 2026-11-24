'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LearningActivity } from '@void-space/types';
import { API_PUBLIC_BASE, apiFetch } from '../lib/api';
import { useSession } from '../lib/session';
import { Panel, Notice, control, action } from './learning-ui';
const Visual = dynamic(() => import('./learning-visual'), { ssr: false });
interface Session {
  revision: number;
  focus: { activityId: string; targetId: string | null } | null;
  annotations: { id: string; text: string; author: string; targetId: string | null }[];
  questions: { id: string; text: string; author: string; resolved: boolean }[];
  poll: {
    id: string;
    question: string;
    options: string[];
    ownVote: number | null;
    counts: number[] | null;
    total: number;
    closed: boolean;
  } | null;
  recap: { text: string; reviewed: boolean; activityId: string | null } | null;
}
export function LearningRoom({ roomId }: { roomId: string }) {
  const { can } = useSession(),
    teacher = can('spatial:manage');
  const [follow, setFollow] = useState(true),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [recapTask, setRecapTask] = useState(''),
    [recapDraft, setRecapDraft] = useState('');
  const recap = useQuery({
    queryKey: ['learning-recap', recapTask],
    queryFn: () =>
      apiFetch<{ task: { status: string; error?: string; result?: { recap?: string } } }>(
        `/learning/tasks/${recapTask}`,
      ),
    enabled: !!recapTask,
    refetchInterval: (q) =>
      ['queued', 'active'].includes(q.state.data?.task.status ?? 'queued') ? 2000 : false,
  });
  useEffect(() => {
    if (recap.data?.task.result?.recap) setRecapDraft(recap.data.task.result.recap);
  }, [recap.data]);
  const session = useQuery({
    queryKey: ['learning-room', roomId],
    queryFn: () => apiFetch<{ session: Session }>(`/learning/rooms/${roomId}`),
    refetchInterval: 3000,
  });
  const activities = useQuery({
    queryKey: ['learning-activities'],
    queryFn: () =>
      apiFetch<{ activities: { id: string; title: string; status: string; scope: string }[] }>(
        '/learning/activities',
      ),
    enabled: teacher,
  });
  const focus = session.data?.session.focus;
  const activity = useQuery({
    queryKey: ['learning-activity', focus?.activityId],
    queryFn: () =>
      apiFetch<{ activity: { definition: LearningActivity } }>(
        `/learning/activities/${focus!.activityId}`,
      ),
    enabled: !!focus,
  });
  useEffect(() => {
    if (follow) setSelected(focus?.targetId ?? null);
  }, [focus?.activityId, focus?.targetId, follow]);
  async function send(body: Record<string, unknown>) {
    if (!session.data) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/learning/rooms/${roomId}/events`, {
        method: 'POST',
        body: { ...body, eventKey: crypto.randomUUID(), revision: session.data.session.revision },
      });
      await session.refetch();
    } catch (e) {
      setError((e as Error).message);
      await session.refetch();
    } finally {
      setBusy(false);
    }
  }
  const s = session.data?.session,
    a = activity.data?.activity.definition,
    target = a?.targets.find((t) => t.id === selected);
  return (
    <div className="space-y-5 py-5">
      <h2 className="text-2xl font-semibold">Shared learning session</h2>
      {error && <Notice error>{error}</Notice>}
      {session.error && <Notice error>{session.error.message}</Notice>}
      {teacher && (
        <label className="grid gap-2">
          Shared activity
          <select
            className={control}
            disabled={busy}
            value={focus?.activityId ?? ''}
            onChange={(e) => send({ kind: 'focus', activityId: e.target.value, targetId: null })}
          >
            <option value="">Choose published learning material</option>
            {activities.data?.activities
              .filter((a) => a.status === 'published' && a.scope === 'workspace')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {a && (
        <Panel>
          <h3 className="text-xl font-semibold">{a.title}</h3>
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow facilitator’s visual focus
          </label>
          <Visual
            activity={a}
            visualUrl={`${API_PUBLIC_BASE}/learning/activities/${focus!.activityId}/visual`}
            selected={selected}
            exploded={false}
            isolated={null}
            onSelect={(id) => {
              setSelected(id);
              if (teacher)
                void send({ kind: 'focus', activityId: focus!.activityId, targetId: id });
              else setFollow(false);
            }}
          />
          <div className="flex flex-wrap gap-2">
            {a.targets.map((t) => (
              <button
                key={t.id}
                className={action}
                aria-pressed={selected === t.id}
                disabled={busy}
                onClick={() => {
                  setSelected(t.id);
                  if (teacher)
                    void send({ kind: 'focus', activityId: focus!.activityId, targetId: t.id });
                  else setFollow(false);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {target && (
            <div className="space-y-2">
              <h4 className="font-semibold">{target.label}</h4>
              <p>{target.explanation}</p>
            </div>
          )}
          <Link className="inline-block underline" href={`/console/learn/${focus!.activityId}`}>
            Open individual practice & assessment
          </Link>
          <p className="text-sm text-ink-dim">
            Your answers and assessed progress stay individual.
          </p>
        </Panel>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <h3 className="text-xl font-semibold">Question queue</h3>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const text = new FormData(e.currentTarget).get('text');
              void send({ kind: 'question', text });
              e.currentTarget.reset();
            }}
          >
            <label className="grid gap-2">
              Ask the facilitator
              <textarea className={control} name="text" minLength={2} maxLength={1500} required />
            </label>
            <button className={action} disabled={busy}>
              Add question
            </button>
          </form>
          {s?.questions.map((q) => (
            <div className="border-t border-hairline pt-3" key={q.id}>
              <p>{q.text}</p>
              <p className="text-sm text-ink-dim">
                {q.author} · {q.resolved ? 'Discussed' : 'Waiting'}
              </p>
              {teacher && !q.resolved && (
                <button
                  className={action}
                  disabled={busy}
                  onClick={() => send({ kind: 'resolve', questionId: q.id })}
                >
                  Mark discussed
                </button>
              )}
            </div>
          ))}
        </Panel>
        <Panel>
          <h3 className="text-xl font-semibold">Formative poll</h3>
          {s?.poll && (
            <>
              <p>{s.poll.question}</p>
              {s.poll.options.map((o, i) => (
                <button
                  className={action + ' block w-full text-left'}
                  key={i}
                  aria-pressed={s.poll!.ownVote === i}
                  disabled={busy || s.poll!.closed}
                  onClick={() => send({ kind: 'vote', option: i })}
                >
                  {o}
                  {s.poll!.counts ? ` · ${s.poll!.counts[i]} votes` : ''}
                  {s.poll!.ownVote === i ? ' · your answer' : ''}
                </button>
              ))}
              <p className="text-sm text-ink-dim">
                {s.poll.total} responses · {s.poll.closed ? 'Closed' : 'Open'} · no assessed score
              </p>
              {teacher && !s.poll.closed && (
                <button className={action} onClick={() => send({ kind: 'close_poll' })}>
                  Close poll & show results
                </button>
              )}
            </>
          )}
          {teacher && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void send({
                  kind: 'poll',
                  text: d.get('question'),
                  options: String(d.get('options'))
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
            >
              <label className="grid gap-2">
                Poll question
                <input className={control} name="question" required minLength={2} />
              </label>
              <label className="grid gap-2">
                Options (2–6, one per line)
                <textarea className={control} name="options" required />
              </label>
              <button className={action} disabled={busy}>
                Open new poll
              </button>
            </form>
          )}
        </Panel>
        <Panel>
          <h3 className="text-xl font-semibold">Shared annotations</h3>
          {s?.annotations.map((a) => (
            <p key={a.id}>
              {a.text}
              <span className="block text-sm text-ink-dim">
                {a.author}
                {a.targetId ? ` · ${a.targetId}` : ''}
              </span>
            </p>
          ))}
          {teacher && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send({
                  kind: 'annotate',
                  text: new FormData(e.currentTarget).get('text'),
                  targetId: selected,
                });
              }}
            >
              <label className="grid gap-2">
                Note for the selected component
                <textarea name="text" className={control} required minLength={2} maxLength={1500} />
              </label>
              <button className={action} disabled={busy}>
                Share annotation
              </button>
            </form>
          )}
        </Panel>
        <Panel>
          <h3 className="text-xl font-semibold">Session recap</h3>
          {teacher && (
            <button
              className={action}
              disabled={busy || ['queued', 'active'].includes(recap.data?.task.status ?? '')}
              onClick={async () => {
                setError('');
                try {
                  const r = await apiFetch<{ task: { id: string } }>(
                    `/learning/rooms/${roomId}/recap-draft`,
                    { method: 'POST' },
                  );
                  setRecapTask(r.task.id);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Draft recap with AI
            </button>
          )}
          {recap.data && (
            <Notice error={recap.data.task.status === 'failed'}>
              {recap.data.task.status}:{' '}
              {recap.data.task.error ?? 'Review the draft before sharing.'}
            </Notice>
          )}
          {s?.recap && (
            <>
              <p className="whitespace-pre-wrap leading-relaxed">{s.recap.text}</p>
              <p className="text-sm text-ink-dim">
                {s.recap.reviewed ? 'Reviewed and shared' : 'Draft · facilitator only'}
              </p>
              {s.recap.activityId && (
                <Link className="underline" href={`/console/learn/${s.recap.activityId}`}>
                  Review the material covered
                </Link>
              )}
            </>
          )}
          {teacher && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void send({
                  kind: 'recap',
                  text: d.get('text'),
                  reviewed: d.get('reviewed') === 'on',
                });
              }}
            >
              <label className="grid gap-2">
                Recap draft
                <textarea
                  name="text"
                  className={control}
                  value={recapDraft}
                  onChange={(e) => setRecapDraft(e.target.value)}
                  required
                  minLength={2}
                  maxLength={1500}
                />
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" name="reviewed" />I reviewed this recap and want to share it
              </label>
              <button className={action} disabled={busy}>
                Save recap
              </button>
            </form>
          )}
        </Panel>
      </div>
    </div>
  );
}
