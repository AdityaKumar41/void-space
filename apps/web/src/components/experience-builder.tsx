'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  experienceDefinitionSchema,
  type ExperienceDefinition,
  type ExperienceStep,
  type ExperienceHotspot,
} from '@void-space/types';
import { apiFetch } from '../lib/api';
import { ModelStage } from './model-stage';
import { Button } from './ui/button';
import { ErrorNote, LoadingBlock } from './ui/feedback';
const field = 'w-full rounded-control border border-hairline bg-deeper px-3 py-2 text-sm text-ink';
interface Media {
  versionId: string;
  cid: string | null;
  format: string;
  polycount: number | null;
}
interface Source {
  id: string;
  name: string;
  category: string;
  media: Media | null;
}
interface Authored {
  id: string;
  title: string;
  description: string;
  status: string;
  definition: ExperienceDefinition;
  media: Media;
}
export function ExperienceBuilder({ id, close }: { id?: string; close: () => void }) {
  const sources = useQuery({
    queryKey: ['experience-sources'],
    queryFn: () => apiFetch<{ assets: Source[] }>('/lessons/assets'),
  });
  const existing = useQuery({
    queryKey: ['experience-author', id],
    queryFn: () => apiFetch<{ scenario: Authored }>(`/simulations/${id}/author`),
    enabled: Boolean(id),
  });
  const [assetId, setAssetId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hotspots, setHotspots] = useState<ExperienceHotspot[]>([]);
  const [steps, setSteps] = useState<ExperienceStep[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [parts, setParts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState(id);
  const [notice, setNotice] = useState('');
  const [pinned, setPinned] = useState<Media | null>(null);
  useEffect(() => {
    const scenario = existing.data?.scenario;
    if (scenario?.definition) {
      setTitle(scenario.title);
      setDescription(scenario.description);
      setAssetId(scenario.definition.assetId);
      setHotspots(scenario.definition.hotspots);
      setSteps(scenario.definition.steps);
      setPinned(scenario.media);
      setSelected(scenario.definition.hotspots[0]?.id ?? null);
    }
  }, [existing.data]);
  const source = sources.data?.assets.find((a) => a.id === assetId);
  const media = pinned ?? source?.media;
  const target = hotspots.find((h) => h.id === selected);
  const task = steps[stepIndex];
  const stale = Boolean(pinned && source?.media?.versionId !== pinned.versionId);
  const definition = { schemaVersion: 1 as const, assetId, hotspots, steps, passingScore: 80 };
  const validation = experienceDefinitionSchema.safeParse(definition);
  const editable = existing.data?.scenario.status !== 'published';
  function selectSource(next: string) {
    setAssetId(next);
    setHotspots([]);
    setSteps([]);
    setSelected(null);
    setPinned(null);
    setReady(false);
    setExploded(false);
  }
  function place(position: [number, number, number], meshKey: string) {
    if (!placing || !editable) return;
    const id = crypto.randomUUID();
    const label = `Component ${hotspots.length + 1}`;
    setHotspots((current) => [...current, { id, label, position, meshKey }]);
    setSelected(id);
    if (steps.length === 0)
      setSteps([
        {
          id: crypto.randomUUID(),
          kind: 'identify',
          targetId: id,
          title: `Locate ${label}`,
          instruction: `Find ${label} on the object and select its scene marker.`,
          explanation: `The selected surface marks ${label} on this approved object.`,
          weight: 100,
        },
      ]);
  }
  function rename(label: string) {
    if (!target) return;
    const old = target.label;
    setHotspots((items) => items.map((h) => (h.id === target.id ? { ...h, label } : h)));
    setSteps((items) =>
      items.map((s) =>
        s.kind === 'identify' && s.targetId === target.id
          ? {
              ...s,
              title: s.title.replace(old, label),
              instruction: s.instruction.replace(old, label),
              explanation: s.explanation.replace(old, label),
            }
          : s,
      ),
    );
  }
  function add(kind: ExperienceStep['kind'], operation?: 'explode' | 'assemble' | 'isolate') {
    const base = {
      id: crypto.randomUUID(),
      weight: 100,
      title: 'New learning task',
      instruction: 'Explain the observable action the learner should perform.',
      explanation: 'The learner completed the defined task on the reviewed scene.',
    };
    const next: ExperienceStep =
      kind === 'identify'
        ? { ...base, kind, targetId: selected ?? hotspots[0]!.id, title: 'Identify a component' }
        : kind === 'operate'
          ? {
              ...base,
              kind,
              operation: operation ?? 'explode',
              ...(operation === 'isolate' ? { targetId: selected ?? hotspots[0]?.id } : {}),
              title:
                operation === 'assemble'
                  ? 'Reassemble the object'
                  : operation === 'isolate'
                    ? 'Inspect one component'
                    : 'Explore the internal arrangement',
              instruction:
                operation === 'assemble'
                  ? 'Use Reassemble / show all to restore the assembled object.'
                  : operation === 'isolate'
                    ? 'Select the requested component, then isolate it for a closer inspection.'
                    : 'Use Explode model to separate the object’s mesh components and inspect their arrangement.',
            }
          : {
              ...base,
              kind,
              correctChoiceId: 'review',
              onIncorrect: 'end',
              title: 'Respond to a discrepancy',
              instruction:
                'A discrepancy is found between the object and its reviewed description. Choose the next action.',
              choices: [
                {
                  id: 'review',
                  label: 'Record it for review',
                  feedback: 'The discrepancy is recorded so the source can be reviewed.',
                },
                {
                  id: 'ignore',
                  label: 'Mark it checked without review',
                  feedback: 'The discrepancy remains unresolved. The assessment stops here.',
                },
              ],
            };
    setSteps((items) => [...items, next]);
    setStepIndex(steps.length);
  }
  function updateTask(changes: Record<string, unknown>) {
    setSteps((items) =>
      items.map((s, i) => (i === stepIndex ? ({ ...s, ...changes } as ExperienceStep) : s)),
    );
  }
  function moveTask(direction: number) {
    const next = stepIndex + direction;
    if (next < 0 || next >= steps.length) return;
    const copy = [...steps];
    [copy[stepIndex], copy[next]] = [copy[next]!, copy[stepIndex]!];
    setSteps(copy);
    setStepIndex(next);
  }
  async function save(publish = false) {
    setError(null);
    setNotice('');
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? 'Complete the scene and tasks');
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch<{ scenario: { id: string } }>(
        savedId ? `/simulations/${savedId}` : '/simulations',
        {
          method: savedId ? 'PATCH' : 'POST',
          body: { title, description, experience: validation.data },
        },
      );
      setSavedId(response.scenario.id);
      if (publish) {
        await apiFetch(`/simulations/${response.scenario.id}/publish`, { method: 'POST' });
        close();
      } else setNotice('Draft saved. It remains private until you publish it.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (sources.isLoading || (existing.isLoading && id))
    return <LoadingBlock label="LOADING SPATIAL AUTHORING" />;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <button className="text-xs text-ink-dim" onClick={close}>
            ← Learning experiences
          </button>
          <p className="eyebrow mt-3">SPATIAL AUTHORING</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">
            {editable ? 'Build an interactive experience' : 'Published experience'}
          </h1>
        </div>
        {editable ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={
                busy ||
                !source ||
                stale ||
                title.trim().length < 3 ||
                description.trim().length < 20 ||
                !validation.success
              }
              onClick={() => save()}
            >
              Save draft
            </Button>
            <Button
              disabled={
                busy ||
                !source ||
                stale ||
                title.trim().length < 3 ||
                description.trim().length < 20 ||
                !validation.success
              }
              onClick={() => save(true)}
            >
              {busy ? 'Saving…' : 'Publish experience'}
            </Button>
          </div>
        ) : null}
      </header>
      {error || sources.error || existing.error ? (
        <ErrorNote message={error ?? ((sources.error ?? existing.error) as Error).message} />
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-brand">
          {notice}
        </p>
      ) : null}
      <fieldset disabled={!editable || busy} className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <label className="space-y-2 text-xs text-ink-dim">
          <span>Experience title</span>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="space-y-2 text-xs text-ink-dim">
          <span>Approved source asset</span>
          <select
            aria-label="Approved source asset"
            className={field}
            value={assetId}
            onChange={(e) => selectSource(e.target.value)}
          >
            <option value="">Choose an approved 3D asset</option>
            {sources.data?.assets
              .filter(
                (a) =>
                  a.media?.cid &&
                  ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply'].includes(
                    a.media.format.replace(/^\./, ''),
                  ),
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="space-y-2 text-xs text-ink-dim md:col-span-2">
          <span>Learning objective and source context</span>
          <textarea
            className={`${field} min-h-16`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </fieldset>
      {stale ? (
        <div className="flex items-center gap-3 border border-hairline p-4 text-sm text-ink-dim">
          The source asset has a new approved version. Rebuild its targets before releasing.
          <Button onClick={() => selectSource(assetId)}>Use current version</Button>
        </div>
      ) : null}
      <div className="grid items-start gap-0 overflow-hidden rounded-card border border-hairline lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {media?.cid ? (
            <div className="relative">
              <ModelStage
                key={media.versionId}
                cid={media.cid}
                format={media.format}
                name={source?.name ?? title}
                polycount={media.polycount}
                presentation
                className="!h-[62dvh] !min-h-[480px] !max-h-none"
                onReady={() => setReady(true)}
                onGeometryDecoded={(decoded) => setParts(decoded.meshes)}
                interaction={{
                  hotspots,
                  selectedId: selected,
                  showLabels: true,
                  exploded,
                  onSelect: (id) => {
                    setSelected(id);
                    setPlacing(false);
                  },
                  onSurfacePick: placing ? place : undefined,
                }}
              />
              <div
                className="absolute left-4 top-4 max-w-[80%] rounded-control border border-white/15 bg-black/85 p-3 text-xs text-white"
                role="status"
              >
                {!ready
                  ? 'Loading the actual reviewed model…'
                  : placing
                    ? 'Click a surface to place a learning target. Dragging still orbits the model.'
                    : 'Select a target to edit it, or place a new target on the model.'}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[480px] items-center justify-center bg-deeper p-12 text-center text-ink-dim">
              Choose a reviewed asset to start working in the scene.
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-hairline bg-surface p-3">
            <Button
              size="sm"
              disabled={!editable || !ready || hotspots.length >= 40}
              selected={placing}
              onClick={() => setPlacing(!placing)}
            >
              {placing ? 'Done placing' : 'Place a target'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!ready}
              onClick={() => setExploded(!exploded)}
            >
              {exploded ? 'Reassemble preview' : 'Explode preview'}
            </Button>
            <span className="self-center text-xs text-ink-faint">
              {hotspots.length} scene targets · {parts} mesh parts
            </span>
          </div>
        </div>
        <aside className="space-y-5 border-t border-hairline bg-surface p-5 lg:border-l lg:border-t-0">
          <div>
            <p className="eyebrow">SCENE TARGETS</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {hotspots.map((h, i) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setSelected(h.id);
                    setPlacing(false);
                  }}
                  className={`rounded-control border px-3 py-2 text-xs ${selected === h.id ? 'border-brand text-ink' : 'border-hairline text-ink-dim'}`}
                >
                  {i + 1}. {h.label}
                </button>
              ))}
            </div>
            {!hotspots.length ? (
              <p className="mt-3 text-sm text-ink-dim">
                Place at least one target directly on the model. The target stays attached in 3D as
                the learner orbits.
              </p>
            ) : null}
          </div>
          {target ? (
            <fieldset
              disabled={!editable || busy}
              className="space-y-3 border-t border-hairline pt-4"
            >
              <label className="block space-y-2 text-xs text-ink-dim">
                <span>Selected target label</span>
                <input
                  className={field}
                  value={target.label}
                  onChange={(e) => rename(e.target.value)}
                />
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHotspots((items) => items.filter((h) => h.id !== target.id));
                  setSteps((items) =>
                    items.filter((s) => !('targetId' in s) || s.targetId !== target.id),
                  );
                  setSelected(null);
                  setStepIndex(0);
                }}
              >
                Remove target and linked tasks
              </Button>
            </fieldset>
          ) : null}
          <div className="border-t border-hairline pt-4">
            <p className="eyebrow">LEARNING SEQUENCE</p>
            <ol className="mt-3 space-y-1">
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    className={`w-full border-l-2 px-3 py-3 text-left text-sm ${i === stepIndex ? 'border-brand bg-veil-6 text-ink' : 'border-hairline text-ink-dim'}`}
                    onClick={() => setStepIndex(i)}
                  >
                    <span className="mr-2 font-mono text-xs text-ink-faint">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {s.title}
                    <span className="mt-1 block text-[10px] uppercase text-ink-faint">
                      {s.kind === 'operate' ? s.operation : s.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              {editable ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hotspots.length || steps.length >= 30}
                    onClick={() => add('identify')}
                  >
                    + Identify
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hotspots.length || steps.length >= 30 || parts < 2}
                    onClick={() => add('operate', 'explode')}
                  >
                    + Explode
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hotspots.length || steps.length >= 30}
                    onClick={() => add('operate', 'assemble')}
                  >
                    + Reassemble
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hotspots.length || steps.length >= 30 || parts < 2}
                    onClick={() => add('operate', 'isolate')}
                  >
                    + Isolate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hotspots.length || steps.length >= 30}
                    onClick={() => add('decision')}
                  >
                    + Decision
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
      {task ? (
        <fieldset disabled={!editable || busy} className="space-y-4 border-t border-hairline py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-ink">
              Task {stepIndex + 1}: {task.kind === 'operate' ? task.operation : task.kind}
            </h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={stepIndex === 0}
                onClick={() => moveTask(-1)}
              >
                Move earlier
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={stepIndex === steps.length - 1}
                onClick={() => moveTask(1)}
              >
                Move later
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSteps((items) => items.filter((_, i) => i !== stepIndex));
                  setStepIndex(Math.max(0, stepIndex - 1));
                }}
              >
                Remove task
              </Button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-ink">
              <span>Task title</span>
              <input
                className={field}
                value={task.title}
                onChange={(e) => updateTask({ title: e.target.value })}
              />
            </label>
            {task.kind === 'identify' ||
            (task.kind === 'operate' && task.operation === 'isolate') ? (
              <label className="space-y-2 text-sm text-ink">
                <span>Required scene target</span>
                <select
                  className={field}
                  value={task.targetId ?? ''}
                  onChange={(e) => updateTask({ targetId: e.target.value })}
                >
                  {hotspots.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="space-y-2 text-sm text-ink">
              <span>Learner instruction</span>
              <textarea
                className={field}
                value={task.instruction}
                onChange={(e) => updateTask({ instruction: e.target.value })}
              />
            </label>
            <label className="space-y-2 text-sm text-ink">
              <span>Outcome explanation</span>
              <textarea
                className={field}
                value={task.explanation}
                onChange={(e) => updateTask({ explanation: e.target.value })}
              />
            </label>
            <label className="space-y-2 text-sm text-ink">
              <span>Assessment weight</span>
              <input
                className={field}
                type="number"
                min={1}
                max={100}
                value={task.weight}
                onChange={(e) => updateTask({ weight: Number(e.target.value) })}
              />
            </label>
          </div>
          {task.kind === 'decision' ? (
            <div className="grid gap-4 md:grid-cols-2">
              {task.choices.map((choice, i) => (
                <div key={choice.id} className="space-y-3 border border-hairline p-4">
                  <label className="flex gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="correct-choice"
                      checked={task.correctChoiceId === choice.id}
                      onChange={() => updateTask({ correctChoiceId: choice.id })}
                    />
                    Successful action
                  </label>
                  <label className="block space-y-2 text-xs text-ink-dim">
                    <span>Action label</span>
                    <input
                      className={field}
                      value={choice.label}
                      onChange={(e) =>
                        updateTask({
                          choices: task.choices.map((c, n) =>
                            n === i ? { ...c, label: e.target.value } : c,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="block space-y-2 text-xs text-ink-dim">
                    <span>Consequence shown after choosing</span>
                    <textarea
                      className={field}
                      value={choice.feedback}
                      onChange={(e) =>
                        updateTask({
                          choices: task.choices.map((c, n) =>
                            n === i ? { ...c, feedback: e.target.value } : c,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <label className="flex items-center gap-3 text-sm text-ink">
                <span>Incorrect assessment action</span>
                <select
                  className={field}
                  value={task.onIncorrect}
                  onChange={(e) => updateTask({ onIncorrect: e.target.value })}
                >
                  <option value="retry">Feedback and retry</option>
                  <option value="end">End this attempt</option>
                </select>
              </label>
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {!validation.success && assetId ? (
        <p className="text-xs text-ink-dim">Before saving: {validation.error.issues[0]?.message}</p>
      ) : null}
    </div>
  );
}
