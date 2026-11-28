'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Search,
  Plus,
  MousePointer2,
  Tags,
  Sparkles,
  BookOpen,
  Save,
  History,
  Download,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { lessonTemplate, type LearningActivity } from '@void-space/types';
import type { CaptureLearningViews } from '../lib/model-learning-views';
import { AnnotationAgentPanel } from './annotation-agent-panel';
import { LibraryModelPreview } from './library-model-preview';
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
  function?: string;
  relationships?: string;
  sourceRefs?: { sourceId: string; passageId: string }[];
}
interface AnnotationSnapshot {
  labels: Label[];
  reviewed: boolean;
  unplaced: string[];
}
interface Model {
  id: string;
  title: string;
  status: string;
  metadata: {
    provenance?: {
      provider: string;
      uid: string;
      author: string;
      license: string;
      url: string;
      aiUseAllowed?: boolean;
    };
    viewsSourceId?: string;
    size: number;
    revision: number;
    parts: { key: string; name: string }[];
    labels: Label[];
    labelsReviewed: boolean;
    stats: { polycount: number };
  };
}
export function LearningLibrary({
  editorModelId,
  studyModelId,
}: { editorModelId?: string; studyModelId?: string } = {}) {
  const editor = !!editorModelId;
  const router = useRouter();
  const [id, setId] = useState(editorModelId ?? studyModelId ?? ''),
    [selected, setSelected] = useState<string | null>(null),
    [labels, setLabels] = useState<Label[]>([]),
    [reviewed, setReviewed] = useState(false),
    [revision, setRevision] = useState(0),
    [baseline, setBaseline] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [proposal, setProposal] = useState(''),
    [pendingAi, setPendingAi] = useState(''),
    [gizmo, setGizmo] = useState(false),
    [sidePanel, setSidePanel] = useState<'details' | 'ai'>('details'),
    [undo, setUndo] = useState<AnnotationSnapshot[]>([]),
    [redo, setRedo] = useState<AnnotationSnapshot[]>([]),
    [exploded, setExploded] = useState(false),
    [placing, setPlacing] = useState(false),
    [isolated, setIsolated] = useState<string | null>(null),
    [mode, setMode] = useState<'explore' | 'annotate'>(editor ? 'annotate' : 'explore'),
    [unplaced, setUnplaced] = useState<string[]>([]),
    [search, setSearch] = useState(''),
    [pendingModel, setPendingModel] = useState<string | null>(null),
    [showHistory, setShowHistory] = useState(false);
  const loaded = useRef('');
  const capture = useRef<CaptureLearningViews | null>(null);
  const [captureReady, setCaptureReady] = useState(false);
  const registerCapture = useCallback((fn: CaptureLearningViews | null) => {
    capture.current = fn;
    setCaptureReady(!!fn);
  }, []);
  const q = useQuery({
    queryKey: ['learning-library'],
    queryFn: () => apiFetch<{ models: Model[] }>('/learning/library'),
  });
  const sources = useQuery({
    queryKey: ['learning-sources'],
    queryFn: () =>
      apiFetch<{
        sources: {
          id: string;
          title: string;
          status: string;
          passages: { id: string; page: number; text: string }[];
        }[];
      }>('/learning/sources'),
  });
  const history = useQuery({
    queryKey: ['annotation-history', id],
    enabled: !!id && showHistory,
    queryFn: () =>
      apiFetch<{
        revisions: { revision: number; labels: Label[]; reviewed: boolean; createdAt: string }[];
      }>(`/learning/library/${id}/annotations/history`),
  });
  const task = useQuery({
    queryKey: ['label-proposal', proposal],
    enabled: !!proposal,
    queryFn: () =>
      apiFetch<{
        task: {
          status: string;
          result?: { modelId?: string; modelRevision?: number; labels?: Label[] };
        };
      }>(`/learning/tasks/${proposal}`),
  });
  const model = q.data?.models.find((m) => m.id === id);
  const dirty = !!model && baseline !== JSON.stringify({ labels, reviewed });
  useEffect(() => {
    if (pendingAi && pendingAi === proposal) setPendingAi('');
  }, [pendingAi, proposal]);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (!editorModelId && p.get('model') && p.get('proposal')) {
      router.replace(
        `/console/learn/library/${encodeURIComponent(p.get('model')!)}/annotate?proposal=${encodeURIComponent(p.get('proposal')!)}`,
      );
      return;
    }
    setId(editorModelId ?? studyModelId ?? p.get('model') ?? '');
    setProposal(p.get('proposal') ?? '');
    if (p.get('thread') || p.get('task')) setSidePanel('ai');
  }, [editorModelId, studyModelId, router]);
  useEffect(() => {
    if (!model) return;
    const proposed =
      task.data?.task.result?.modelId === model.id ? task.data.task.result.labels : undefined;
    const key = `${model.id}:${proposed ? proposal : ''}`;
    if (loaded.current === key) return;
    loaded.current = key;
    if (
      proposed &&
      task.data?.task.result?.modelRevision !== undefined &&
      task.data.task.result.modelRevision !== model.metadata.revision
    ) {
      const saved = model.metadata.labels ?? [];
      setLabels(saved);
      setReviewed(!!model.metadata.labelsReviewed);
      setRevision(model.metadata.revision);
      setBaseline(JSON.stringify({ labels: saved, reviewed: !!model.metadata.labelsReviewed }));
      setSelected(saved[0]?.id ?? null);
      setUnplaced([]);
      setError(
        'This AI proposal was made for an older model revision. Your saved annotations are unchanged. Request a new proposal.',
      );
      return;
    }
    if (proposed) remember();
    else {
      setUndo([]);
      setRedo([]);
    }
    const next = proposed ?? model.metadata.labels ?? [];
    setLabels(next);
    setReviewed(proposed ? false : !!model.metadata.labelsReviewed);
    setRevision(model.metadata.revision);
    setBaseline(
      JSON.stringify({
        labels: model.metadata.labels ?? [],
        reviewed: !!model.metadata.labelsReviewed,
      }),
    );
    setSelected(next[0]?.id ?? null);
    setUnplaced(
      proposed ? next.filter((l) => l.position.every((n) => n === 0)).map((l) => l.id) : [],
    );
    setExploded(false);
    setPlacing(false);
    setIsolated(null);
    if (proposed) {
      setMode('annotate');
      setMessage(
        'AI proposals need your review. Check each explanation and surface position before marking them reviewed.',
      );
    }
  }, [model, task.data, proposal]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
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
  function openModel(next: string, discard = false) {
    if (dirty && next !== id && !discard) {
      setPendingModel(next);
      return;
    }
    router.push(next ? `/console/learn/library/${next}` : '/console/learn/library');
  }
  function remember() {
    setUndo((prev) => [...prev.slice(-49), { labels, reviewed, unplaced }]);
    setRedo([]);
  }
  function restore(snapshot: AnnotationSnapshot) {
    setLabels(snapshot.labels);
    setReviewed(snapshot.reviewed);
    setUnplaced(snapshot.unplaced);
    setSelected(
      snapshot.labels.find((pin) => pin.id === selected)?.id ?? snapshot.labels[0]?.id ?? null,
    );
    setPlacing(false);
  }
  function update(labelId: string, patch: Partial<Label>) {
    remember();
    setLabels((prev) => prev.map((l) => (l.id === labelId ? { ...l, ...patch } : l)));
    setReviewed(false);
  }
  function addLabel(meshKey = model?.metadata.parts[0]?.key) {
    if (!editor && model) {
      router.push(`/console/learn/library/${model.id}/annotate`);
      return;
    }
    if (!meshKey || labels.length >= 40) return;
    const next: Label = {
      id: `pin_${crypto.randomUUID().replaceAll('-', '')}`,
      meshKey,
      label: 'New annotation',
      explanation: '',
      position: [0, 0, 0],
      sourceRefs: [],
    };
    remember();
    setLabels((prev) => [...prev, next]);
    setSelected(next.id);
    setUnplaced((prev) => [...prev, next.id]);
    setPlacing(true);
    setExploded(false);
    setIsolated(null);
    setReviewed(false);
    setMode('annotate');
    setSidePanel('details');
  }
  const current = labels.find((l) => l.id === selected);
  const visual: LearningActivity | undefined = model
    ? {
        schemaVersion: 2,
        title: model.title,
        summary: 'Explore and annotate your private educational model.',
        level: 'beginner',
        estimatedMinutes: 5,
        objectives: [{ id: 'explore', label: 'Explore model components' }],
        blocks: [
          {
            id: 'explore',
            kind: 'visual',
            title: 'Explore',
            text: 'Select a component or annotation to learn more.',
            sourceRefs: [],
          },
        ],
        scene: { kind: 'model', privateModelId: model.id },
        targets: labels.map((l) => ({
          id: l.id,
          label: l.label,
          meshKey: l.meshKey,
          explanation: [l.explanation, l.function, l.relationships].filter(Boolean).join('\n\n'),
          position: l.position,
          placement: unplaced.includes(l.id) ? 'unplaced' : 'confirmed',
          sourceRefs: l.sourceRefs ?? [],
        })),
        steps: [
          {
            id: 'observe',
            kind: 'reflection',
            title: 'What do you notice?',
            instruction: 'Explore the model and check its annotations against your references.',
            explanation: 'Check observations against reviewed sources.',
            objectiveId: 'explore',
            weight: 0,
            sourceRefs: [],
          },
        ],
        passingScore: 80,
        reviewed: false,
      }
    : undefined;
  if (proposal && task.isPending && !model)
    return (
      <LearningLayout title="Library" description="Loading your annotation proposal…">
        <p role="status">Reading the saved AI proposal. Your current annotations are unchanged.</p>
      </LearningLayout>
    );
  return (
    <LearningLayout
      playground={editor}
      hideHeading={!!id}
      title="Library"
      description="A place for your models and the knowledge around them. Everything here starts private."
    >
      <div className={editor ? 'annotation-editor' : `library-browser${id ? ' is-model' : ''}`}>
        {!editor && !id && (
          <>
            <div className="library-toolbar">
              <label className="library-search">
                <Search size={17} />
                <input
                  aria-label="Search your models"
                  placeholder="Find a model…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className={action + ' cursor-pointer'}>
                <Plus size={16} /> Add model
                <input
                  className="sr-only"
                  type="file"
                  accept=".glb,model/gltf-binary"
                  disabled={busy || dirty}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (!file) return;
                    void work(async () => {
                      const form = new FormData();
                      form.append('file', file);
                      const response = await fetch(`${API_PUBLIC_BASE}/learning/library/upload`, {
                        method: 'POST',
                        credentials: 'include',
                        body: form,
                      });
                      const value = await response.json();
                      if (!response.ok) throw new Error(value.message ?? 'Upload failed');
                      await q.refetch();
                      openModel(value.model.id);
                    });
                  }}
                />
              </label>
              <Link className={action} href="/console/models">
                Find a model on Sketchfab <Search size={15} />
              </Link>
            </div>
            <p className="library-upload-hint">
              Upload a GLB model up to 50 MB. Your account holds up to 20 models / 200 MB.
            </p>
          </>
        )}
        {busy && (
          <p role="status" className="text-sm text-ink-dim">
            Saving your model changes. Please keep this page open…
          </p>
        )}
        {error && <Notice error>{error}</Notice>}
        {q.error && (
          <Notice error>
            {q.error.message}{' '}
            <button className="underline" onClick={() => void q.refetch()}>
              Retry
            </button>
          </Notice>
        )}
        {task.error && <Notice error>{task.error.message}</Notice>}
        {message && <Notice>{message}</Notice>}
        {pendingModel !== null && (
          <Notice>
            Save your annotations before switching, or{' '}
            <button
              className="underline"
              onClick={() => {
                loaded.current = '';
                openModel(pendingModel, true);
                setPendingModel(null);
              }}
            >
              discard changes and switch
            </button>
            .{' '}
            <button className="underline" onClick={() => setPendingModel(null)}>
              Keep editing
            </button>
          </Notice>
        )}
        {pendingAi && (
          <Notice>
            AI changes are ready while you have unsaved edits. Save or discard your manual changes
            before opening them.{' '}
            <button
              className="underline"
              disabled={dirty}
              onClick={() => {
                setProposal(pendingAi);
                setPendingAi('');
              }}
            >
              Open AI proposal
            </button>
          </Notice>
        )}
        {proposal &&
          task.data?.task.result?.labels &&
          (task.data.task.result.modelRevision === undefined ||
            task.data.task.result.modelRevision === model?.metadata.revision) && (
            <div className="annotation-proposal-banner" role="status">
              <strong>AI proposal · review on the model</strong>
              <span>
                Edit any explanation or pin before saving. Your saved annotations are unchanged.
              </span>
              <button
                onClick={() => {
                  setProposal('');
                  loaded.current = '';
                  void q.refetch();
                }}
              >
                Discard proposal
              </button>
            </div>
          )}
        <div className="library-workspace">
          {!editor && !id && (
            <aside className="library-models" aria-label="Your private models">
              {q.isLoading && <p role="status">Loading your library…</p>}
              {q.data?.models
                .filter((m) => m.title.toLowerCase().includes(search.toLowerCase()))
                .map((m) => (
                  <button
                    key={m.id}
                    className="library-model-card"
                    aria-pressed={id === m.id}
                    onClick={() => openModel(m.id)}
                  >
                    <LibraryModelPreview
                      key={m.metadata.viewsSourceId ?? m.id}
                      title={m.title}
                      src={
                        m.metadata.viewsSourceId
                          ? `${API_PUBLIC_BASE}/learning/library/${m.id}/thumbnail?v=${m.metadata.viewsSourceId}`
                          : undefined
                      }
                    />
                    <strong>{m.title}</strong>
                    <span>
                      {m.metadata.parts.length === 1
                        ? 'Single mesh'
                        : `${m.metadata.parts.length} meshes`}{' '}
                      · {m.metadata.labels?.length ?? 0} annotations
                    </span>
                    <small>Private · {m.metadata.labelsReviewed ? 'Reviewed' : 'Draft'}</small>
                  </button>
                ))}
              {q.data && !q.data.models.length && (
                <Panel>
                  <Box size={32} />
                  <h2 className="text-lg font-semibold">Bring learning into 3D</h2>
                  <p>
                    Add your first model, explore its components and create annotations or a lesson.
                  </p>
                </Panel>
              )}
              {!!q.data?.models.length &&
                !q.data?.models.some((m) =>
                  m.title.toLowerCase().includes(search.toLowerCase()),
                ) && <p>No matching models.</p>}
            </aside>
          )}
          {id && !model && (
            <div className="p-6">
              <Link href="/console/learn/library" className="underline">
                Back to library
              </Link>
              <p role="status" className="mt-4">
                {q.isLoading
                  ? 'Opening your model…'
                  : 'This model is unavailable in your private library. Choose a model you can access.'}
              </p>
            </div>
          )}
          {model && visual ? (
            <section className="library-detail" aria-label={model.title}>
              <button className="learning-text-link" onClick={() => openModel('')}>
                ← {editor ? 'Back to library' : 'Back to all models'}
              </button>
              <header className="library-detail-heading">
                <div>
                  <p className="text-xs text-ink-dim">
                    {editor ? 'Annotation editor' : 'Your private model'}
                  </p>
                  <h1 className="text-2xl font-semibold">{model.title}</h1>
                  {model.metadata.provenance?.provider === 'sketchfab' && (
                    <p className="mt-2 text-sm text-ink-dim">
                      By {model.metadata.provenance.author} · {model.metadata.provenance.license} ·{' '}
                      <a
                        className="underline"
                        href={`https://sketchfab.com/3d-models/${model.metadata.provenance.uid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Original on Sketchfab
                      </a>
                      {model.metadata.provenance.aiUseAllowed !== true && (
                        <span className="block mt-1">
                          Available for manual study and annotation. AI processing is unavailable
                          because AI permission has not been confirmed.
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="library-heading-actions flex gap-2">
                  {editor && (
                    <>
                      <button
                        className={action}
                        disabled={!undo.length}
                        onClick={() => {
                          const snapshot = undo.at(-1)!;
                          setRedo((prev) => [...prev, { labels, reviewed, unplaced }]);
                          setUndo((prev) => prev.slice(0, -1));
                          restore(snapshot);
                        }}
                      >
                        Undo
                      </button>
                      <button
                        className={action}
                        disabled={!redo.length}
                        onClick={() => {
                          const snapshot = redo.at(-1)!;
                          setUndo((prev) => [...prev, { labels, reviewed, unplaced }]);
                          setRedo((prev) => prev.slice(0, -1));
                          restore(snapshot);
                        }}
                      >
                        Redo
                      </button>
                    </>
                  )}
                  {editor && (
                    <button
                      className={action}
                      disabled={!captureReady || labels.length >= 40}
                      onClick={() => addLabel()}
                    >
                      <Plus size={15} /> Add pin
                    </button>
                  )}
                  {editor && (
                    <button
                      className={action}
                      aria-pressed={gizmo}
                      disabled={!current || placing}
                      onClick={() => setGizmo(!gizmo)}
                    >
                      Move pin in 3D
                    </button>
                  )}
                  {editor && (
                    <button
                      className={action}
                      aria-pressed={mode === 'explore'}
                      onClick={() => {
                        setMode('explore');
                        setPlacing(false);
                      }}
                    >
                      <MousePointer2 size={16} />
                      Explore
                    </button>
                  )}
                  {editor ? (
                    <button
                      className={action}
                      aria-pressed={mode === 'annotate'}
                      onClick={() =>
                        editor
                          ? setMode('annotate')
                          : router.push(`/console/learn/library/${model.id}/annotate`)
                      }
                    >
                      <Tags size={16} />
                      {editor ? 'Edit details' : 'Open annotation editor'}
                    </button>
                  ) : (
                    <Link className={action} href={`/console/learn/library/${model.id}/annotate`}>
                      <Tags size={16} />
                      Open annotation editor
                    </Link>
                  )}
                </div>
              </header>
              <div className="library-model-workbench">
                <div className="library-viewport">
                  <Visual
                    editorControls={editor}
                    onPinMove={
                      editor && gizmo
                        ? (pinId, position) => {
                            update(pinId, { position });
                            setUnplaced((prev) => prev.filter((pin) => pin !== pinId));
                          }
                        : undefined
                    }
                    onCaptureReady={registerCapture}
                    activity={visual}
                    showLabels={false}
                    selected={selected}
                    onSelect={(pin) => {
                      setSelected(pin);
                      if (editor) setSidePanel('details');
                    }}
                    exploded={exploded}
                    isolated={isolated}
                    onSurfacePick={
                      placing && current
                        ? (position, meshKey) => {
                            update(current.id, { position, meshKey });
                            setUnplaced((prev) => prev.filter((pin) => pin !== current.id));
                            setPlacing(false);
                            setMessage(
                              'Pin placed. Check its position from another angle before saving.',
                            );
                          }
                        : undefined
                    }
                  />
                  <p className="library-interaction-hint">
                    Drag to rotate · scroll or pinch to zoom · select a pin to read its explanation.
                  </p>
                  {model.metadata.parts.length > 1 && (
                    <div className="library-view-controls">
                      <button
                        className={action}
                        disabled={model.metadata.parts.length < 2}
                        aria-pressed={exploded}
                        onClick={() => setExploded(!exploded)}
                      >
                        {exploded ? 'Assemble' : 'Separate parts'}
                      </button>
                      <button
                        className={action}
                        disabled={!current || model.metadata.parts.length < 2}
                        onClick={() => setIsolated(isolated ? null : selected)}
                      >
                        {isolated ? 'Show all' : 'Isolate component'}
                      </button>
                    </div>
                  )}
                  {placing && (
                    <Notice>
                      Click or tap the model surface to place this pin.{' '}
                      <button className="underline" onClick={() => setPlacing(false)}>
                        Cancel
                      </button>
                    </Notice>
                  )}
                  {editor && (
                    <p className="annotation-editor-guide">
                      {placing
                        ? 'Click a precise point on the model. Drag to rotate before choosing the surface.'
                        : 'Select a numbered pin to edit it, or add an annotation and choose its position on the surface.'}
                    </p>
                  )}
                  {editor && model.metadata.parts.length < 2 && (
                    <p className="text-xs text-ink-dim">
                      Single-mesh model. Add multiple surface pins; separate-part controls are
                      unavailable.
                    </p>
                  )}
                </div>
                <div className={editor ? 'annotation-side-panel' : 'study-annotations'}>
                  {editor && (
                    <div
                      className="annotation-side-tabs"
                      role="tablist"
                      aria-label="Workspace panel"
                    >
                      <button
                        role="tab"
                        aria-selected={sidePanel === 'details'}
                        aria-controls="annotation-details-panel"
                        id="annotation-details-tab"
                        onClick={() => setSidePanel('details')}
                      >
                        Annotations ({labels.length})
                      </button>
                      <button
                        role="tab"
                        aria-selected={sidePanel === 'ai'}
                        aria-controls="annotation-ai-panel"
                        id="annotation-ai-tab"
                        onClick={() => setSidePanel('ai')}
                      >
                        <Sparkles size={14} /> AI assistant
                      </button>
                    </div>
                  )}
                  <aside
                    className="library-inspector"
                    aria-label="Annotation inspector"
                    id="annotation-details-panel"
                    hidden={editor && sidePanel !== 'details'}
                  >
                    {current?.confidence === 'uncertain' && !reviewed && (
                      <Notice>
                        AI could not confirm this identity or pin position. Check the model and your
                        sources before reviewing.
                      </Notice>
                    )}
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">
                        Annotations{' '}
                        <span className="text-ink-dim">
                          {labels.length}
                          {editor ? '/40' : ''}
                        </span>
                      </h3>
                      {editor && (
                        <button
                          className={action}
                          disabled={labels.length >= 40 || (editor && !captureReady)}
                          onClick={() => addLabel()}
                          aria-label={editor ? 'Add annotation' : 'Edit annotations'}
                        >
                          {editor ? <Plus size={16} /> : <Tags size={16} />}
                        </button>
                      )}
                    </div>
                    {editor && !captureReady && (
                      <p role="status" className="text-xs text-ink-dim">
                        Loading model geometry. Pin tools will be ready in a moment.
                      </p>
                    )}
                    <div
                      className="library-annotation-list"
                      role="group"
                      aria-label="Select annotation"
                    >
                      {labels.map((l, i) => (
                        <button
                          key={l.id}
                          aria-pressed={selected === l.id}
                          onClick={() => {
                            setSelected(l.id);
                            setPlacing(false);
                          }}
                        >
                          <span>{i + 1}</span>
                          <span className="annotation-list-title">
                            {/[_:].*[_:]/.test(l.label) ? `Annotation ${i + 1}` : l.label}
                          </span>
                          {unplaced.includes(l.id) && <small>Place pin</small>}
                        </button>
                      ))}
                    </div>
                    {!labels.length && (
                      <div className="library-annotations-empty">
                        <Tags size={24} strokeWidth={1.4} aria-hidden="true" />
                        <p className="font-medium">No annotations yet</p>
                        <p>
                          {editor
                            ? 'Add a pin on the model, then describe what it explains. Or ask the AI assistant for a draft.'
                            : 'Explore this model freely, or open the editor to add learning notes and pins.'}
                        </p>
                        {!editor && (
                          <button
                            className={action}
                            onClick={() =>
                              router.push(`/console/learn/library/${model.id}/annotate`)
                            }
                          >
                            Add your first annotation
                          </button>
                        )}
                      </div>
                    )}
                    {current &&
                      (editor && mode === 'annotate' ? (
                        <div className="space-y-4">
                          <label className="grid gap-2 text-sm">
                            Name
                            <input
                              className={control}
                              maxLength={100}
                              value={current.label}
                              onChange={(e) => update(current.id, { label: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-2 text-sm">
                            Explanation
                            <textarea
                              className={control}
                              rows={4}
                              maxLength={2000}
                              value={current.explanation}
                              onChange={(e) => update(current.id, { explanation: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-2 text-sm">
                            Function
                            <textarea
                              className={control}
                              rows={2}
                              maxLength={2000}
                              value={current.function ?? ''}
                              onChange={(e) => update(current.id, { function: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-2 text-sm">
                            Related components
                            <textarea
                              className={control}
                              rows={2}
                              maxLength={2000}
                              value={current.relationships ?? ''}
                              onChange={(e) =>
                                update(current.id, { relationships: e.target.value })
                              }
                            />
                          </label>
                          <button
                            className={action}
                            aria-pressed={placing}
                            onClick={() => {
                              setPlacing(!placing);
                              setExploded(false);
                              setIsolated(null);
                            }}
                          >
                            Place pin on surface
                          </button>
                          <details className="annotation-advanced">
                            <summary>Advanced: mesh attachment & sources</summary>
                            <fieldset className="mt-3 grid gap-2">
                              <legend className="text-sm">Adjust pin with keyboard</legend>
                              <p className="text-xs text-ink-dim">
                                Normalized model coordinates, from −1 to 1. Check the numbered pin
                                in the model before confirming.
                              </p>
                              {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                                <label key={axis} className="grid gap-1 text-xs">
                                  Pin {axis} coordinate
                                  <input
                                    className={control}
                                    type="number"
                                    min={-1}
                                    max={1}
                                    step={0.01}
                                    value={current.position[index]}
                                    onChange={(e) => {
                                      const value = e.currentTarget.valueAsNumber;
                                      if (!Number.isFinite(value)) return;
                                      const position = [...current.position] as [
                                        number,
                                        number,
                                        number,
                                      ];
                                      position[index] = Math.max(-1, Math.min(1, value));
                                      update(current.id, { position });
                                      setPlacing(false);
                                    }}
                                  />
                                </label>
                              ))}
                              <button
                                className={action}
                                onClick={() => {
                                  setUnplaced((prev) => prev.filter((pin) => pin !== current.id));
                                  setPlacing(false);
                                }}
                              >
                                Confirm pin coordinates
                              </button>
                            </fieldset>
                            <label className="grid gap-2 text-sm">
                              Model component
                              <select
                                className={control}
                                value={current.meshKey}
                                onChange={(e) =>
                                  update(current.id, {
                                    meshKey: e.target.value,
                                    position: [0, 0, 0],
                                  })
                                }
                              >
                                {model.metadata.parts.map((p) => (
                                  <option key={p.key} value={p.key}>
                                    {p.name} ({p.key})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-2 text-sm">
                              Add source reference
                              <select
                                className={control}
                                value=""
                                onChange={(e) => {
                                  const [sourceId, passageId] = e.target.value.split(':');
                                  if (
                                    sourceId &&
                                    passageId &&
                                    (current.sourceRefs?.length ?? 0) < 10
                                  )
                                    update(current.id, {
                                      sourceRefs: [
                                        ...(current.sourceRefs ?? []).filter(
                                          (r) =>
                                            r.sourceId !== sourceId || r.passageId !== passageId,
                                        ),
                                        { sourceId, passageId },
                                      ],
                                    });
                                }}
                              >
                                <option value="">Choose a passage…</option>
                                {sources.data?.sources
                                  .filter((s) => s.status === 'ready')
                                  .flatMap((s) =>
                                    s.passages.map((p) => (
                                      <option key={`${s.id}:${p.id}`} value={`${s.id}:${p.id}`}>
                                        {s.title} · page/slide {p.page}: {p.text.slice(0, 75)}
                                      </option>
                                    )),
                                  )}
                              </select>
                            </label>
                            {current.sourceRefs?.map((r) => (
                              <button
                                key={`${r.sourceId}:${r.passageId}`}
                                className="text-left text-xs underline"
                                onClick={() =>
                                  update(current.id, {
                                    sourceRefs: current.sourceRefs?.filter((x) => x !== r),
                                  })
                                }
                              >
                                Remove{' '}
                                {sources.data?.sources.find((s) => s.id === r.sourceId)?.title ??
                                  'source'}{' '}
                                · {r.passageId}
                              </button>
                            ))}
                          </details>
                          <button
                            className={action}
                            onClick={() => {
                              setPlacing(false);
                              setUnplaced((prev) => prev.filter((pin) => pin !== current.id));
                              remember();
                              setLabels((prev) => prev.filter((l) => l.id !== current.id));
                              setSelected(labels.find((l) => l.id !== current.id)?.id ?? null);
                              setReviewed(false);
                            }}
                          >
                            Delete annotation
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold">{current.label}</h3>
                          <p className="whitespace-pre-wrap text-sm">
                            {current.explanation ||
                              'Open the annotation editor to add an explanation and place this pin.'}
                          </p>
                          {current.function && (
                            <p className="text-sm">
                              <strong>Function</strong>
                              <br />
                              {current.function}
                            </p>
                          )}
                          {current.relationships && (
                            <p className="text-sm">
                              <strong>Connections</strong>
                              <br />
                              {current.relationships}
                            </p>
                          )}
                          <Link
                            onClick={(e) => {
                              if (dirty) {
                                e.preventDefault();
                                setError('Save annotation changes before opening the agent.');
                              }
                            }}
                            className={action}
                            href={`/console/learn/agent?model=${model.id}&intent=labels`}
                          >
                            <Sparkles size={15} />
                            Ask AI about this model
                          </Link>
                        </div>
                      ))}
                  </aside>
                  {editor && (
                    <div
                      id="annotation-ai-panel"
                      hidden={sidePanel !== 'ai'}
                      className="annotation-ai-panel"
                    >
                      <AnnotationAgentPanel
                        ready={captureReady && !exploded && !isolated}
                        modelId={model.id}
                        selectedId={selected}
                        dirty={dirty}
                        aiAllowed={
                          model.metadata.provenance?.provider !== 'sketchfab' ||
                          model.metadata.provenance.aiUseAllowed === true
                        }
                        prepareViews={async () => {
                          if (!capture.current || exploded || isolated)
                            throw new Error(
                              'Wait for the model to load and show the assembled model before asking AI.',
                            );
                          const views = await capture.current();
                          await apiFetch(`/learning/library/${model.id}/views`, {
                            method: 'POST',
                            body: { views },
                          });
                        }}
                        onProposal={(next) => {
                          if (next === proposal || next === pendingAi) return;
                          if (dirty) {
                            setPendingAi(next);
                          } else {
                            setProposal(next);
                            setMode('annotate');
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
              {editor && (
                <div className="library-savebar">
                  <span role="status">
                    {unplaced.length
                      ? `${unplaced.length} pin(s) need a surface position`
                      : dirty
                        ? 'Unsaved changes'
                        : 'All changes saved'}{' '}
                    · revision {revision}
                  </span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={!labels.length}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I checked names, explanations and positions
                  </label>
                  <button
                    className={action}
                    disabled={
                      busy ||
                      !dirty ||
                      !!unplaced.length ||
                      labels.some((l) => l.label.trim().length < 2)
                    }
                    onClick={() =>
                      void work(async () => {
                        const saved = await apiFetch<{ model: Model }>(
                          `/learning/library/${model.id}/labels`,
                          {
                            method: 'PATCH',
                            body: {
                              revision,
                              reviewed,
                              labels,
                            },
                          },
                        );
                        setRevision(saved.model.metadata.revision);
                        setBaseline(JSON.stringify({ labels, reviewed }));
                        setProposal('');
                        loaded.current = `${model.id}:`;
                        const url = new URL(location.href);
                        url.searchParams.delete('proposal');
                        window.history.replaceState(null, '', url.pathname + url.search);
                        await q.refetch();
                        if (showHistory) await history.refetch();
                        setMessage(
                          reviewed ? 'Reviewed annotations saved.' : 'Annotation draft saved.',
                        );
                      })
                    }
                  >
                    <Save size={15} />
                    Save annotations
                  </button>
                </div>
              )}
              <div className="library-secondary-actions flex flex-wrap gap-3">
                {editor && (
                  <button
                    className={action}
                    disabled={busy || dirty}
                    onClick={() => {
                      if (!editor) {
                        router.push(`/console/learn/library/${model.id}/annotate`);
                        return;
                      }
                      setSidePanel('ai');
                      requestAnimationFrame(() =>
                        document.getElementById('annotation-agent-message')?.focus(),
                      );
                    }}
                  >
                    <Sparkles size={15} />
                    Work with AI
                  </button>
                )}
                <Link
                  onClick={(e) => {
                    if (dirty) {
                      e.preventDefault();
                      setError('Save annotation changes before opening the agent.');
                    }
                  }}
                  className={action}
                  href={`/console/learn/agent?model=${model.id}`}
                >
                  <BookOpen size={15} />
                  Create lesson with AI
                </Link>
                <details className="library-more-actions">
                  <summary>More actions</summary>
                  <div>
                    <button
                      className={action}
                      disabled={busy || dirty}
                      onClick={() =>
                        void work(async () => {
                          const citedSources = [
                            ...new Set(
                              labels.flatMap((l) => (l.sourceRefs ?? []).map((r) => r.sourceId)),
                            ),
                          ];
                          if (citedSources.length > 20)
                            throw new Error(
                              'This model cites more than 20 sources. Create a lesson with a smaller source selection.',
                            );
                          const definition = lessonTemplate(
                            {
                              topic: model.title,
                              audience: 'Learners aged 13+',
                              durationMinutes: 30,
                              instructions: '',
                              sourceIds: citedSources,
                            },
                            visual,
                          );
                          definition.privateModelId = model.id;
                          const r = await apiFetch<{ plan: { id: string } }>(
                            '/learning/lesson-plans',
                            {
                              method: 'POST',
                              body: definition,
                            },
                          );
                          router.push(`/console/learn/drafts/${r.plan.id}`);
                        })
                      }
                    >
                      Start lesson manually
                    </button>
                    <button className={action} onClick={() => setShowHistory(!showHistory)}>
                      <History size={15} />
                      Revision history
                    </button>
                    <button
                      className={action}
                      onClick={() => {
                        const url = URL.createObjectURL(
                          new Blob(
                            [
                              JSON.stringify(
                                {
                                  schemaVersion: 1,
                                  modelId: model.id,
                                  title: model.title,
                                  reviewed,
                                  revision,
                                  labels,
                                },
                                null,
                                2,
                              ),
                            ],
                            { type: 'application/json' },
                          ),
                        );
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'annotations.json';
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      <Download size={15} />
                      Export annotations
                    </button>
                  </div>
                </details>
              </div>
              {showHistory && (
                <Panel>
                  <h3 className="font-semibold">Saved annotation revisions</h3>
                  {history.error && <Notice error>{history.error.message}</Notice>}
                  {history.data?.revisions.map((r) => (
                    <div key={r.revision} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        Revision {r.revision} · {r.reviewed ? 'Reviewed' : 'Draft'} ·{' '}
                        {new Date(r.createdAt).toLocaleString()}
                      </span>
                      {editor && (
                        <button
                          className={action}
                          disabled={dirty}
                          onClick={() => {
                            setLabels(r.labels);
                            setReviewed(false);
                            setSelected(r.labels[0]?.id ?? null);
                            setMode('annotate');
                            setMessage(
                              'Previous annotations loaded as unsaved edits. Save to create a new revision.',
                            );
                          }}
                        >
                          Load as draft
                        </button>
                      )}
                    </div>
                  ))}
                </Panel>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </LearningLayout>
  );
}
