'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LearningActivity, LearningStep, ExperienceState } from '@void-space/types';
import { API_PUBLIC_BASE, apiFetch, ApiRequestError } from '../lib/api';
import { LearningLayout, Panel, Notice, control, action } from './learning-ui';
const Visual = dynamic(() => import('./learning-visual'), {
  ssr: false,
  loading: () => <Notice>Loading the visual explorer…</Notice>,
});
interface Run {
  id: string;
  mode: 'practice' | 'assessment';
  revision: number;
  status: string;
  state: ExperienceState;
  currentStep: LearningStep | null;
  totalSteps: number;
  score: number;
  passed: boolean;
}
interface ActivityView {
  id: string;
  owned: boolean;
  status: string;
  scope: string;
  definition: LearningActivity;
  sources: { id: string; title: string; passages: { id: string; page: number; text: string }[] }[];
}
export function LearningPlayer({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['learning-activity', id],
    queryFn: () => apiFetch<{ activity: ActivityView }>(`/learning/activities/${id}`),
  });
  const [run, setRun] = useState<Run | null>(null),
    [mode, setMode] = useState<'explore' | 'practice' | 'assessment'>('explore'),
    [selected, setSelected] = useState<string | null>(null),
    [exploded, setExploded] = useState(false),
    [isolated, setIsolated] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [answer, setAnswer] = useState(''),
    [choice, setChoice] = useState<string[]>([]),
    [order, setOrder] = useState<string[]>([]),
    [pairs, setPairs] = useState<Record<string, string>>({}),
    [text, setText] = useState(''),
    [meshCount, setMeshCount] = useState(0);
  const pending = useRef<Record<string, unknown> | null>(null);
  const a = query.data?.activity,
    definition = a?.definition,
    step = run?.currentStep;
  const history = useQuery({
    queryKey: ['learning-runs', id],
    queryFn: () => apiFetch<{ runs: Run[] }>(`/simulations/${id}/runs`),
  });
  useEffect(() => {
    if (step?.kind === 'order') setOrder(step.items.map((x) => x.id));
    setChoice([]);
    setPairs({});
    setText('');
  }, [run?.id, run?.state.stepIndex]);
  useEffect(() => {
    if (run) {
      setExploded(run.state.scene.exploded);
      setIsolated(run.state.scene.isolatedTargetId);
    }
  }, [run?.revision, run?.id]);
  async function start(chosen: 'practice' | 'assessment', restart = false) {
    setBusy(true);
    setError('');
    pending.current = null;
    try {
      const result = await apiFetch<{ run: Run }>(`/simulations/${id}/runs`, {
        method: 'POST',
        body: { mode: chosen, restart },
      });
      setRun(result.run);
      setMode(chosen);
      await history.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(value: Record<string, unknown>) {
    if (!run || busy) return;
    setBusy(true);
    setError('');
    const event = pending.current ?? {
      ...value,
      eventKey: crypto.randomUUID(),
      revision: run.revision,
    };
    pending.current = event;
    try {
      const response = await apiFetch<{ run: Run }>(`/experience-runs/${run.id}/events`, {
        method: 'POST',
        body: event,
      });
      setRun(response.run);
      pending.current = null;
      await history.refetch();
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        const current = await apiFetch<{ run: Run }>(`/experience-runs/${run.id}`);
        setRun(current.run);
        pending.current = null;
        setError(
          'This activity changed in another tab. The latest saved state is loaded; try your action again.',
        );
      } else setError((e as Error).message + ' Retry the action to recover the same submission.');
    } finally {
      setBusy(false);
    }
  }
  function select(targetId: string) {
    setSelected(targetId);
    if (mode !== 'explore' && step?.kind === 'identify')
      void send({ kind: 'select_target', targetId });
  }
  async function coach(question: string) {
    setBusy(true);
    setError('');
    try {
      const r = await apiFetch<{ answer: string; mode: string }>(
        `/learning/activities/${id}/mentor`,
        {
          method: 'POST',
          body: {
            question,
            targetId: selected ?? undefined,
            runId: mode === 'practice' ? run?.id : undefined,
          },
        },
      );
      setAnswer(r.answer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending) return <Notice>Loading activity…</Notice>;
  if (query.error || !a || !definition)
    return (
      <Notice error>
        {query.error?.message ?? 'Activity unavailable'}{' '}
        <button onClick={() => query.refetch()}>Retry</button>
      </Notice>
    );
  const target = definition.targets.find((t) => t.id === selected),
    assessment = mode === 'assessment' && run?.status === 'active';
  const canOperate =
    definition.scene.kind === 'model' && (definition.scene.builtin === 'geometry' || meshCount > 1);
  return (
    <LearningLayout
      title={definition.title}
      description={`${definition.summary} · ${definition.level} · ${definition.estimatedMinutes} min`}
    >
      <div className="flex flex-wrap items-center gap-3" aria-label="Learning mode">
        <button
          className={action}
          aria-pressed={mode === 'explore'}
          onClick={() => {
            setMode('explore');
            setRun(null);
            setAnswer('');
          }}
        >
          Explore
        </button>
        <button
          className={action}
          disabled={busy}
          aria-pressed={mode === 'practice'}
          onClick={() => start('practice')}
        >
          Guided practice
        </button>
        <button
          className={action}
          disabled={
            busy ||
            a.status !== 'published' ||
            definition.steps.some((s) => s.kind === 'reflection')
          }
          aria-pressed={mode === 'assessment'}
          onClick={() => start('assessment')}
        >
          Assessment
        </button>
        {a.scope === 'private' && (
          <span className="text-sm text-ink-dim">Private practice · no official achievement</span>
        )}
        {a.owned && (
          <Link className="underline" href={`/console/learn/author/${id}`}>
            Review draft
          </Link>
        )}
      </div>
      <Notice>
        {mode === 'explore'
          ? 'Explore freely. Select a component, read the source and ask questions.'
          : mode === 'practice'
            ? 'Guided practice: hints and retries are available. This does not award assessed achievement.'
            : 'Assessment: your answers are scored by reviewed rules. Coaching is unavailable.'}
      </Notice>
      {error && <Notice error>{error}</Notice>}
      {history.data?.runs.some((r) => r.status === 'active') && !run && (
        <Panel>
          <h2 className="font-semibold">Resume saved work</h2>
          {history.data.runs
            .filter((r) => r.status === 'active')
            .map((r) => (
              <button
                key={r.id}
                className={action}
                onClick={() => {
                  setRun(r);
                  setMode(r.mode);
                }}
              >
                Resume {r.mode === 'practice' ? 'guided practice' : 'assessment'}
              </button>
            ))}
        </Panel>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {mode === 'explore' &&
            definition.blocks.map((block) => (
              <Panel key={block.id}>
                <p className="text-xs text-ink-dim">{block.kind}</p>
                <h2 className="text-xl font-medium">{block.title}</h2>
                <p className="whitespace-pre-wrap leading-relaxed">{block.text}</p>
              </Panel>
            ))}
          <Visual
            activity={definition}
            visualUrl={`${API_PUBLIC_BASE}/learning/activities/${id}/visual`}
            selected={selected}
            onSelect={select}
            exploded={exploded}
            isolated={isolated}
            onMeshCount={setMeshCount}
          />
          <div className="flex flex-wrap gap-2" aria-label="Components">
            {definition.targets.map((t) => (
              <button
                key={t.id}
                className={action}
                disabled={busy}
                aria-pressed={selected === t.id}
                onClick={() => select(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {canOperate && (
            <div className="flex flex-wrap gap-2">
              {(['explode', 'isolate', 'assemble'] as const).map((op) => (
                <button
                  className={action}
                  key={op}
                  disabled={busy || (op === 'isolate' && !selected)}
                  onClick={() => {
                    if (step?.kind === 'operate' && mode !== 'explore')
                      void send({
                        kind: 'operate',
                        operation: op,
                        targetId: selected ?? undefined,
                      });
                    else {
                      setExploded(op === 'explode');
                      setIsolated(op === 'isolate' ? selected : null);
                    }
                  }}
                >
                  {op === 'explode'
                    ? 'Separate parts'
                    : op === 'isolate'
                      ? 'Isolate selected'
                      : 'Restore arrangement'}
                </button>
              ))}
            </div>
          )}
          {!canOperate && definition.scene.kind === 'model' && (
            <p className="text-sm text-ink-dim">
              Component operations appear only when separate meshes are available.
            </p>
          )}
          {run && (
            <Panel>
              <div className="flex justify-between gap-4">
                <h2 className="text-xl font-semibold">
                  {run.status === 'active' ? step?.title : 'Activity completed'}
                </h2>
                <span className="text-sm text-ink-dim" role="status">
                  {busy ? 'Saving…' : `Saved · ${run.state.stepIndex}/${run.totalSteps}`}
                </span>
              </div>
              <progress
                className="w-full"
                max={run.totalSteps}
                value={run.state.stepIndex}
                aria-label="Completed tasks"
              />
              {step && <p className="leading-relaxed">{step.instruction}</p>}
              {step?.kind === 'identify' && (
                <p>Select a component in the visual or the component list.</p>
              )}
              {step?.kind === 'operate' && <p>Use the component operations above.</p>}
              {step?.kind === 'choice' && (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send({ kind: 'answer', ids: choice });
                  }}
                >
                  {step.choices.map((c) => (
                    <label
                      key={c.id}
                      className="flex min-h-11 items-center gap-3 rounded-lg border border-hairline px-3"
                    >
                      <input
                        type="checkbox"
                        checked={choice.includes(c.id)}
                        onChange={(e) =>
                          setChoice((v) =>
                            e.target.checked ? [...v, c.id] : v.filter((x) => x !== c.id),
                          )
                        }
                      />
                      {c.label}
                    </label>
                  ))}
                  <button className={action} disabled={busy || !choice.length}>
                    Check answer
                  </button>
                </form>
              )}
              {step?.kind === 'order' && (
                <div className="space-y-3">
                  <ol className="space-y-2">
                    {order.map((item, i) => (
                      <li key={item} className="flex items-center gap-2">
                        <span className="flex-1">
                          {i + 1}. {step.items.find((x) => x.id === item)?.label}
                        </span>
                        {[-1, 1].map((delta) => (
                          <button
                            key={delta}
                            className={action}
                            aria-label={`Move ${step.items.find((x) => x.id === item)?.label} ${delta < 0 ? 'up' : 'down'}`}
                            disabled={busy || i + delta < 0 || i + delta >= order.length}
                            onClick={() =>
                              setOrder((v) => {
                                const copy = [...v];
                                [copy[i], copy[i + delta]] = [copy[i + delta]!, copy[i]!];
                                return copy;
                              })
                            }
                          >
                            {delta < 0 ? '↑' : '↓'}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ol>
                  <button
                    className={action}
                    disabled={busy}
                    onClick={() => send({ kind: 'order', ids: order })}
                  >
                    Check sequence
                  </button>
                </div>
              )}
              {step?.kind === 'match' && (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send({ kind: 'match', pairs });
                  }}
                >
                  {step.left.map((item) => (
                    <label key={item.id} className="grid gap-2">
                      {item.label}
                      <select
                        className={control}
                        required
                        value={pairs[item.id] ?? ''}
                        onChange={(e) => setPairs((v) => ({ ...v, [item.id]: e.target.value }))}
                      >
                        <option value="">Choose a match</option>
                        {step.right.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <button className={action} disabled={busy}>
                    Check matches
                  </button>
                </form>
              )}
              {step?.kind === 'reflection' && (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send({ kind: 'reflect', text });
                  }}
                >
                  <label className="grid gap-2">
                    Your explanation
                    <textarea
                      className={control}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      minLength={3}
                      maxLength={3000}
                      required
                    />
                  </label>
                  <p className="text-sm text-ink-dim">
                    This reflection is saved without an automatic grade.
                  </p>
                  <button className={action} disabled={busy}>
                    Save reflection
                  </button>
                </form>
              )}
              {run.state.feedback && <Notice>{run.state.feedback}</Notice>}
              {run.status !== 'active' && (
                <>
                  <p>
                    {run.mode === 'assessment'
                      ? `${run.passed ? 'Passed' : 'Needs revision'} · ${run.score}%`
                      : 'Guided practice complete. Review your sources or try another activity.'}
                  </p>
                  <button className={action} onClick={() => start(run.mode, true)}>
                    Practise again
                  </button>
                  <Link className="ml-4 underline" href="/console/learn">
                    Continue learning
                  </Link>
                </>
              )}
            </Panel>
          )}
        </div>
        <aside className="space-y-5">
          <Panel>
            <h2 className="font-semibold">Learning outcomes</h2>
            <ul className="list-inside list-disc space-y-2 text-sm">
              {definition.objectives.map((o) => (
                <li key={o.id}>{o.label}</li>
              ))}
            </ul>
          </Panel>
          {target && (
            <Panel>
              <h2 className="text-xl font-medium">{target.label}</h2>
              {!assessment && <p className="leading-relaxed">{target.explanation}</p>}
              {!assessment &&
                target.sourceRefs.map((ref) => {
                  const source = a.sources.find((s) => s.id === ref.sourceId),
                    passage = source?.passages.find((p) => p.id === ref.passageId);
                  return (
                    <details key={ref.sourceId + ref.passageId}>
                      <summary className="cursor-pointer py-2 text-sm underline">
                        Show source · {source?.title} · p.{passage?.page}
                      </summary>
                      <p className="text-sm leading-relaxed">
                        {passage?.text ?? 'Source excerpt unavailable; contact the author.'}
                      </p>
                    </details>
                  );
                })}
            </Panel>
          )}
          {!assessment && (
            <Panel>
              <h2 className="font-semibold">Study assistant</h2>
              <p className="text-sm text-ink-dim">
                Grounded in this activity. Source lookup remains available when AI is offline.
              </p>
              <div className="grid gap-2">
                {['Give me a hint', 'Explain this component', 'Explain my mistake'].map((q) => (
                  <button className={action} key={q} disabled={busy} onClick={() => coach(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void coach(String(form.get('question')));
                }}
              >
                <label className="grid gap-2">
                  Ask about this activity
                  <input
                    className={control}
                    name="question"
                    required
                    minLength={2}
                    maxLength={1500}
                  />
                </label>
                <button className={action} disabled={busy}>
                  Ask
                </button>
              </form>
              {answer && <Notice>{answer}</Notice>}
            </Panel>
          )}
        </aside>
      </div>
    </LearningLayout>
  );
}
