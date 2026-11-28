'use client';
import Link from 'next/link';
import { LessonSectionMark } from './lesson-section-mark';
import { PlaygroundFullscreen } from './playground-fullscreen';
import {
  ArrowLeft,
  BookOpen,
  Clapperboard,
  MessageCircle,
  Play,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { LessonAnnotations } from './lesson-annotations';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  lessonPlanSchema,
  lessonPlanRequestSchema,
  lessonTemplate,
  initialLessonActivityState,
  type LessonPlan,
  type LearningActivity,
} from '@void-space/types';
import { API_PUBLIC_BASE, apiFetch } from '../lib/api';
import { useSession } from '../lib/session';
import { LearningLayout, Panel, Notice, control, action } from './learning-ui';
import { AgentActivity, type AgentActivityStep } from './agent-activity';
import { LessonSources } from './lesson-sources';
import { LessonSectionEditor } from './lesson-section-editor';
import { SketchfabWorkbench } from './sketchfab-workbench';
import { LessonActivity } from './lesson-activity';
function visualSourceUrl(activity?: LearningActivity) {
  return activity?.scene.kind === 'diagram' && activity.scene.imageSourceId
    ? `${API_PUBLIC_BASE}/learning/sources/${activity.scene.imageSourceId}/file`
    : undefined;
}
interface Draft {
  id: string;
  revision: number;
  definition: LessonPlan;
  release?: {
    id: string;
    tenantId: string;
    revision: number;
    reviewed?: boolean;
    visibility?: 'private' | 'institution' | 'public';
  } | null;
}
interface Asset {
  id: string;
  name: string;
  versionId: string;
  cid: string;
  format: 'glb' | 'gltf' | 'obj' | 'fbx';
  polycount: number | null;
  attribution: string;
  meshCount: number | null;
}
interface Task {
  kind?: string;
  progress?: AgentActivityStep[];
  id: string;
  status: string;
  error: string | null;
  result?: { planId?: string; definition?: LessonPlan; baseRevision?: number; proposal?: boolean };
}
export function LessonEditor({ id }: { id?: string }) {
  const router = useRouter(),
    { can, session } = useSession();
  const [topic, setTopic] = useState(''),
    [audience, setAudience] = useState('Learners aged 13+'),
    [duration, setDuration] = useState(30),
    [instructions, setInstructions] = useState(''),
    [sourceIds, setSourceIds] = useState<string[]>([]),
    [assetId, setAssetId] = useState(''),
    [asset, setAsset] = useState<Asset | null>(null),
    [sketchfab, setSketchfab] = useState('');
  const [draft, setDraft] = useState<LessonPlan | null>(null),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false),
    [sectionId, setSectionId] = useState(''),
    [preview, setPreview] = useState(true),
    [annotating, setAnnotating] = useState(false),
    [mobilePanel, setMobilePanel] = useState<'lesson' | 'assistant'>('lesson'),
    [showProposal, setShowProposal] = useState(false),
    [before, setBefore] = useState<LessonPlan | null>(null),
    [restore, setRestore] = useState<LessonPlan | null>(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [taskId, setTaskIdState] = useState(''),
    [instruction, setInstruction] = useState(''),
    [onlySection, setOnlySection] = useState(true),
    [review, setReview] = useState<Record<string, boolean>>({}),
    [visibility, setVisibility] = useState<'private' | 'institution' | 'public'>('private'),
    [release, setRelease] = useState<Draft['release']>(null);
  const storageKey = `lesson-draft:${session?.user.activeTenantId}:${session?.user.id}:${id ?? 'new'}`;
  function setTaskId(next: string) {
    setTaskIdState(next);
    setShowProposal(false);
    if (next) sessionStorage.setItem(`${storageKey}:task`, next);
    else {
      sessionStorage.removeItem(`${storageKey}:task`);
      const url = new URL(location.href);
      if (url.searchParams.has('proposal')) {
        url.searchParams.delete('proposal');
        history.replaceState(null, '', url.pathname + url.search);
      }
    }
  }
  useEffect(() => {
    setTaskIdState(
      new URLSearchParams(location.search).get('proposal') ??
        sessionStorage.getItem(`${storageKey}:task`) ??
        '',
    );
  }, [storageKey]);
  const publishRef = useRef<HTMLDetailsElement>(null);
  const loaded = useRef('');
  const q = useQuery({
    queryKey: ['lesson-draft', id],
    queryFn: () => apiFetch<{ plan: Draft }>(`/learning/lesson-plans/${id}`),
    enabled: !!id,
  });
  const sources = useQuery({
    queryKey: ['learning-sources'],
    queryFn: () =>
      apiFetch<{
        sources: {
          id: string;
          title: string;
          passages: { id: string; page: number; text: string }[];
        }[];
      }>('/learning/sources'),
  });
  const assets = useQuery({
    queryKey: ['lesson-library-assets'],
    queryFn: () =>
      apiFetch<{ items: { id: string; name: string; status: string }[] }>('/assets?pageSize=50'),
    enabled: !id,
  });
  const task = useQuery({
    queryKey: ['lesson-agent-task', taskId],
    queryFn: () => apiFetch<{ task: Task }>(`/learning/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (q) =>
      ['completed', 'failed'].includes(q.state.data?.task.status ?? '') ? false : 1500,
  });
  useEffect(() => {
    if (!q.data || loaded.current === id) return;
    loaded.current = id!;
    const p = q.data.plan;
    setDraft(p.definition);
    setRevision(p.revision);
    setSourceIds(p.definition.sourceIds);
    setSectionId(p.definition.sections[0]!.id);
    setRelease(p.release);
    setVisibility(p.release?.visibility ?? 'private');
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (
        saved?.revision === p.revision &&
        lessonPlanSchema.safeParse(saved.definition).success &&
        JSON.stringify(saved.definition) !== JSON.stringify(p.definition)
      )
        setRestore(saved.definition);
    } catch {}
  }, [q.data, id, storageKey]);
  useEffect(() => {
    if (
      task.data?.task.status === 'completed' &&
      !task.data.task.result?.proposal &&
      task.data.task.result?.planId
    ) {
      setTaskId('');
      router.push(`/console/learn/drafts/${task.data.task.result.planId}`);
    }
  }, [task.data, router]);
  useEffect(() => {
    if (draft && dirty)
      sessionStorage.setItem(storageKey, JSON.stringify({ revision, definition: draft }));
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, dirty, revision, storageKey]);
  useEffect(() => {
    if (!id) setAssetId(new URLSearchParams(location.search).get('asset') ?? '');
  }, [id]);
  useEffect(() => {
    if (!assetId) {
      setAsset(null);
      return;
    }
    let active = true;
    apiFetch<{ asset: Asset }>(`/learning/lesson-plans/assets/${assetId}`)
      .then((r) => {
        if (active) setAsset(r.asset);
      })
      .catch((e) => {
        if (active) {
          setAsset(null);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [assetId]);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if (draft) setMobilePanel('assistant');
    } finally {
      setBusy(false);
    }
  }
  function change(next: LessonPlan) {
    setDraft(next);
    setDirty(true);
    setReview({});
  }
  async function save(): Promise<Draft> {
    if (!draft) throw new Error('Create a lesson structure first.');
    const definition = lessonPlanSchema.parse({ ...draft, sourceIds });
    const r = await apiFetch<{ plan: Draft }>(
      id ? `/learning/lesson-plans/${id}` : '/learning/lesson-plans',
      { method: id ? 'PATCH' : 'POST', body: id ? { revision, definition } : definition },
    );
    setDraft(r.plan.definition);
    setRevision(r.plan.revision);
    setDirty(false);
    sessionStorage.removeItem(storageKey);
    setMessage('Draft saved.');
    if (!id) router.replace(`/console/learn/drafts/${r.plan.id}`);
    return r.plan;
  }
  function requestInput() {
    return lessonPlanRequestSchema.parse({
      topic,
      audience,
      durationMinutes: duration,
      instructions,
      sourceIds,
      ...(asset ? { assetId: asset.id } : {}),
      ...(sketchfab.trim() ? { sketchfabUrl: sketchfab.trim() } : {}),
    });
  }
  function structure() {
    const input = requestInput(),
      def = lessonTemplate(input);
    if (asset) {
      def.assetId = asset.id;
      def.assetVersionId = asset.versionId;
      def.attribution = asset.attribution;
      def.sections[2]!.activity = {
        ...def.sections[3]!.activity!,
        scene: {
          kind: 'model',
          assetId: asset.id,
          media: {
            versionId: asset.versionId,
            cid: asset.cid,
            format: asset.format,
            name: asset.name,
            polycount: asset.polycount ?? 0,
          },
        },
        targets: [],
      };
    }
    setDraft(def);
    setSectionId(def.sections[0]!.id);
    setDirty(true);
    setMessage('Editable structure created. Add reviewed subject content before sharing.');
  }
  const companionSection =
    draft?.sections.find((s) => s.id === sectionId && s.activity?.scene.kind === 'model') ??
    draft?.sections.find(
      (x) => x.kind !== 'quiz' && x.activity && x.activity.scene.kind !== 'none',
    );
  const selected = draft?.sections.find((s) => s.id === sectionId) ?? draft?.sections[0];
  const proposal = task.data?.task.result?.proposal ? task.data.task.result.definition : null;
  const sum = draft?.sections.reduce((n, s) => n + s.minutes, 0) ?? 0;
  const stagePlan = showProposal && proposal ? proposal : draft;
  const stageSection =
    stagePlan?.sections.find((s) => s.id === selected?.id) ?? stagePlan?.sections[0];
  const stageCompanion = stagePlan?.sections.find(
    (s) => s.kind !== 'quiz' && s.activity && s.activity.scene.kind !== 'none',
  );
  async function openPlayground(present = false) {
    await work(async () => {
      const current = dirty || !id ? await save() : { id };
      const r = await apiFetch<{ release: { id: string; tenantId: string } }>(
        `/learning/lesson-plans/${current.id}/study`,
        { method: 'POST' },
      );
      router.push(
        `/console/learn/lessons/${r.release.id}?tenant=${r.release.tenantId}${present ? '&present=true' : ''}`,
      );
    });
  }
  const assistantPanel = draft ? (
    <>
      <section className="playground-assistant-content">
        <header className="playground-assistant-heading">
          <span>
            <Sparkles size={18} />
          </span>
          <div>
            <h2>Lesson assistant</h2>
            <p>Make a change. Keep your place.</p>
          </div>
        </header>
        {error && <Notice error>{error}</Notice>}
        <div className="playground-quick-actions" aria-label="Lesson AI actions">
          {[
            [
              'Simplify explanation',
              'Simplify this explanation with a clear everyday example. Preserve the model, confirmed annotations, sources and timing.',
            ],
            [
              'Improve quiz',
              'Improve the quiz questions and explanations using the lesson sources. Keep explicit correct answer keys and preserve the model and timing.',
            ],
            [
              'Improve recap',
              'Rewrite the recap as clear takeaways and two revision suggestions. Preserve the model, confirmed annotations and total timing.',
            ],
          ].map(([label, prompt]) => (
            <button
              key={label}
              className={action}
              disabled={busy}
              onClick={() => {
                const kind =
                  label === 'Improve quiz'
                    ? 'quiz'
                    : label === 'Improve recap'
                      ? 'recap'
                      : 'explanation';
                const next = draft.sections.find((s) => s.kind === kind);
                if (next) setSectionId(next.id);
                setAnnotating(false);
                setOnlySection(true);
                setInstruction(prompt!);
              }}
            >
              {label}
            </button>
          ))}
          {id && (
            <Link className={action} href={`/console/learn/agent?plan=${id}`}>
              Chat about this lesson
            </Link>
          )}
        </div>
        <div className="playground-request">
          <label className="grid gap-2">
            What should change?
            <textarea
              className={control}
              value={instruction}
              maxLength={3000}
              placeholder="Simplify this explanation and add a worked example"
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={onlySection}
              onChange={(e) => setOnlySection(e.target.checked)}
            />
            Change only the selected section
          </label>
          <button
            className={action}
            disabled={
              !id ||
              busy ||
              instruction.trim().length < 5 ||
              ['queued', 'active'].includes(task.data?.task.status ?? '')
            }
            onClick={() =>
              void work(async () => {
                const p = dirty ? await save() : { id, revision };
                const r = await apiFetch<{ task: Task }>(`/learning/lesson-plans/${id}/revise`, {
                  method: 'POST',
                  body: {
                    revision: p.revision,
                    instruction,
                    ...(onlySection && selected ? { sectionId: selected.id } : {}),
                  },
                });
                setTaskId(r.task.id);
              })
            }
          >
            <Send size={15} /> Propose changes
          </button>
        </div>
        <div className="playground-run" aria-label="Saved AI work">
          {taskId ? (
            <AgentActivity
              steps={task.data?.task.progress ?? []}
              status={task.data?.task.status ?? 'queued'}
            />
          ) : (
            <p>
              Ask for an explanation, a better quiz or a clearer recap. Your lesson stays here while
              the assistant works.
            </p>
          )}
          {task.data?.task.status === 'failed' && (
            <Notice error>
              {task.data.task.error ?? 'The assistant could not finish. Your lesson is unchanged.'}
            </Notice>
          )}
        </div>
        {!id && (
          <p className="text-sm text-ink-dim">Save this structure before asking for revisions.</p>
        )}
        {proposal && (
          <div className="space-y-3 border-t border-hairline pt-4">
            <h3 className="font-semibold">Review the proposal</h3>
            <p className="text-sm text-ink-dim">
              Your current draft stays unchanged until you apply this proposal.
            </p>
            {proposal.sections
              .filter(
                (s) =>
                  JSON.stringify(s) !== JSON.stringify(draft.sections.find((x) => x.id === s.id)),
              )
              .map((s) => (
                <button
                  key={s.id}
                  className={action + ' playground-proposal-section'}
                  onClick={() => {
                    setSectionId(s.id);
                    setAnnotating(false);
                    setPreview(true);
                    setAnnotating(false);
                    setShowProposal(true);
                    setMobilePanel('lesson');
                  }}
                >
                  <Play size={14} />
                  <span>{s.title}</span>
                  <span>{s.minutes} min</span>
                </button>
              ))}
            <button
              className={action}
              onClick={() => {
                setPreview(true);
                setAnnotating(false);
                setShowProposal(!showProposal);
                setMobilePanel('lesson');
              }}
            >
              {showProposal ? 'View current draft' : 'Preview proposal on stage'}
            </button>
            <button
              className={action}
              disabled={busy || dirty}
              onClick={() =>
                void work(async () => {
                  setBefore(draft);
                  const r = await apiFetch<{ plan: Draft }>(`/learning/lesson-plans/${id}/apply`, {
                    method: 'POST',
                    body: { taskId, revision },
                  });
                  setDraft(r.plan.definition);
                  setSourceIds(r.plan.definition.sourceIds);
                  setRevision(r.plan.revision);
                  setDirty(false);
                  setReview({});
                  setTaskId('');
                  setShowProposal(false);
                  setMessage('Proposal applied. Review it before publishing.');
                })
              }
            >
              Apply reviewed proposal
            </button>
            <button
              className={action}
              onClick={() => {
                setTaskId('');
                setShowProposal(false);
              }}
            >
              Keep current lesson
            </button>
          </div>
        )}
        {before && (
          <button
            className={action}
            onClick={() => {
              change(before);
              setBefore(null);
            }}
          >
            Undo last agent change
          </button>
        )}
      </section>
      {can('learning:generate-private') && (
        <Panel>
          <details ref={publishRef} className="lesson-publish">
            <summary>Review and publish</summary>
            <div className="grid gap-3 pt-4">
              <label className="grid gap-2">
                Who can study this lesson?
                <select
                  className={control}
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as typeof visibility)}
                >
                  <option value="private">
                    Private · only me and people I deliberately invite
                  </option>
                  {can('learning:manage') && (
                    <option value="institution">
                      Institution-only · members of this workspace
                    </option>
                  )}
                  <option value="public">Public to everyone · listed in Discover lessons</option>
                </select>
              </label>
              {release && (
                <>
                  <Link
                    className={action}
                    href={`/console/learn/lessons/${release.id}?tenant=${release.tenantId}&present=true`}
                  >
                    Present published lesson
                  </Link>
                  <Link
                    className={action}
                    href={`/console/learn/lessons/${release.id}?tenant=${release.tenantId}`}
                  >
                    Study published lesson
                  </Link>
                </>
              )}
              {visibility === 'public' && (
                <Notice>
                  Anyone can view this lesson’s approved content and visuals. Original PDFs and
                  notes stay private. Confirm that you have the right to share any model or image
                  used here.
                </Notice>
              )}
              <p className="text-sm text-ink-dim">
                Publication creates an immutable release. Later edits stay in a new draft. Uncited
                facts require your independent verification.
              </p>
              {[
                ['facts', 'I reviewed the facts and explanations'],
                ['answers', 'I checked every quiz answer and explanation'],
                ['mappings', 'I previewed the visuals and confirmed component mappings'],
                ['rights', 'I have permission to use and share these materials'],
              ].map(([key, label]) => (
                <label key={key} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={!!review[key!]}
                    onChange={(e) => setReview({ ...review, [key!]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <button
                className={action}
                disabled={
                  busy || !id || !['facts', 'answers', 'mappings', 'rights'].every((k) => review[k])
                }
                onClick={() =>
                  void work(async () => {
                    const current = dirty ? await save() : { revision };
                    const r = await apiFetch<{ release: NonNullable<Draft['release']> }>(
                      `/learning/lesson-plans/${id}/publish`,
                      {
                        method: 'POST',
                        body: {
                          revision: current.revision,
                          visibility,
                          review: {
                            facts: true,
                            answers: true,
                            mappings: true,
                            rights: true,
                          },
                        },
                      },
                    );
                    setRelease(r.release);
                    setRevision(r.release.revision);
                    setMessage('Published. Open the released lesson to share, present or export.');
                  })
                }
              >
                Publish reviewed lesson
              </button>
            </div>
          </details>
        </Panel>
      )}
    </>
  ) : null;

  return (
    <LearningLayout
      playground={!!id || !!draft}
      title={draft?.title ?? 'Create a lesson'}
      description="Start with an idea or an asset. Let the agent draft the lesson, then review it in one place."
    >
      {!draft && error && <Notice error>{error}</Notice>}
      {!draft && message && <Notice>{message}</Notice>}
      {q.error && <Notice error>{q.error.message}</Notice>}
      {id && q.isPending && <Notice>Loading lesson draft…</Notice>}
      {restore && (
        <Notice>
          Unsaved work is available from this browser.{' '}
          <button
            className={action}
            onClick={() => {
              change(restore);
              setRestore(null);
            }}
          >
            Restore unsaved draft
          </button>{' '}
          <button
            className={action}
            onClick={() => {
              sessionStorage.removeItem(storageKey);
              setRestore(null);
            }}
          >
            Discard recovery copy
          </button>
        </Notice>
      )}
      {!draft && !id && (
        <Panel>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 sm:col-span-2">
              What do you want to teach?
              <input
                className={control}
                maxLength={200}
                placeholder="For example, the chambers of the heart"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
            <label className="grid gap-2">
              Lesson duration (minutes)
              <input
                className={control}
                type="number"
                min={5}
                max={180}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
          </div>
          <details className="lesson-options">
            <summary>More options · sources, models and audience</summary>
            <div className="grid gap-4 pt-4">
              {' '}
              <label className="grid gap-2">
                Audience
                <input
                  className={control}
                  maxLength={200}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </label>
              <label className="grid gap-2 sm:col-span-2">
                Anything the agent should focus on?
                <textarea
                  className={control}
                  maxLength={3000}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </label>
              <label className="grid gap-2 sm:col-span-2">
                Library asset (optional)
                <select
                  className={control}
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                >
                  <option value="">Start from a topic</option>
                  {asset && !assets.data?.items?.some((a) => a.id === asset.id) && (
                    <option value={asset.id}>{asset.name}</option>
                  )}
                  {assets.data?.items
                    ?.filter((a) => ['approved', 'published'].includes(a.status))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-2 sm:col-span-2">
                Sketchfab model link (optional)
                <input
                  className={control}
                  type="url"
                  value={sketchfab}
                  onChange={(e) => setSketchfab(e.target.value)}
                  placeholder="https://sketchfab.com/3d-models/…"
                />
              </label>
              <Link className="inline-block underline" href="/console/catalog">
                Find a marketplace model
              </Link>
              <LessonSources selected={sourceIds} onChange={setSourceIds} />
            </div>
          </details>
          <Notice>
            The agent produces an unverified draft. Review facts, quiz answers, component mappings
            and rights before sharing.
          </Notice>
          <div className="flex flex-wrap gap-3">
            <button
              className={action + ' bg-brand text-[#262626]'}
              disabled={
                busy ||
                (!!assetId && !asset) ||
                topic.trim().length < 3 ||
                ['queued', 'active'].includes(task.data?.task.status ?? '')
              }
              onClick={() =>
                void work(async () => {
                  const r = await apiFetch<{ task: Task }>('/learning/lesson-plans/generate', {
                    method: 'POST',
                    body: requestInput(),
                  });
                  setTaskId(r.task.id);
                })
              }
            >
              Ask agent to build lesson
            </button>
            <button
              className={action}
              disabled={busy || (!!assetId && !asset) || topic.trim().length < 3}
              onClick={() => void work(async () => structure())}
            >
              Start with editable structure
            </button>
          </div>
        </Panel>
      )}
      {taskId && !draft && (
        <AgentActivity
          steps={task.data?.task.progress ?? []}
          status={task.data?.task.status ?? 'queued'}
        />
      )}
      {!draft && task.data?.task.status === 'failed' && (
        <Notice error>
          {task.data.task.error ??
            'The agent could not finish. Your saved draft is still available.'}
        </Notice>
      )}
      {draft && (
        <div
          className={'lesson-playground' + (annotating ? ' is-annotating' : '')}
          data-panel={mobilePanel}
        >
          <header className="playground-header">
            <div className="playground-title">
              <Link href="/console/learn" aria-label="Back to lessons">
                <ArrowLeft size={18} />
              </Link>
              <div>
                <span>Lesson playground</span>
                <h1>{draft.title}</h1>
              </div>
            </div>
            <nav aria-label="Lesson modes" className="playground-modes">
              <button aria-current="page">
                <Wand2 size={15} />
                Create
              </button>
              <button
                aria-label="Study privately"
                disabled={busy}
                onClick={() => void openPlayground()}
              >
                <BookOpen size={15} />
                Study
              </button>
              <button
                aria-label="Present draft"
                disabled={busy}
                onClick={() => void openPlayground(true)}
              >
                <Clapperboard size={15} />
                Present
              </button>
            </nav>
            <PlaygroundFullscreen />
          </header>
          <div className="playground-toolbar">
            <button
              className={action}
              disabled={busy || (!dirty && !!id)}
              onClick={() =>
                void work(async () => {
                  await save();
                })
              }
            >
              {busy ? 'Working…' : 'Save draft'}
            </button>
            <button
              className={action}
              onClick={() => {
                setPreview(!preview);
                setAnnotating(false);
                setShowProposal(false);
              }}
            >
              {preview ? 'Edit this lesson' : 'Preview lesson'}
            </button>
            {companionSection?.activity?.scene.kind === 'model' && (
              <button
                className={action}
                aria-pressed={annotating}
                onClick={() => {
                  setAnnotating(!annotating);
                  setShowProposal(false);
                  setMobilePanel('lesson');
                }}
              >
                {annotating ? 'Back to lesson' : 'Model annotations'}
              </button>
            )}
            <span role="status" className="text-sm text-ink-dim">
              {message ||
                `${dirty ? 'Unsaved changes' : 'Saved'} · ${sum}/${draft.durationMinutes} minutes`}
            </span>
            <button
              className={action}
              onClick={() => {
                setMobilePanel('assistant');
                if (publishRef.current) {
                  publishRef.current.open = true;
                  publishRef.current.scrollIntoView({ block: 'nearest' });
                }
              }}
            >
              Review &amp; share
            </button>
          </div>
          <nav className="playground-mobile-tabs" aria-label="Playground panels">
            <button
              aria-pressed={mobilePanel === 'lesson'}
              onClick={() => setMobilePanel('lesson')}
            >
              <Play size={16} />
              Lesson
            </button>
            <button
              aria-pressed={mobilePanel === 'assistant'}
              onClick={() => setMobilePanel('assistant')}
            >
              <MessageCircle size={16} />
              Assistant{proposal ? ' · Proposal ready' : ''}
            </button>
          </nav>
          <div className="playground-body">
            <section className="playground-stage" aria-label="Lesson stage and timeline">
              <aside className="playground-timeline" aria-label="Lesson outline">
                {draft.sections.map((s, i) => (
                  <button
                    key={s.id}
                    aria-current={s.id === selected?.id ? 'step' : undefined}
                    className={
                      action +
                      ' flex w-full items-center justify-between gap-2 text-left ' +
                      (s.id === selected?.id ? 'bg-veil-6' : '')
                    }
                    onClick={() => {
                      setSectionId(s.id);
                      setAnnotating(false);
                      setMobilePanel('lesson');
                    }}
                  >
                    <span className="playground-step-title">
                      <LessonSectionMark kind={s.kind} />
                      <span>
                        {i + 1}. {s.title}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs">{s.minutes} min</span>
                  </button>
                ))}
              </aside>
              <div className="playground-stage">
                <div className="playground-stage-heading">
                  <span>
                    {showProposal && proposal ? 'Proposal preview' : 'Current draft'} ·{' '}
                    {stageSection?.kind}
                  </span>
                  <span>{stageSection?.minutes} min</span>
                </div>
                {showProposal && proposal && (
                  <Notice>
                    Previewing proposed changes. Your saved lesson has not changed.{' '}
                    <button className="underline" onClick={() => setShowProposal(false)}>
                      Return to current draft
                    </button>
                  </Notice>
                )}
                {annotating && companionSection?.activity ? (
                  <LessonAnnotations
                    key={companionSection.id}
                    activity={companionSection.activity}
                    busy={busy || ['queued', 'active'].includes(task.data?.task.status ?? '')}
                    onChange={(activity) =>
                      change({
                        ...draft,
                        sections: draft.sections.map((s) =>
                          s.id === companionSection.id ? { ...s, activity } : s,
                        ),
                      })
                    }
                    onSuggest={async (views, instruction) => {
                      await work(async () => {
                        const current = dirty || !id ? await save() : { id, revision };
                        const response = await apiFetch<{ task: Task }>(
                          `/learning/lesson-plans/${current.id}/annotations`,
                          {
                            method: 'POST',
                            body: {
                              revision: current.revision,
                              sectionId: companionSection.id,
                              instruction:
                                'Create detailed component explanations for this lesson: location, function, relationships and why each component matters. Suggest visible surface pins. Preserve confirmed component IDs. Mark uncertain identities for author review. ' +
                                (instruction ?? ''),
                              ...(views ? { views } : {}),
                            },
                          },
                        );
                        setTaskId(response.task.id);
                      });
                    }}
                  />
                ) : preview && stageSection ? (
                  <Panel>
                    <h2 className="text-2xl font-semibold">{stageSection.title}</h2>
                    <p className="whitespace-pre-wrap leading-relaxed">{stageSection.body}</p>
                    {(stageSection.activity || stageCompanion?.activity) && (
                      <LessonActivity
                        key={`${stageSection.id}:${revision}:${showProposal}`}
                        activity={stageSection.activity ?? stageCompanion!.activity!}
                        companion={
                          stageSection.activity?.scene.kind === 'none'
                            ? stageCompanion?.activity
                            : undefined
                        }
                        visualUrl={visualSourceUrl(
                          stageSection.activity ?? stageCompanion?.activity,
                        )}
                        companionVisualUrl={visualSourceUrl(stageCompanion?.activity)}
                        state={initialLessonActivityState()}
                        onAction={() => {}}
                        preview
                        exploreOnly={!stageSection.activity || stageSection.kind === 'exploration'}
                      />
                    )}
                    {draft.sketchfabUrl && stageSection.kind === 'exploration' && (
                      <SketchfabWorkbench compact initialLink={draft.sketchfabUrl} />
                    )}
                    {stageSection.notes && (
                      <details>
                        <summary>Teaching notes</summary>
                        <p className="whitespace-pre-wrap">{stageSection.notes}</p>
                      </details>
                    )}
                  </Panel>
                ) : (
                  <>
                    <details className="lesson-options">
                      <summary>Lesson details · title, outcomes and timing</summary>
                      <div className="grid gap-4 pt-4">
                        <label className="grid gap-2">
                          Lesson title
                          <input
                            className={control}
                            value={draft.title}
                            onChange={(e) => change({ ...draft, title: e.target.value })}
                          />
                        </label>
                        <label className="grid gap-2">
                          Summary
                          <textarea
                            className={control}
                            value={draft.summary}
                            onChange={(e) => change({ ...draft, summary: e.target.value })}
                          />
                        </label>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="grid gap-2">
                            Audience
                            <input
                              className={control}
                              value={draft.audience}
                              onChange={(e) => change({ ...draft, audience: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-2">
                            Total minutes
                            <input
                              className={control}
                              type="number"
                              min={5}
                              max={180}
                              value={draft.durationMinutes}
                              onChange={(e) =>
                                change({ ...draft, durationMinutes: Number(e.target.value) })
                              }
                            />
                          </label>
                        </div>
                        <label className="grid gap-2">
                          Learning outcomes (one per line)
                          <textarea
                            className={control}
                            value={draft.objectives.join('\n')}
                            onChange={(e) =>
                              change({ ...draft, objectives: e.target.value.split('\n') })
                            }
                          />
                        </label>
                      </div>
                    </details>
                    {selected && (
                      <Panel>
                        <LessonSectionEditor
                          section={selected}
                          sources={
                            sources.data?.sources.filter((s) => sourceIds.includes(s.id)) ?? []
                          }
                          onChange={(next) =>
                            change({
                              ...draft,
                              sections: draft.sections.map((s) => (s.id === next.id ? next : s)),
                            })
                          }
                        />
                      </Panel>
                    )}
                    <details className="lesson-options">
                      <summary>Source materials</summary>{' '}
                      <LessonSources
                        selected={sourceIds}
                        onChange={(ids) => {
                          setSourceIds(ids);
                          change({ ...draft, sourceIds: ids });
                        }}
                      />
                    </details>
                  </>
                )}
              </div>
            </section>
            <aside className="playground-assistant" aria-label="Lesson assistant">
              {assistantPanel}
            </aside>
          </div>
        </div>
      )}
    </LearningLayout>
  );
}
