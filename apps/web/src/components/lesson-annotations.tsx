'use client';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { Plus, MapPin, Sparkles, Check, Trash2 } from 'lucide-react';
import type { LearningActivity, LearningTarget } from '@void-space/types';
import type { CaptureLearningViews, LearningModelView } from '../lib/model-learning-views';
import { action, control, Notice } from './learning-ui';
const Visual = dynamic(() => import('./learning-visual'), {
  ssr: false,
  loading: () => <p role="status">Loading lesson model…</p>,
});
export function LessonAnnotations({
  activity,
  onChange,
  onSuggest,
  busy,
}: {
  activity: LearningActivity;
  onChange: (a: LearningActivity) => void;
  onSuggest: (views?: LearningModelView[], instruction?: string) => Promise<void>;
  busy: boolean;
}) {
  const [selected, setSelected] = useState(activity.targets[0]?.id ?? ''),
    [placing, setPlacing] = useState(false),
    [error, setError] = useState(''),
    [capturing, setCapturing] = useState(false),
    [parts, setParts] = useState<{ key: string; name: string }[]>([]),
    [instruction, setInstruction] = useState(''),
    [previousPin, setPreviousPin] = useState<LearningTarget | null>(null);
  const builtin = activity.scene.kind === 'model' && !!activity.scene.builtin;
  const capture = useRef<CaptureLearningViews | null>(null);
  const target = activity.targets.find((t) => t.id === selected) ?? activity.targets[0];
  const update = (next: LearningTarget) =>
    onChange({
      ...activity,
      reviewed: false,
      targets: activity.targets.map((t) => (t.id === next.id ? next : t)),
    });
  return (
    <section className="lesson-annotation-workspace" aria-label="Lesson model annotations">
      <header>
        <div>
          <h2>Model annotations</h2>
          <p>Explain each component and place its pin. These changes belong to this lesson.</p>
        </div>
        <button
          className={action}
          disabled={busy || capturing || builtin}
          onClick={async () => {
            setCapturing(true);
            setError('');
            try {
              const views = capture.current ? await capture.current() : undefined;
              await onSuggest(views, instruction.trim());
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setCapturing(false);
            }
          }}
        >
          <Sparkles size={16} />
          {capturing ? 'Preparing model views…' : 'Suggest annotations with AI'}
        </button>
      </header>
      {!builtin && (
        <details className="annotation-ai-brief">
          <summary>Guide the AI annotations</summary>
          <label className="grid gap-2 mt-3">
            What should the annotations explain?
            <textarea
              className={control}
              maxLength={1000}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Explain each visible heart structure, where it sits, its function and how it connects to neighbouring structures."
            />
          </label>
          <p>
            Suggestions remain drafts. Check the source evidence and exact pin position before
            confirming.
          </p>
        </details>
      )}
      {builtin && (
        <p className="text-sm text-ink-dim mb-4">
          This example has fixed components. Edit their explanations here; import a model to add
          surface pins and use visual AI annotations.
        </p>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="lesson-annotation-grid">
        <div className="min-w-0">
          <Visual
            activity={activity}
            onPartsReady={setParts}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setPlacing(false);
            }}
            exploded={false}
            isolated={null}
            onCaptureReady={(fn) => {
              capture.current = fn;
            }}
            {...(placing && target
              ? {
                  onSurfacePick: (position: [number, number, number], meshKey: string) => {
                    setPreviousPin(target);
                    update({ ...target, position, meshKey, placement: 'suggested' });
                    setPlacing(false);
                  },
                }
              : {})}
          />
          <p className="learning-pick-hint" role="status">
            {placing
              ? 'Click a surface on the model to place this component pin.'
              : 'Drag to orbit · scroll to zoom · select a component below. Unplaced components have no pin on the model.'}
          </p>
          <div className="flex flex-wrap gap-2" aria-label="Lesson components">
            {activity.targets.map((t) => (
              <button
                className="learning-component"
                key={t.id}
                aria-pressed={selected === t.id}
                onClick={() => {
                  setSelected(t.id);
                  setPlacing(false);
                }}
              >
                {t.label}
                <span>
                  {t.placement === 'unplaced'
                    ? 'Place pin'
                    : t.placement === 'suggested'
                      ? 'Review pin'
                      : 'Confirmed'}
                </span>
              </button>
            ))}
          </div>
          <button
            className={action + ' mt-4'}
            disabled={busy || builtin || activity.targets.length >= 40}
            onClick={() => {
              const id = `component_${crypto.randomUUID().slice(0, 8)}`;
              onChange({
                ...activity,
                reviewed: false,
                targets: [
                  ...activity.targets,
                  {
                    id,
                    label: 'New component',
                    explanation: '',
                    position: [0, 0, 0],
                    ...(parts.length === 1 ? { meshKey: parts[0]!.key } : {}),
                    placement: 'unplaced',
                    sourceRefs: [],
                  },
                ],
              });
              setSelected(id);
              setPlacing(false);
            }}
          >
            <Plus size={16} />
            Add component
          </button>
        </div>
        <aside aria-label="Annotation details" className="space-y-4">
          {target ? (
            <>
              <label className="grid gap-2">
                Component name
                <input
                  aria-label="Component name"
                  className={control}
                  value={target.label}
                  maxLength={100}
                  onChange={(e) => update({ ...target, label: e.target.value })}
                />
              </label>
              <label className="grid gap-2">
                Explanation and role
                <textarea
                  aria-label="Explanation and role"
                  className={control + ' min-h-36'}
                  value={target.explanation}
                  placeholder="Location: where this structure is found.\nFunction: what it does.\nConnections: how it relates to nearby structures.\nWhy it matters: a reviewed example or common misconception."
                  maxLength={2000}
                  onChange={(e) => update({ ...target, explanation: e.target.value })}
                />
              </label>
              <p className="text-sm text-ink-dim">
                {target.placement === 'unplaced'
                  ? 'AI has not located this component. Place its pin on the model.'
                  : target.placement === 'suggested'
                    ? 'Proposed location. Check the identity and position before confirming.'
                    : 'Review the explanation and source material before sharing.'}
              </p>
              {!builtin && (
                <div className="annotation-location-summary">
                  <h3>Pin location</h3>
                  <p>
                    {target.placement === 'unplaced'
                      ? 'Not placed yet'
                      : target.placement === 'confirmed'
                        ? 'Confirmed by author'
                        : 'Proposed · needs review'}
                  </p>
                  <label className="grid gap-2">
                    Model part
                    <select
                      className={control}
                      disabled={busy || !parts.length}
                      value={target.meshKey ?? ''}
                      onChange={(e) =>
                        update({
                          ...target,
                          meshKey: e.target.value || undefined,
                          placement: 'suggested',
                        })
                      }
                    >
                      <option value="">Select the actual model part</option>
                      {parts.map((part) => (
                        <option key={part.key} value={part.key}>
                          {part.name} · {part.key}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Pin coordinates are relative to this model, not physical measurements. Surface
                    placement selects the exact part automatically.
                  </p>
                  {previousPin?.id === target.id && (
                    <button
                      className={action}
                      onClick={() => {
                        update({
                          ...target,
                          position: previousPin.position,
                          meshKey: previousPin.meshKey,
                          placement: previousPin.placement,
                        });
                        setPreviousPin(null);
                      }}
                    >
                      Undo last pin placement
                    </button>
                  )}
                </div>
              )}
              {!builtin && (
                <details>
                  <summary className="cursor-pointer py-2 text-sm">
                    Adjust pin with keyboard
                  </summary>
                  {[0, 1, 2].map((axis) => (
                    <label key={axis} className="grid gap-1 mt-2 text-sm">
                      {['Horizontal', 'Vertical', 'Depth'][axis]} position
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.02}
                        disabled={busy || !target.meshKey}
                        value={target.position[axis]}
                        onChange={(e) => {
                          const position = [...target.position] as [number, number, number];
                          position[axis] = Number(e.target.value);
                          update({ ...target, position, placement: 'suggested' });
                        }}
                      />
                    </label>
                  ))}
                  <div className="annotation-coordinates">
                    {(['X', 'Y', 'Z'] as const).map((label, axis) => (
                      <label key={label}>
                        {label}
                        <input
                          className={control}
                          aria-label={`Pin ${label} coordinate`}
                          type="number"
                          min={-1}
                          max={1}
                          step={0.001}
                          disabled={busy || !target.meshKey}
                          value={Number(target.position[axis]!.toFixed(4))}
                          onChange={(e) => {
                            const value = e.currentTarget.valueAsNumber;
                            if (!Number.isFinite(value) || value < -1 || value > 1) return;
                            const position = [...target.position] as [number, number, number];
                            position[axis] = value;
                            update({ ...target, position, placement: 'suggested' });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-ink-dim">
                    Check the visual position before confirming. Use surface placement for a point
                    on the model.
                  </p>
                </details>
              )}
              <button
                className={action}
                aria-pressed={placing}
                disabled={busy || builtin}
                onClick={() => setPlacing(!placing)}
              >
                <MapPin size={16} />
                {placing ? 'Cancel placement' : 'Place pin on model'}
              </button>
              <button
                className={action}
                disabled={
                  busy ||
                  target.placement === 'unplaced' ||
                  (!builtin && !parts.some((part) => part.key === target.meshKey)) ||
                  target.label.trim().length < 2 ||
                  target.explanation.trim().length < 10
                }
                onClick={() => update({ ...target, placement: 'confirmed' })}
              >
                <Check size={16} />
                Confirm component and pin
              </button>
              <button
                className={action}
                disabled={
                  busy ||
                  builtin ||
                  activity.steps.some((s) => 'targetId' in s && s.targetId === target.id)
                }
                onClick={() => {
                  onChange({
                    ...activity,
                    reviewed: false,
                    targets: activity.targets.filter((t) => t.id !== target.id),
                  });
                  setSelected('');
                  setPlacing(false);
                }}
              >
                <Trash2 size={16} />
                Remove component
              </button>
              {target.sourceRefs.length > 0 && (
                <p className="text-sm text-ink-dim">
                  {target.sourceRefs.length} supporting source passage(s). References stay attached
                  when editing.
                </p>
              )}
            </>
          ) : (
            <>
              <MapPin size={24} />
              <h3>Select or add a component</h3>
              <p className="text-sm text-ink-dim">
                Ask AI for a first draft, or add a component and place its pin manually.
              </p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
