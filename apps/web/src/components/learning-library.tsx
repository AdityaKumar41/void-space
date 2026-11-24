'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LearningActivity } from '@void-space/types';
import { apiFetch, API_PUBLIC_BASE } from '../lib/api';
import { LearningLayout, Panel, Notice, action, control } from './learning-ui';
const Visual = dynamic(() => import('./learning-visual'), {
  ssr: false,
  loading: () => <p role="status">Loading model…</p>,
});
interface Label {
  id: string;
  label: string;
  explanation: string;
  meshKey: string;
  position: [number, number, number];
  confidence?: string;
}
interface Model {
  id: string;
  title: string;
  status: string;
  metadata: {
    size: number;
    revision: number;
    parts: { key: string; name: string }[];
    labels: Label[];
    labelsReviewed: boolean;
    stats: { polycount: number };
  };
}
export function LearningLibrary() {
  const [id, setId] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [labels, setLabels] = useState<Label[]>([]),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [proposal, setProposal] = useState(''),
    [exploded, setExploded] = useState(false),
    [isolated, setIsolated] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['learning-library'],
    queryFn: () => apiFetch<{ models: Model[] }>('/learning/library'),
  });
  const task = useQuery({
    queryKey: ['label-proposal', proposal],
    queryFn: () =>
      apiFetch<{ task: { status: string; result?: { modelId?: string; labels?: Label[] } } }>(
        `/learning/tasks/${proposal}`,
      ),
    enabled: !!proposal,
  });
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setId(p.get('model') ?? '');
    setProposal(p.get('proposal') ?? '');
  }, []);
  const model = q.data?.models.find((m) => m.id === id);
  useEffect(() => {
    if (!model) return;
    const proposed =
      task.data?.task.result?.modelId === model.id ? task.data.task.result.labels : undefined;
    setLabels(proposed ?? model.metadata.labels ?? []);
    setReviewed(proposed ? false : model.metadata.labelsReviewed);
    setSelected(null);
    setExploded(false);
    setIsolated(null);
    if (proposed)
      setMessage(
        'Unverified label proposal loaded. Confirm names, explanations and mappings before saving as reviewed.',
      );
  }, [model, task.data]);
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
  const visual: LearningActivity | undefined = model
    ? {
        schemaVersion: 2,
        title: model.title,
        summary: 'Your private model for educational exploration.',
        level: 'beginner',
        estimatedMinutes: 5,
        objectives: [{ id: 'explore', label: 'Explore the model components' }],
        blocks: [
          {
            id: 'explore',
            kind: 'visual',
            title: 'Explore',
            text: 'Review the component mappings.',
            sourceRefs: [],
          },
        ],
        scene: { kind: 'model', privateModelId: model.id },
        targets: labels.map(({ confidence, ...l }) => ({ ...l, sourceRefs: [] })),
        steps: [],
        passingScore: 80,
        reviewed: false,
      }
    : undefined;
  return (
    <LearningLayout
      title="Library"
      description="Your models, for your own learning. Adding a model here does not list it on the marketplace."
    >
      <div className="flex flex-wrap gap-3">
        <label className={action + ' cursor-pointer'}>
          Add a private 3D model
          <input
            className="sr-only"
            type="file"
            accept=".glb,model/gltf-binary"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void work(async () => {
                const form = new FormData();
                form.append('file', file);
                const response = await fetch(`${API_PUBLIC_BASE}/learning/library/upload`, {
                  method: 'POST',
                  credentials: 'include',
                  body: form,
                });
                const r = await response.json();
                if (!response.ok) throw new Error(r.message ?? 'Upload failed');
                await q.refetch();
                setId(r.model.id);
                setMessage(
                  'Your model is available privately. It has not been sent to the marketplace or a public asset gateway.',
                );
              });
              e.currentTarget.value = '';
            }}
          />
        </label>
        <Link className={action} href="/console/library">
          Open asset workspace library
        </Link>
      </div>
      <p className="text-sm text-ink-dim">
        Self-contained GLB · up to 50 MB per model · 20 models / 200 MB per account. Model listings
        load without opening their 3D geometry.
      </p>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {q.error && <Notice error>{q.error.message}</Notice>}
      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="space-y-2">
          {q.data?.models.map((m) => (
            <button
              key={m.id}
              className={action + ' w-full text-left'}
              aria-pressed={id === m.id}
              onClick={() => {
                setId(m.id);
                setProposal('');
              }}
            >
              {m.title}
              <span className="mt-1 block text-xs text-ink-dim">
                Private · {m.metadata.parts.length} meshes
              </span>
            </button>
          ))}
          {q.data && !q.data.models.length && (
            <Panel>
              <p>Add a model to explore it privately or use it with your learning agent.</p>
            </Panel>
          )}
        </aside>
        {model && visual && (
          <div className="min-w-0 space-y-5">
            <Panel>
              <h2 className="text-xl font-semibold">{model.title}</h2>
              <Visual
                activity={visual}
                selected={selected}
                onSelect={setSelected}
                exploded={exploded}
                isolated={isolated}
              />
              <div className="flex flex-wrap gap-2">
                {labels.map((l) => (
                  <button
                    className={action}
                    key={l.id}
                    aria-pressed={selected === l.id}
                    onClick={() => setSelected(l.id)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              {selected && <p>{labels.find((l) => l.id === selected)?.explanation}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  className={action}
                  disabled={model.metadata.parts.length < 2}
                  onClick={() => setExploded(!exploded)}
                >
                  {exploded ? 'Assemble model' : 'Separate components'}
                </button>
                <button
                  className={action}
                  disabled={!selected || model.metadata.parts.length < 2}
                  onClick={() => setIsolated(isolated ? null : selected)}
                >
                  {isolated ? 'Show all components' : 'Isolate selected component'}
                </button>
                <Link className={action} href={`/console/learn/agent?model=${model.id}`}>
                  Create a lesson with this model
                </Link>
                <Link
                  className={action}
                  href={`/console/learn/agent?model=${model.id}&intent=labels`}
                >
                  Ask agent to label components
                </Link>
              </div>
              {model.metadata.parts.length < 2 && (
                <Notice>
                  This model has one mesh. You can view and annotate it; separate-part operations
                  are unavailable.
                </Notice>
              )}
            </Panel>
            <Panel>
              <h2 className="text-lg font-semibold">Component labels</h2>
              <p className="text-sm text-ink-dim">
                Names from the file are clues, not verified subject knowledge. The agent proposes
                labels; you confirm what each part is and what it does.
              </p>
              {!labels.length && (
                <button
                  className={action}
                  onClick={() => {
                    setLabels(
                      model.metadata.parts.slice(0, 40).map((p, i) => ({
                        id: `part_${i}`,
                        meshKey: p.key,
                        label: p.name,
                        explanation:
                          'Confirm this component using an approved reference before teaching it.',
                        position: [0, 0, 0],
                      })),
                    );
                    setReviewed(false);
                  }}
                >
                  Start from model component names
                </button>
              )}
              {labels.map((l, i) => (
                <fieldset key={l.id} className="space-y-3 rounded-lg border border-hairline p-3">
                  <legend>
                    {l.meshKey}
                    {l.confidence === 'uncertain' ? ' · uncertain' : ''}
                  </legend>
                  <label className="grid gap-2">
                    Component name
                    <input
                      className={control}
                      value={l.label}
                      onChange={(e) => {
                        setLabels(
                          labels.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)),
                        );
                        setReviewed(false);
                      }}
                    />
                  </label>
                  <label className="grid gap-2">
                    What does this component do?
                    <textarea
                      className={control}
                      value={l.explanation}
                      onChange={(e) => {
                        setLabels(
                          labels.map((x, n) =>
                            n === i ? { ...x, explanation: e.target.value } : x,
                          ),
                        );
                        setReviewed(false);
                      }}
                    />
                  </label>
                  <button className={action} onClick={() => setSelected(l.id)}>
                    Locate in model
                  </button>
                </fieldset>
              ))}
              {!!labels.length && (
                <>
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I confirmed these names, explanations and model mappings.
                  </label>
                  <button
                    className={action}
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        await apiFetch(`/learning/library/${model.id}/labels`, {
                          method: 'PATCH',
                          body: {
                            revision: model.metadata.revision,
                            reviewed,
                            labels: labels.map(({ confidence, ...l }) => l),
                          },
                        });
                        setProposal('');
                        await q.refetch();
                        setMessage(
                          reviewed
                            ? 'Reviewed model labels saved.'
                            : 'Unverified label draft saved.',
                        );
                      })
                    }
                  >
                    Save {reviewed ? 'reviewed labels' : 'label draft'}
                  </button>
                </>
              )}
            </Panel>
          </div>
        )}
      </div>
    </LearningLayout>
  );
}
