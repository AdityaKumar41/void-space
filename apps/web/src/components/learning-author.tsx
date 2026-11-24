'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  learningActivitySchema,
  type LearningActivity,
  type LearningStep,
} from '@void-space/types';
import { apiFetch, API_PUBLIC_BASE } from '../lib/api';
import { useSession } from '../lib/session';
import { LearningLayout, Panel, Notice, control, action } from './learning-ui';
interface Source {
  id: string;
  title: string;
  mime: string;
  status: string;
  error: string | null;
  passages: { id: string; page: number; text: string }[];
}
interface Task {
  id: string;
  status: string;
  error?: string;
  result?: { activityId?: string };
}
export function LearningAuthor({ id }: { id?: string }) {
  const router = useRouter(),
    { can } = useSession();
  const [sourcesSelected, setSourcesSelected] = useState<string[]>([]),
    [format, setFormat] = useState<'none' | 'diagram' | 'process' | 'model'>('diagram'),
    [name, setName] = useState(''),
    [scope, setScope] = useState<'private' | 'workspace'>('private'),
    [draft, setDraft] = useState<LearningActivity | null>(null),
    [status, setStatus] = useState('draft'),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [taskId, setTaskId] = useState('');
  const sources = useQuery({
    queryKey: ['learning-sources'],
    queryFn: () => apiFetch<{ sources: Source[] }>('/learning/sources'),
    refetchInterval: (query) =>
      query.state.data?.sources.some((s) => s.status === 'extracting') ? 2000 : false,
  });
  const task = useQuery({
    queryKey: ['learning-task', taskId],
    queryFn: () => apiFetch<{ task: Task }>(`/learning/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (q) =>
      ['queued', 'active'].includes(q.state.data?.task.status ?? 'queued') ? 2000 : false,
  });
  const existing = useQuery({
    queryKey: ['learning-author', id],
    queryFn: () =>
      apiFetch<{
        activity: { definition: LearningActivity; status: string; scope: 'private' | 'workspace' };
      }>(`/learning/activities/${id}/author`),
    enabled: !!id,
  });
  useEffect(() => {
    if (existing.data) {
      setDraft(existing.data.activity.definition);
      setStatus(existing.data.activity.status);
      setScope(existing.data.activity.scope);
    }
  }, [existing.data]);
  useEffect(() => {
    if (task.data?.task.status === 'completed') {
      void sources.refetch();
      const activityId = task.data.task.result?.activityId;
      if (activityId) router.push(`/console/learn/author/${activityId}`);
    }
  }, [task.data?.task.status]);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = sources.data?.sources.filter((s) => sourcesSelected.includes(s.id)) ?? [];
  function createManual() {
    const source = selected.find((s) => s.passages.length);
    if (!source) {
      setError('Select a ready text source with passages first.');
      return;
    }
    const ref = { sourceId: source.id, passageId: source.passages[0]!.id };
    const visual = format === 'diagram' || format === 'process';
    setDraft({
      schemaVersion: 2,
      title: name || 'New learning activity',
      summary: 'Explore the source material, then practise the learning objective.',
      level: 'beginner',
      estimatedMinutes: 10,
      objectives: [{ id: 'objective1', label: 'Explain the main idea using the source material' }],
      blocks: [
        {
          id: 'reading1',
          kind: 'reading',
          title: source.title,
          text: source.passages[0]!.text,
          sourceRefs: [ref],
        },
      ],
      scene:
        format === 'model'
          ? { kind: 'model', builtin: 'geometry' }
          : format === 'process'
            ? { kind: 'process', edges: [] }
            : format === 'diagram'
              ? { kind: 'diagram' }
              : { kind: 'none' },
      targets: visual
        ? [
            {
              id: 'target1',
              label: 'New component',
              explanation: 'Write a reviewed explanation from the source.',
              position: [0, 0, 0],
              sourceRefs: [ref],
            },
          ]
        : format === 'model'
          ? [
              {
                id: 'box',
                label: 'Box',
                explanation: 'Confirm the explanation against your source.',
                position: [-0.6, 0, 0],
                meshKey: 'box',
                sourceRefs: [ref],
              },
              {
                id: 'sphere',
                label: 'Sphere',
                explanation: 'Confirm the explanation against your source.',
                position: [0, 0, 0],
                meshKey: 'sphere',
                sourceRefs: [ref],
              },
              {
                id: 'cylinder',
                label: 'Cylinder',
                explanation: 'Confirm the explanation against your source.',
                position: [0.6, 0, 0],
                meshKey: 'cylinder',
                sourceRefs: [ref],
              },
            ]
          : [],
      steps: [
        {
          id: 'task1',
          kind: 'choice',
          title: 'Knowledge check',
          instruction: 'Write a question grounded in your source.',
          explanation: 'Write the reviewed explanation for the correct answer.',
          objectiveId: 'objective1',
          weight: 100,
          choices: [
            { id: 'a', label: 'Write option A' },
            { id: 'b', label: 'Write option B' },
          ],
          correctIds: [],
          sourceRefs: [ref],
        },
      ],
      passingScore: 80,
      reviewed: false,
    });
  }
  function update(patch: Partial<LearningActivity>) {
    setDraft((d) => (d ? { ...d, ...patch, reviewed: patch.reviewed ?? false } : null));
  }
  function taskUpdate(index: number, patch: Record<string, unknown>) {
    if (!draft) return;
    update({
      steps: draft.steps.map((s, i) => (i === index ? ({ ...s, ...patch } as LearningStep) : s)),
    });
  }
  function newTask(kind: LearningStep['kind']) {
    if (!draft) return;
    const sourceRefs = draft.blocks[0]!.sourceRefs;
    const common = {
      id: `task${crypto.randomUUID().slice(0, 8)}`,
      title: 'New practice task',
      instruction: 'Write a task supported by the source.',
      explanation: 'Write the reviewed explanation.',
      objectiveId: draft.objectives[0]!.id,
      weight: 100,
      sourceRefs,
    };
    let step: LearningStep;
    if (kind === 'identify') step = { ...common, kind, targetId: draft.targets[0]?.id ?? '' };
    else if (kind === 'order')
      step = {
        ...common,
        kind,
        items: [
          { id: 'a', label: 'First item' },
          { id: 'b', label: 'Second item' },
        ],
        correctOrder: ['a', 'b'],
      };
    else if (kind === 'match')
      step = {
        ...common,
        kind,
        left: [
          { id: 'a', label: 'Left A' },
          { id: 'b', label: 'Left B' },
        ],
        right: [
          { id: 'x', label: 'Right X' },
          { id: 'y', label: 'Right Y' },
        ],
        pairs: {},
      };
    else if (kind === 'reflection') step = { ...common, kind, weight: 0 };
    else if (kind === 'operate') step = { ...common, kind, operation: 'assemble' };
    else
      step = {
        ...common,
        kind: 'choice',
        choices: [
          { id: 'a', label: 'Option A' },
          { id: 'b', label: 'Option B' },
        ],
        correctIds: [],
      };
    update({ steps: [...draft.steps, step] });
  }
  async function save() {
    if (!draft) return;
    const definition = learningActivitySchema.parse(draft);
    const response = await apiFetch<{ activity: { id: string } }>(
      id ? `/learning/activities/${id}` : '/learning/activities',
      { method: id ? 'PATCH' : 'POST', body: { definition, scope } },
    );
    setMessage('Draft saved. Preview every interaction before publishing.');
    if (!id) router.push(`/console/learn/author/${response.activity.id}`);
  }
  return (
    <LearningLayout
      title={can('learning:manage') ? 'Teaching & activity authoring' : 'Create private practice'}
      description="Bring your sources, build an activity and preview its interactions. Shared releases require an educator’s review."
    >
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {existing.error && <Notice error>{existing.error.message}</Notice>}
      {task.data && (
        <Notice error={task.data.task.status === 'failed'}>
          Background task: {task.data.task.status}. {task.data.task.error}
        </Notice>
      )}
      {task.error && <Notice error>{task.error.message}</Notice>}
      {!draft && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <h2 className="text-xl font-semibold">Your private sources</h2>
            <p className="text-sm text-ink-dim">
              Original notes and PDFs are visible only to you. Publishing deliberately shares the
              activity’s cited excerpts.
            </p>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void work(async () => {
                  await apiFetch('/learning/sources', {
                    method: 'POST',
                    body: Object.fromEntries(data),
                  });
                  await sources.refetch();
                  setMessage('Notes saved privately.');
                });
              }}
            >
              <label className="grid gap-2">
                Source title
                <input className={control} name="title" minLength={3} maxLength={200} required />
              </label>
              <label className="grid gap-2">
                Notes
                <textarea
                  className={control + ' min-h-32'}
                  name="text"
                  minLength={20}
                  maxLength={100000}
                  required
                />
              </label>
              <button className={action} disabled={busy}>
                Save notes
              </button>
            </form>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void work(async () => {
                  const response = await fetch(`${API_PUBLIC_BASE}/learning/sources/upload`, {
                    method: 'POST',
                    credentials: 'include',
                    body: data,
                  });
                  const body = await response.json();
                  if (!response.ok) throw new Error(body.message ?? 'Upload failed');
                  await sources.refetch();
                  if (body.task) setTaskId(body.task.id);
                  setMessage(
                    'Source uploaded privately. Text PDFs are extracted in the background.',
                  );
                });
              }}
            >
              <label className="grid gap-2">
                Text PDF or approved visual (10 MB maximum)
                <input
                  className={control}
                  name="file"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  required
                />
              </label>
              <button className={action} disabled={busy}>
                Upload source
              </button>
            </form>
            {sources.error && <Notice error>{sources.error.message}</Notice>}
            <fieldset className="space-y-3">
              <legend className="pb-2 font-medium">Choose sources for an activity</legend>
              {sources.data?.sources.map((source) => (
                <label key={source.id} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={source.status !== 'ready'}
                    checked={sourcesSelected.includes(source.id)}
                    onChange={(e) =>
                      setSourcesSelected((v) =>
                        e.target.checked ? [...v, source.id] : v.filter((id) => id !== source.id),
                      )
                    }
                  />
                  <span>
                    {source.title}
                    <small className="block text-ink-dim">
                      {source.status} · {source.passages.length} passages {source.error}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
          </Panel>
          <Panel>
            <h2 className="text-xl font-semibold">Build from your sources</h2>
            <label className="grid gap-2">
              Activity title
              <input
                className={control}
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={3}
                maxLength={200}
              />
            </label>
            <label className="grid gap-2">
              Visual format
              <select
                className={control}
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
              >
                <option value="diagram">Clickable diagram</option>
                <option value="process">Process & sequence</option>
                <option value="none">Reading & quiz</option>
                <option value="model">3D geometry components</option>
              </select>
            </label>
            {can('learning:manage') && (
              <label className="grid gap-2">
                Audience
                <select
                  className={control}
                  value={scope}
                  onChange={(e) => setScope(e.target.value as typeof scope)}
                >
                  <option value="private">Private practice</option>
                  <option value="workspace">Class workspace draft</option>
                </select>
              </label>
            )}
            <button
              className={action}
              disabled={busy || !sourcesSelected.length}
              onClick={createManual}
            >
              Start manual draft
            </button>
            <button
              className={action}
              disabled={
                busy || !sourcesSelected.length || name.trim().length < 3 || format === 'model'
              }
              onClick={() =>
                work(async () => {
                  const r = await apiFetch<{ task: Task }>('/learning/generate', {
                    method: 'POST',
                    body: { title: name, sourceIds: sourcesSelected, kind: format, scope },
                  });
                  setTaskId(r.task.id);
                })
              }
            >
              Generate AI draft
            </button>
            <p className="text-sm text-ink-dim">
              Generation never publishes. Check the facts, source citations, answer keys and visual
              mappings. Native model activities need reviewed model parts; use{' '}
              <Link className="underline" href="/console/simulations">
                the model practice builder
              </Link>{' '}
              for imported assets.
            </p>
          </Panel>
        </div>
      )}
      {draft && (
        <div className="space-y-6">
          {status === 'published' ? (
            <Panel>
              <Notice>This published release is immutable.</Notice>
              <Link className="underline" href={`/console/learn/${id}`}>
                Open activity
              </Link>
              <button
                className={action}
                disabled={busy}
                onClick={() =>
                  work(async () => {
                    const r = await apiFetch<{ activity: { id: string } }>(
                      `/learning/activities/${id}/revise`,
                      { method: 'POST' },
                    );
                    router.push(`/console/learn/author/${r.activity.id}`);
                  })
                }
              >
                Create revision draft
              </button>
            </Panel>
          ) : (
            <>
              <Panel>
                <h2 className="text-xl font-semibold">Activity & outcomes</h2>
                <label className="grid gap-2">
                  Title
                  <input
                    className={control}
                    value={draft.title}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </label>
                <label className="grid gap-2">
                  Summary
                  <textarea
                    className={control}
                    value={draft.summary}
                    onChange={(e) => update({ summary: e.target.value })}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="grid gap-2">
                    Level
                    <select
                      className={control}
                      value={draft.level}
                      onChange={(e) =>
                        update({ level: e.target.value as LearningActivity['level'] })
                      }
                    >
                      {['beginner', 'intermediate', 'advanced'].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2">
                    Estimated minutes
                    <input
                      className={control}
                      type="number"
                      min={1}
                      max={240}
                      value={draft.estimatedMinutes}
                      onChange={(e) => update({ estimatedMinutes: Number(e.target.value) })}
                    />
                  </label>
                  <label className="grid gap-2">
                    Passing score %
                    <input
                      className={control}
                      type="number"
                      min={1}
                      max={100}
                      value={draft.passingScore}
                      onChange={(e) => update({ passingScore: Number(e.target.value) })}
                    />
                  </label>
                </div>
                {draft.objectives.map((o, i) => (
                  <label className="grid gap-2" key={o.id}>
                    Outcome {i + 1}
                    <input
                      className={control}
                      value={o.label}
                      onChange={(e) =>
                        update({
                          objectives: draft.objectives.map((v, n) =>
                            n === i ? { ...v, label: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  className={action}
                  onClick={() =>
                    update({
                      objectives: [
                        ...draft.objectives,
                        { id: `o${draft.objectives.length + 1}`, label: 'New learning objective' },
                      ],
                    })
                  }
                >
                  Add outcome
                </button>
              </Panel>
              <Panel>
                <h2 className="text-xl font-semibold">Lesson blocks</h2>
                {draft.blocks.map((block, i) => (
                  <fieldset className="grid gap-3 border-b border-hairline pb-5" key={block.id}>
                    <legend className="py-2">Block {i + 1}</legend>
                    <label className="grid gap-2">
                      Type
                      <select
                        className={control}
                        value={block.kind}
                        onChange={(e) =>
                          update({
                            blocks: draft.blocks.map((b, n) =>
                              n === i ? { ...b, kind: e.target.value as typeof b.kind } : b,
                            ),
                          })
                        }
                      >
                        {['reading', 'visual', 'example', 'practice', 'check'].map((kind) => (
                          <option key={kind}>{kind}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2">
                      Heading
                      <input
                        className={control}
                        value={block.title}
                        onChange={(e) =>
                          update({
                            blocks: draft.blocks.map((b, n) =>
                              n === i ? { ...b, title: e.target.value } : b,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="grid gap-2">
                      Content
                      <textarea
                        className={control + ' min-h-32'}
                        value={block.text}
                        onChange={(e) =>
                          update({
                            blocks: draft.blocks.map((b, n) =>
                              n === i ? { ...b, text: e.target.value } : b,
                            ),
                          })
                        }
                      />
                    </label>
                    <SourceRefs
                      value={block.sourceRefs}
                      sources={sources.data?.sources ?? []}
                      onChange={(refs) =>
                        update({
                          blocks: draft.blocks.map((b, n) =>
                            n === i ? { ...b, sourceRefs: refs } : b,
                          ),
                        })
                      }
                    />
                  </fieldset>
                ))}
                <button
                  className={action}
                  onClick={() =>
                    update({
                      blocks: [
                        ...draft.blocks,
                        {
                          id: `block${crypto.randomUUID().slice(0, 8)}`,
                          kind: 'reading',
                          title: 'New block',
                          text: '',
                          sourceRefs: draft.blocks[0]!.sourceRefs,
                        },
                      ],
                    })
                  }
                >
                  Add lesson block
                </button>
              </Panel>
              {draft.scene.kind !== 'none' && (
                <Panel>
                  <h2 className="text-xl font-semibold">Visual targets & mappings</h2>
                  {draft.scene.kind === 'diagram' && (
                    <label className="grid gap-2">
                      Diagram image
                      <select
                        className={control}
                        value={draft.scene.imageSourceId ?? ''}
                        onChange={(e) =>
                          update({
                            scene: { kind: 'diagram', imageSourceId: e.target.value || undefined },
                          })
                        }
                      >
                        <option value="">Use generated component boxes</option>
                        {sources.data?.sources
                          .filter((s) => s.mime.startsWith('image/') && s.status === 'ready')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {draft.targets.map((target, i) => (
                    <fieldset className="grid gap-3 border-b border-hairline pb-4" key={target.id}>
                      <legend className="py-2">Target {target.id}</legend>
                      <label className="grid gap-2">
                        Label
                        <input
                          className={control}
                          value={target.label}
                          onChange={(e) =>
                            update({
                              targets: draft.targets.map((t, n) =>
                                n === i ? { ...t, label: e.target.value } : t,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="grid gap-2">
                        Reviewed explanation
                        <textarea
                          className={control}
                          value={target.explanation}
                          onChange={(e) =>
                            update({
                              targets: draft.targets.map((t, n) =>
                                n === i ? { ...t, explanation: e.target.value } : t,
                              ),
                            })
                          }
                        />
                      </label>
                      <div className="flex gap-4">
                        {[0, 1].map((axis) => (
                          <label key={axis} className="grid flex-1 gap-2">
                            {axis === 0 ? 'Horizontal' : 'Vertical'} position
                            <input
                              type="range"
                              min={-1}
                              max={1}
                              step={0.05}
                              value={target.position[axis]}
                              onChange={(e) =>
                                update({
                                  targets: draft.targets.map((t, n) => {
                                    if (n !== i) return t;
                                    const pos = [...t.position] as [number, number, number];
                                    pos[axis] = Number(e.target.value);
                                    return { ...t, position: pos };
                                  }),
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <SourceRefs
                        value={target.sourceRefs}
                        sources={sources.data?.sources ?? []}
                        onChange={(refs) =>
                          update({
                            targets: draft.targets.map((t, n) =>
                              n === i ? { ...t, sourceRefs: refs } : t,
                            ),
                          })
                        }
                      />
                      <button
                        className={action}
                        onClick={() => update({ targets: draft.targets.filter((_, n) => n !== i) })}
                      >
                        Remove target
                      </button>
                    </fieldset>
                  ))}
                  {draft.scene.kind !== 'model' && (
                    <button
                      className={action}
                      onClick={() =>
                        update({
                          targets: [
                            ...draft.targets,
                            {
                              id: `target${crypto.randomUUID().slice(0, 8)}`,
                              label: 'New component',
                              explanation: '',
                              position: [0, 0, 0],
                              sourceRefs: draft.blocks[0]!.sourceRefs,
                            },
                          ],
                        })
                      }
                    >
                      Add component
                    </button>
                  )}
                  {draft.scene.kind === 'process' && (
                    <label className="grid gap-2">
                      Connections (one “from → to” ID pair per line)
                      <textarea
                        className={control}
                        value={draft.scene.edges.map((e) => `${e.from} → ${e.to}`).join('\n')}
                        onChange={(e) =>
                          update({
                            scene: {
                              kind: 'process',
                              edges: e.target.value
                                .split('\n')
                                .filter(Boolean)
                                .map((line) => {
                                  const [from = '', to = ''] = line
                                    .split(/→|->/)
                                    .map((x) => x.trim());
                                  return { from, to };
                                }),
                            },
                          })
                        }
                      />
                    </label>
                  )}
                </Panel>
              )}
              <Panel>
                <h2 className="text-xl font-semibold">Practice tasks & answer keys</h2>
                {draft.steps.map((step, i) => (
                  <fieldset key={step.id} className="grid gap-3 border-b border-hairline pb-5">
                    <legend className="py-3 font-medium">
                      {i + 1}. {step.kind}
                    </legend>
                    <label className="grid gap-2">
                      Task title
                      <input
                        className={control}
                        value={step.title}
                        onChange={(e) => taskUpdate(i, { title: e.target.value })}
                      />
                    </label>
                    <label className="grid gap-2">
                      Instruction
                      <textarea
                        className={control}
                        value={step.instruction}
                        onChange={(e) => taskUpdate(i, { instruction: e.target.value })}
                      />
                    </label>
                    <label className="grid gap-2">
                      Learning objective
                      <select
                        className={control}
                        value={step.objectiveId}
                        onChange={(e) => taskUpdate(i, { objectiveId: e.target.value })}
                      >
                        {draft.objectives.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2">
                      Reviewed feedback
                      <textarea
                        className={control}
                        value={step.explanation}
                        onChange={(e) => taskUpdate(i, { explanation: e.target.value })}
                      />
                    </label>
                    {step.kind === 'choice' && (
                      <>
                        <p className="text-sm">
                          Edit options and explicitly select every correct answer.
                        </p>
                        {step.choices.map((c, n) => (
                          <label className="flex items-center gap-3" key={c.id}>
                            <input
                              type="checkbox"
                              aria-label={`Correct answer ${c.id}`}
                              checked={step.correctIds.includes(c.id)}
                              onChange={(e) =>
                                taskUpdate(i, {
                                  correctIds: e.target.checked
                                    ? [...step.correctIds, c.id]
                                    : step.correctIds.filter((x) => x !== c.id),
                                })
                              }
                            />
                            <input
                              aria-label={`Option ${c.id}`}
                              className={control + ' flex-1'}
                              value={c.label}
                              onChange={(e) =>
                                taskUpdate(i, {
                                  choices: step.choices.map((x, j) =>
                                    j === n ? { ...x, label: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                          </label>
                        ))}
                        <button
                          className={action}
                          disabled={step.choices.length >= 8}
                          onClick={() =>
                            taskUpdate(i, {
                              choices: [
                                ...step.choices,
                                { id: `c${step.choices.length + 1}`, label: 'New option' },
                              ],
                            })
                          }
                        >
                          Add option
                        </button>
                      </>
                    )}
                    {step.kind === 'identify' && (
                      <label className="grid gap-2">
                        Correct component
                        <select
                          className={control}
                          value={step.targetId}
                          onChange={(e) => taskUpdate(i, { targetId: e.target.value })}
                        >
                          {draft.targets.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {step.kind === 'order' && (
                      <label className="grid gap-2">
                        Items in correct order (one per line)
                        <textarea
                          className={control}
                          value={step.correctOrder
                            .map((id) => step.items.find((x) => x.id === id)?.label ?? '')
                            .join('\n')}
                          onChange={(e) => {
                            const items = e.target.value
                              .split('\n')
                              .map((label, n) => ({ id: `item${n + 1}`, label }));
                            taskUpdate(i, { items, correctOrder: items.map((x) => x.id) });
                          }}
                        />
                      </label>
                    )}
                    {step.kind === 'match' && (
                      <label className="grid gap-2">
                        Correct pairs (one “left = right” pair per line)
                        <textarea
                          className={control}
                          value={step.left
                            .map(
                              (left) =>
                                `${left.label} = ${step.right.find((r) => r.id === step.pairs[left.id])?.label ?? ''}`,
                            )
                            .join('\n')}
                          onChange={(e) => {
                            const lines = e.target.value
                              .split('\n')
                              .map((line) => line.split('=').map((x) => x.trim()));
                            const left = lines.map((v, n) => ({ id: `l${n}`, label: v[0] ?? '' })),
                              right = lines.map((v, n) => ({ id: `r${n}`, label: v[1] ?? '' }));
                            taskUpdate(i, {
                              left,
                              right,
                              pairs: Object.fromEntries(left.map((l, n) => [l.id, right[n]!.id])),
                            });
                          }}
                        />
                      </label>
                    )}
                    {step.kind === 'operate' && (
                      <>
                        <label className="grid gap-2">
                          Operation
                          <select
                            className={control}
                            value={step.operation}
                            onChange={(e) => taskUpdate(i, { operation: e.target.value })}
                          >
                            {['assemble', 'explode', 'isolate'].map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        </label>
                        {step.operation === 'isolate' && (
                          <label className="grid gap-2">
                            Mapped component
                            <select
                              className={control}
                              value={step.targetId ?? ''}
                              onChange={(e) => taskUpdate(i, { targetId: e.target.value })}
                            >
                              <option value="">Choose component</option>
                              {draft.targets
                                .filter((t) => t.meshKey)
                                .map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.label}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                      </>
                    )}
                    <SourceRefs
                      value={step.sourceRefs}
                      sources={sources.data?.sources ?? []}
                      onChange={(sourceRefs) => taskUpdate(i, { sourceRefs })}
                    />
                    <button
                      className={action}
                      onClick={() => update({ steps: draft.steps.filter((_, n) => n !== i) })}
                    >
                      Remove task
                    </button>
                  </fieldset>
                ))}
                <div className="flex flex-wrap gap-2">
                  {(['choice', 'identify', 'order', 'match', 'reflection', 'operate'] as const)
                    .filter(
                      (k) =>
                        !(k === 'operate' && draft.scene.kind !== 'model') &&
                        !(k === 'identify' && !draft.targets.length),
                    )
                    .map((kind) => (
                      <button key={kind} className={action} onClick={() => newTask(kind)}>
                        Add {kind}
                      </button>
                    ))}
                </div>
              </Panel>
              <Panel>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={draft.reviewed}
                    onChange={(e) => update({ reviewed: e.target.checked })}
                  />
                  <span>
                    I checked every fact, answer key, cited passage and component mapping. I
                    previewed every interaction.
                  </span>
                </label>
                <div className="flex flex-wrap gap-3">
                  <button className={action} disabled={busy} onClick={() => work(save)}>
                    Save draft
                  </button>
                  {id && (
                    <Link className={action} href={`/console/learn/${id}`}>
                      Preview saved draft
                    </Link>
                  )}
                  {id && can('learning:manage') && (
                    <button
                      className={action}
                      disabled={busy || !draft.reviewed}
                      onClick={() =>
                        work(async () => {
                          await save();
                          await apiFetch(`/learning/activities/${id}/publish`, { method: 'POST' });
                          setStatus('published');
                          setMessage(
                            'Published an immutable release. Only cited source excerpts are shared.',
                          );
                        })
                      }
                    >
                      Publish reviewed release
                    </button>
                  )}
                </div>
                <p className="text-sm text-ink-dim">
                  Unsaved changes stay on this screen. Save before leaving. Learner-created
                  activities stay private and cannot award assessed completion.
                </p>
              </Panel>
            </>
          )}
        </div>
      )}
    </LearningLayout>
  );
}
function SourceRefs({
  value,
  sources,
  onChange,
}: {
  value: LearningActivity['blocks'][number]['sourceRefs'];
  sources: Source[];
  onChange: (value: LearningActivity['blocks'][number]['sourceRefs']) => void;
}) {
  return (
    <label className="grid gap-2 text-sm">
      Cited source passage
      <select
        className={control}
        value={value[0] ? `${value[0].sourceId}:${value[0].passageId}` : ''}
        onChange={(e) => {
          const [sourceId, passageId] = e.target.value.split(':');
          onChange(sourceId && passageId ? [{ sourceId, passageId }] : []);
        }}
      >
        <option value="">Choose a reviewed passage</option>
        {sources.flatMap((s) =>
          s.passages.map((p) => (
            <option key={s.id + p.id} value={`${s.id}:${p.id}`}>
              {s.title} · p.{p.page} · {p.text.slice(0, 90)}
            </option>
          )),
        )}
      </select>
    </label>
  );
}
