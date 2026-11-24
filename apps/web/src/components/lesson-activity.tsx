'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { advanceLearningActivity, initialLessonActivityState } from '@void-space/types';
import type { ExperienceState, LearningAction, LearningActivity } from '@void-space/types';
import { action, control, Notice } from './learning-ui';
const Visual = dynamic(() => import('./learning-visual'), {
  ssr: false,
  loading: () => <p role="status">Loading interactive visual…</p>,
});
export type LessonAction = Omit<LearningAction, 'eventKey' | 'revision'>;
export function LessonActivity({
  activity,
  state: persistedState,
  onAction,
  busy = false,
  visualUrl,
  onAsk,
  preview = false,
  exploreOnly = false,
}: {
  activity: LearningActivity;
  state: ExperienceState;
  onAction: (a: LessonAction) => void;
  busy?: boolean;
  visualUrl?: string;
  onAsk?: (id: string) => void;
  preview?: boolean;
  exploreOnly?: boolean;
}) {
  const [previewState, setPreviewState] = useState<ExperienceState>(initialLessonActivityState),
    [previewError, setPreviewError] = useState('');
  const state = preview ? previewState : persistedState;
  const [selected, setSelected] = useState<string | null>(null),
    [ids, setIds] = useState<string[]>([]),
    [pairs, setPairs] = useState<Record<string, string>>({}),
    [order, setOrder] = useState<string[]>([]),
    [text, setText] = useState(''),
    [meshCount, setMeshCount] = useState<number | null>(
      activity.scene.kind === 'model' && activity.scene.builtin ? 3 : null,
    );
  const step = activity.steps[state.stepIndex],
    target = activity.targets.find((t) => t.id === selected);
  const arranged =
    step?.kind === 'order'
      ? order.length === step.items.length
        ? order
        : [...step.items].sort((a, b) => a.id.localeCompare(b.id)).map((x) => x.id)
      : [];
  const send = (a: LessonAction) => {
    if (preview) {
      try {
        setPreviewState(
          advanceLearningActivity(
            activity,
            previewState,
            { ...a, eventKey: crypto.randomUUID(), revision: 0 },
            'practice',
          ).state,
        );
        setPreviewError('');
      } catch (e) {
        setPreviewError((e as Error).message);
      }
    } else onAction(a);
    setIds([]);
    setPairs({});
    setOrder([]);
    setText('');
  };
  return (
    <div className="space-y-4">
      {activity.scene.kind !== 'none' && (
        <Visual
          activity={activity}
          selected={selected}
          onSelect={setSelected}
          exploded={state.scene.exploded}
          isolated={state.scene.isolatedTargetId}
          onMeshCount={setMeshCount}
          visualUrl={visualUrl}
        />
      )}
      {!!activity.targets.length && (
        <div className="flex flex-wrap gap-2" aria-label="Components">
          {activity.targets.map((t) => (
            <button
              type="button"
              key={t.id}
              className={action}
              aria-pressed={selected === t.id}
              onClick={() => setSelected(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {target && (
        <aside className="rounded-lg bg-veil-6 p-4">
          <h3 className="font-semibold">{target.label}</h3>
          <p className="mt-2 leading-relaxed">{target.explanation}</p>
          {onAsk && (
            <button className={action + ' mt-3'} onClick={() => onAsk(target.id)}>
              Ask AI about this component
            </button>
          )}
        </aside>
      )}
      {preview && <Notice>Preview only. This does not save student progress.</Notice>}
      {previewError && <Notice error>{previewError}</Notice>}
      {step && !exploreOnly && (
        <fieldset disabled={busy} className="space-y-3">
          <legend className="text-lg font-semibold">{step.title}</legend>
          <p>{step.instruction}</p>
          {step.kind === 'choice' &&
            step.choices.map((c) => (
              <label
                key={c.id}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-hairline p-3"
              >
                <input
                  type="checkbox"
                  checked={ids.includes(c.id)}
                  onChange={() =>
                    setIds((v) => (v.includes(c.id) ? v.filter((x) => x !== c.id) : [...v, c.id]))
                  }
                />
                {c.label}
              </label>
            ))}
          {step.kind === 'choice' && (
            <button
              className={action}
              disabled={!ids.length}
              onClick={() => send({ kind: 'answer', ids })}
            >
              Check answer
            </button>
          )}
          {step.kind === 'identify' && (
            <button
              className={action}
              disabled={!selected}
              onClick={() => send({ kind: 'select_target', targetId: selected! })}
            >
              Check selected component
            </button>
          )}
          {step.kind === 'operate' && (
            <div className="space-y-2">
              <p className="text-sm text-ink-dim">
                Separate-part operations are available only for models with confirmed component
                meshes.
              </p>
              <button
                className={action}
                disabled={
                  step.operation !== 'assemble' &&
                  (meshCount === null || meshCount < 2 || !selected)
                }
                onClick={() =>
                  send({
                    kind: 'operate',
                    operation: step.operation,
                    ...(selected ? { targetId: selected } : {}),
                  })
                }
              >
                {step.operation === 'assemble'
                  ? 'Restore arrangement'
                  : step.operation === 'isolate'
                    ? 'Isolate selected component'
                    : 'Separate components'}
              </button>
            </div>
          )}
          {step.kind === 'match' && (
            <>
              {step.left.map((l) => (
                <label key={l.id} className="grid gap-2 sm:grid-cols-2">
                  <span>{l.label}</span>
                  <select
                    aria-label={l.label}
                    className={control}
                    value={pairs[l.id] ?? ''}
                    onChange={(e) => setPairs({ ...pairs, [l.id]: e.target.value })}
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
              <button
                className={action}
                disabled={step.left.some((l) => !pairs[l.id])}
                onClick={() => send({ kind: 'match', pairs })}
              >
                Check matches
              </button>
            </>
          )}
          {step.kind === 'order' && (
            <>
              <ol className="space-y-2">
                {arranged.map((id, i) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-lg border border-hairline p-2"
                  >
                    <span className="min-w-0 flex-1">
                      {step.items.find((x) => x.id === id)?.label}
                    </span>
                    {[-1, 1].map((delta) => (
                      <button
                        key={delta}
                        aria-label={`${delta < 0 ? 'Move up' : 'Move down'} ${step.items.find((x) => x.id === id)?.label}`}
                        className={action}
                        disabled={i + delta < 0 || i + delta >= arranged.length}
                        onClick={() => {
                          const next = [...arranged];
                          [next[i], next[i + delta]] = [next[i + delta]!, next[i]!];
                          setOrder(next);
                        }}
                      >
                        {delta < 0 ? '↑' : '↓'}
                      </button>
                    ))}
                  </li>
                ))}
              </ol>
              <button className={action} onClick={() => send({ kind: 'order', ids: arranged })}>
                Check sequence
              </button>
            </>
          )}
          {step.kind === 'reflection' && (
            <>
              <label className="grid gap-2">
                Your explanation
                <textarea
                  className={control}
                  maxLength={3000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <p className="text-sm text-ink-dim">
                A private formative reflection; no official grade.
              </p>
              <button
                className={action}
                disabled={text.trim().length < 3}
                onClick={() => send({ kind: 'reflect', text })}
              >
                Save reflection
              </button>
            </>
          )}
        </fieldset>
      )}
      {state.status === 'completed' && (
        <Notice>
          Activity complete.{' '}
          {state.mistakes
            ? `You revisited ${state.mistakes} incorrect interactions.`
            : 'All interactions completed.'}
        </Notice>
      )}
      {state.feedback && <Notice>{state.feedback}</Notice>}
    </div>
  );
}
