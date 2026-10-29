'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExperienceHotspot, ExperienceState } from '@void-space/types';
import { apiFetch, ApiRequestError } from '../lib/api';
import { ModelStage } from './model-stage';
import { Button } from './ui/button';
import { ErrorNote, LoadingBlock } from './ui/feedback';

interface Task {
  id: string;
  title: string;
  instruction: string;
  kind: 'identify' | 'decision' | 'operate';
  operation?: 'explode' | 'assemble' | 'isolate';
  hintTargetId?: string;
  choices?: { id: string; label: string }[];
}
interface Run {
  id: string;
  mode: 'practice' | 'assessment';
  status: string;
  revision: number;
  state: ExperienceState;
  currentStep: Task | null;
  totalSteps: number;
  score: number;
  passed: boolean;
  passingScore: number;
  attemptId: string | null;
  hotspots: ExperienceHotspot[];
  media: { versionId: string; cid: string; format: string; name: string; polycount: number | null };
}
interface Event {
  id: string;
  sequence: number;
  stepId: string;
  at: string;
  action: { kind: string; targetId?: string; choiceId?: string; operation?: string };
  outcome: { correct: boolean; feedback: string; state: ExperienceState; score: number };
}
export function ExperiencePlayer({
  scenarioId,
  title,
  close,
}: {
  scenarioId: string;
  title: string;
  close: () => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [mode, setMode] = useState<'practice' | 'assessment'>('practice');
  const [ready, setReady] = useState(false);
  const [parts, setParts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const pending = useRef<Record<string, unknown> | null>(null);
  const history = useQuery({
    queryKey: ['experience-history', scenarioId],
    queryFn: () => apiFetch<{ runs: Run[] }>(`/simulations/${scenarioId}/runs`),
  });
  const replay = useQuery({
    queryKey: ['experience-replay', run?.id, run?.revision],
    queryFn: () => apiFetch<{ run: Run; events: Event[] }>(`/experience-runs/${run!.id}/replay`),
    enabled: Boolean(run) && replaying,
  });
  useEffect(() => {
    if (run) {
      setExploded(run.state.scene.exploded);
      setIsolated(run.state.scene.isolatedTargetId);
    }
  }, [run?.revision, run?.id]);
  async function start(restart = false, chosen = mode) {
    setBusy(true);
    setError(null);
    pending.current = null;
    try {
      const response = await apiFetch<{ run: Run }>(`/simulations/${scenarioId}/runs`, {
        method: 'POST',
        body: { mode: chosen, restart },
      });
      setRun(response.run);
      setMode(response.run.mode);
      setReplaying(false);
      setSelected(null);
      await history.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(action: Record<string, unknown>, retry = false) {
    if (!run || busy || replaying) return;
    const payload =
      retry && pending.current
        ? pending.current
        : { ...action, eventKey: crypto.randomUUID(), revision: run.revision };
    pending.current = payload;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ run: Run }>(`/experience-runs/${run.id}/events`, {
        method: 'POST',
        body: payload,
      });
      setRun(response.run);
      pending.current = null;
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiRequestError && e.status === 409) {
        try {
          const current = await apiFetch<{ run: Run }>(`/experience-runs/${run.id}`);
          setRun(current.run);
          pending.current = null;
        } catch (recovery) {
          setError((recovery as Error).message);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  function pick(id: string) {
    setSelected(id);
    if (run?.currentStep?.kind === 'identify') void send({ kind: 'select_target', targetId: id });
  }
  function operate(operation: 'explode' | 'assemble' | 'isolate') {
    if (run?.currentStep?.kind === 'operate') {
      void send({
        kind: 'operate',
        operation,
        ...(operation === 'isolate' && selected ? { targetId: selected } : {}),
      });
      return;
    }
    if (operation === 'explode') setExploded(true);
    if (operation === 'assemble') {
      setExploded(false);
      setIsolated(null);
    }
    if (operation === 'isolate') setIsolated(selected);
  }
  const task = run?.currentStep;
  const recorded = replaying && frame > 0 ? replay.data?.events[frame - 1] : null;
  const scene = replaying
    ? (recorded?.outcome.state.scene ?? { exploded: false, isolatedTargetId: null })
    : { exploded, isolatedTargetId: isolated };
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <button onClick={close} className="mb-3 text-xs text-ink-dim hover:text-ink">
            ← Learning experiences
          </button>
          <p className="eyebrow">SPATIAL PRACTICE</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        </div>
        <div className="flex gap-2">
          {run ? (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setReplaying(!replaying);
                  setFrame(0);
                }}
              >
                {replaying ? 'Back to run' : 'Replay actions'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => start(true)}>
                Restart {mode}
              </Button>
            </>
          ) : null}
        </div>
      </header>
      {error ? (
        <div className="space-y-2">
          <ErrorNote message={error} />
          {pending.current ? (
            <Button disabled={busy} onClick={() => send({}, true)}>
              Retry sending action
            </Button>
          ) : null}
        </div>
      ) : null}
      {!run ? (
        <div className="grid gap-8 py-8 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="text-4xl font-semibold leading-tight text-ink">
              Explore the object.
              <br />
              Make the decision.
              <br />
              See the outcome.
            </p>
            <p className="mt-5 max-w-xl text-ink-dim">
              Work through tasks in a real 3D scene. Scene selections and decisions move the
              experience forward. Your place is saved after every action.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button disabled={busy} onClick={() => start(false, 'practice')}>
                Start guided practice
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => start(false, 'assessment')}>
                Begin assessment
              </Button>
            </div>
          </div>
          <div className="space-y-3 border-l border-hairline pl-6">
            <p className="eyebrow">YOUR RECENT RUNS</p>
            {history.isLoading ? <LoadingBlock label="LOADING PROGRESS" /> : null}
            {history.data?.runs.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border-b border-hairline py-3"
              >
                <div>
                  <p className="text-sm text-ink">
                    {item.mode === 'practice' ? 'Guided practice' : 'Assessment'} · {item.status}
                  </p>
                  <p className="mt-1 text-xs text-ink-dim">
                    {item.state.stepIndex}/{item.totalSteps} tasks · {item.score}%
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRun(item);
                    setMode(item.mode);
                    setReady(false);
                    setReplaying(item.status !== 'active');
                    setFrame(0);
                  }}
                >
                  {item.status === 'active' ? 'Resume' : 'Review'}
                </Button>
              </div>
            ))}
            {history.data?.runs.length === 0 ? (
              <p className="text-sm text-ink-dim">No attempts yet. Start with guided practice.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-dim">
            <span className="font-mono uppercase text-brand">
              {replaying
                ? 'ACTION REPLAY'
                : run.mode === 'practice'
                  ? 'GUIDED PRACTICE'
                  : 'ASSESSMENT'}
            </span>
            <span>
              {run.state.stepIndex} / {run.totalSteps} tasks complete · {run.state.mistakes}{' '}
              correction{run.state.mistakes === 1 ? '' : 's'}
            </span>
          </div>
          <div className="grid min-h-[560px] overflow-hidden rounded-card border border-hairline bg-surface lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="relative min-w-0">
              <ModelStage
                key={run.media.versionId}
                cid={run.media.cid}
                format={run.media.format}
                name={run.media.name}
                polycount={run.media.polycount}
                presentation
                onReady={() => setReady(true)}
                onGeometryDecoded={(decoded) => setParts(decoded.meshes)}
                className="!h-[min(66dvh,720px)] !min-h-[480px] !max-h-none"
                interaction={{
                  hotspots: run.hotspots,
                  showLabels: run.mode === 'practice' && !replaying,
                  selectedId:
                    recorded?.action.targetId ??
                    selected ??
                    (run.mode === 'practice' ? task?.hintTargetId : null),
                  disabled: busy || !ready || replaying || run.status !== 'active',
                  onSelect: pick,
                  exploded: scene.exploded,
                  isolatedId: scene.isolatedTargetId,
                }}
              />
              <div
                className="absolute left-4 top-4 max-w-[80%] rounded-control border border-white/15 bg-black/80 px-3 py-2 text-xs text-white"
                role="status"
              >
                {ready
                  ? `${run.media.name} · interactive scene`
                  : 'Loading and framing the reviewed model…'}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-3">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!ready || busy || replaying || parts < 2}
                  onClick={() => operate('explode')}
                >
                  Explode model
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!ready || busy || replaying || !selected}
                  onClick={() => operate('isolate')}
                >
                  Isolate selected
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!ready || busy || replaying}
                  onClick={() => operate('assemble')}
                >
                  Reassemble / show all
                </Button>
              </div>
            </div>
            <aside className="flex flex-col border-t border-hairline lg:border-l lg:border-t-0">
              <div className="h-1 bg-veil-8">
                <div
                  className="h-full bg-brand transition-[width]"
                  style={{ width: `${(run.state.stepIndex / run.totalSteps) * 100}%` }}
                />
              </div>
              <div className="flex-1 space-y-5 p-6">
                {replaying ? (
                  <>
                    <p className="eyebrow">
                      {frame === 0
                        ? 'INITIAL SCENE'
                        : `ACTION ${frame} / ${replay.data?.events.length ?? 0}`}
                    </p>
                    <h2 className="text-2xl text-ink">Review your decisions</h2>
                    {replay.isLoading ? <LoadingBlock label="LOADING ACTION HISTORY" /> : null}
                    <p className="text-sm text-ink-dim">
                      {recorded?.outcome.feedback ??
                        'Drag the timeline to replay recorded scene interactions and their consequences.'}
                    </p>
                    {replay.error ? <ErrorNote message={(replay.error as Error).message} /> : null}
                    <label className="block space-y-3 text-sm text-ink">
                      <span>Replay position</span>
                      <input
                        className="w-full accent-orange-500"
                        aria-label="Replay position"
                        disabled={!replay.data}
                        type="range"
                        min={0}
                        max={replay.data?.events.length ?? 0}
                        value={frame}
                        onChange={(e) => setFrame(Number(e.target.value))}
                      />
                    </label>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={frame === 0} onClick={() => setFrame(frame - 1)}>
                        Previous action
                      </Button>
                      <Button
                        size="sm"
                        disabled={frame === (replay.data?.events.length ?? 0)}
                        onClick={() => setFrame(frame + 1)}
                      >
                        Next action
                      </Button>
                    </div>
                    <ol className="space-y-2">
                      {replay.data?.events.map((event, index) => (
                        <li key={event.id}>
                          <button
                            className={`w-full border-l-2 px-3 py-2 text-left text-xs ${frame === index + 1 ? 'border-brand text-ink' : 'border-hairline text-ink-dim'}`}
                            onClick={() => setFrame(index + 1)}
                          >
                            {index + 1}.{' '}
                            {event.action.kind === 'operate'
                              ? event.action.operation
                              : event.action.kind === 'select_target'
                                ? 'Select scene target'
                                : 'Make decision'}{' '}
                            · {event.outcome.correct ? 'accepted' : 'correction'}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : task ? (
                  <>
                    <p className="eyebrow">
                      TASK {run.state.stepIndex + 1} OF {run.totalSteps} ·{' '}
                      {task.kind === 'identify'
                        ? 'LOCATE'
                        : task.kind === 'operate'
                          ? 'OPERATE'
                          : 'DECIDE'}
                    </p>
                    <h2 className="text-2xl font-medium leading-tight text-ink">{task.title}</h2>
                    <p className="text-sm leading-relaxed text-ink-dim">{task.instruction}</p>
                    {task.kind === 'identify' ? (
                      <p className="border-l-2 border-brand pl-3 text-xs leading-relaxed text-ink-dim">
                        Select a numbered target attached to the 3D object. Drag to orbit and scroll
                        to inspect it from another angle.
                      </p>
                    ) : task.kind === 'operate' ? (
                      <p className="border-l-2 border-brand pl-3 text-xs text-ink-dim">
                        Use the scene controls beneath the model.
                        {task.operation === 'isolate' ? ' Select a component first.' : ''}
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {task.choices?.map((choice) => (
                          <button
                            key={choice.id}
                            disabled={busy || !ready || Boolean(pending.current)}
                            onClick={() => send({ kind: 'choose', choiceId: choice.id })}
                            className="block w-full rounded-control border border-hairline-strong px-4 py-4 text-left text-sm text-ink transition-colors hover:border-brand hover:bg-veil-6 disabled:opacity-40"
                          >
                            {choice.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {run.state.feedback ? (
                      <div className="border-t border-hairline pt-4" role="status">
                        <p className="mb-2 text-xs font-semibold text-brand">CONSEQUENCE</p>
                        <p className="text-sm leading-relaxed text-ink-dim">{run.state.feedback}</p>
                      </div>
                    ) : null}
                    {busy ? <p className="text-xs text-ink-dim">Recording your action…</p> : null}
                  </>
                ) : (
                  <>
                    <p className="eyebrow">
                      {run.mode === 'practice'
                        ? 'PRACTICE COMPLETE'
                        : run.passed
                          ? 'ASSESSMENT PASSED'
                          : 'ATTEMPT FINISHED'}
                    </p>
                    <h2 className="text-4xl font-semibold text-ink">{run.score}%</h2>
                    <p className="text-sm text-ink-dim">{run.state.feedback}</p>
                    <p className="text-xs text-ink-dim">
                      {run.mode === 'practice'
                        ? 'Practice is for learning. It does not issue passing assessment evidence.'
                        : `Passing threshold: ${run.passingScore}%. The result was calculated from your recorded actions.`}
                    </p>
                    <Button
                      onClick={() => {
                        setReplaying(true);
                        setFrame(0);
                      }}
                    >
                      Review action replay
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => start(true, 'assessment')}
                    >
                      Try another assessment
                    </Button>
                  </>
                )}
              </div>
              <div className="border-t border-hairline p-4 text-xs text-ink-faint">
                {run.revision} recorded actions · saved after each interaction
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
