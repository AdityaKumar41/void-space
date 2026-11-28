'use client';
import Link from 'next/link';
import { LessonSectionMark } from './lesson-section-mark';
import { LessonPresentationControls } from './lesson-presentation-controls';
import { PlaygroundFullscreen } from './playground-fullscreen';
import { ArrowLeft, BookOpen, Clapperboard, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  initialLessonActivityState,
  type LessonPlan,
  type ExperienceState,
} from '@void-space/types';
import { apiFetch, apiDownload, API_PUBLIC_BASE } from '../lib/api';
import { LearningLayout, Panel, Notice, control, action } from './learning-ui';
import { LessonActivity, type LessonAction } from './lesson-activity';
import { SketchfabWorkbench } from './sketchfab-workbench';
interface Progress {
  revision: number;
  state: {
    completed: string[];
    currentSection: string;
    activities: Record<string, ExperienceState>;
    feedback: string;
  };
}
interface Release {
  planId?: string;
  id: string;
  tenantId: string;
  owner: boolean;
  reviewed: boolean;
  visibility: 'private' | 'institution' | 'public';
  definition: LessonPlan;
  sourceExcerpts: {
    sourceId: string;
    passageId: string;
    title: string;
    page: number;
    text: string;
  }[];
}
interface Task {
  id: string;
  status: string;
  error: string | null;
  result?: { format: string };
}
export function LessonPlanPlayer({ id }: { id: string }) {
  const [tenant, setTenant] = useState(''),
    [present, setPresent] = useState(false),
    [presenterTools, setPresenterTools] = useState(false),
    [sectionId, setSectionId] = useState(''),
    [progress, setProgress] = useState<Progress | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState(''),
    [shareId, setShareId] = useState(''),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState(''),
    [answerTarget, setAnswerTarget] = useState(''),
    [coachBusy, setCoachBusy] = useState(false),
    [taskId, setTaskId] = useState(''),
    [presentationTarget, setPresentationTarget] = useState<string | null>(null),
    [showAnswers, setShowAnswers] = useState(false);
  const pending = useRef<{
    eventKey: string;
    revision: number;
    sectionId: string;
    kind: 'complete' | 'activity';
    action?: unknown;
  } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setTenant(q.get('tenant') ?? '');
    setPresent(q.get('present') === 'true');
    localStorage.setItem('void-workspace-mode', 'learning');
    window.dispatchEvent(new Event('void-workspace-mode'));
  }, []);
  const q = useQuery({
    queryKey: ['lesson-release', id, tenant, present],
    queryFn: () =>
      apiFetch<{ release: Release; progress: Progress }>(
        `/learning/lesson-plans/releases/${id}?tenant=${tenant}${present ? '&present=true' : ''}`,
      ),
    enabled: !!tenant,
    retry: false,
  });
  const shares = useQuery({
    queryKey: ['lesson-shares', id],
    queryFn: () =>
      apiFetch<{ shares: { id: string; revokedAt: string | null }[] }>(
        `/learning/lesson-plans/releases/${id}/shares`,
      ),
    enabled: !!q.data?.release.owner,
  });
  const task = useQuery({
    queryKey: ['lesson-export', taskId],
    queryFn: () => apiFetch<{ task: Task }>(`/learning/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (q) =>
      ['completed', 'failed'].includes(q.state.data?.task.status ?? '') ? false : 1500,
  });
  useEffect(() => {
    if (q.data) {
      setProgress(q.data.progress);
      setSectionId((v) => v || q.data!.progress.state.currentSection);
    }
  }, [q.data]);
  const r = q.error ? undefined : q.data?.release,
    def = r?.definition,
    s = def?.sections.find((s) => s.id === sectionId) ?? def?.sections[0],
    index = def?.sections.findIndex((x) => x.id === s?.id) ?? 0;
  useEffect(() => {
    setPresentationTarget(null);
    setShowAnswers(false);
    setAnswer('');
    setAnswerTarget('');
  }, [s?.id, s?.minutes]);
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
  async function event(kind: 'complete' | 'activity', act?: LessonAction) {
    if (!progress || !s) return;
    const saved = pending.current ?? {
      eventKey: crypto.randomUUID(),
      revision: progress.revision,
      sectionId: s.id,
      kind,
      ...(act ? { action: { ...act, eventKey: crypto.randomUUID(), revision: 0 } } : {}),
    };
    pending.current = saved;
    try {
      const next = await apiFetch<Progress>(
        `/learning/lesson-plans/releases/${id}/events?tenant=${tenant}`,
        { method: 'POST', body: saved },
      );
      setProgress(next);
      pending.current = null;
      if (kind === 'complete') setSectionId(next.state.currentSection);
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        pending.current = null;
        const fresh = await q.refetch();
        if (fresh.data) setProgress(fresh.data.progress);
      }
      throw e;
    }
  }
  const companionSection = def?.sections.find(
    (x) => x.kind !== 'quiz' && x.activity && x.activity.scene.kind !== 'none',
  );
  const companionUrl = companionSection
    ? `${API_PUBLIC_BASE}/learning/lesson-plans/releases/${id}/visual?tenant=${tenant}&section=${companionSection.id}`
    : undefined;
  const completed = progress?.state.completed.length ?? 0,
    done = !!def && completed === def.sections.length;
  const state = s
    ? (progress?.state.activities[s.id] ?? initialLessonActivityState())
    : initialLessonActivityState();
  const refs = s
    ? [...s.sourceRefs, ...(s.activity?.targets.flatMap((t) => t.sourceRefs) ?? [])]
    : [];
  const excerpts =
    r?.sourceExcerpts.filter((x) =>
      refs.some((y) => x.sourceId === y.sourceId && x.passageId === y.passageId),
    ) ?? [];
  const download = async () => {
    const blob = await apiDownload(`/learning/lesson-plans/exports/${taskId}/file`);
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `void-space-lesson.${task.data?.task.result?.format ?? 'pdf'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <LearningLayout
      playground={true}
      title={def?.title ?? 'Open lesson'}
      description={
        present
          ? 'Presentation view · follow the lesson at your own pace.'
          : 'Explore the material, practise and save your own learning progress.'
      }
    >
      {q.isPending && tenant && <Notice>Loading lesson…</Notice>}
      {!tenant && <Notice>Open this lesson from Lessons or use its complete sharing link.</Notice>}
      {q.error && (
        <Notice error>
          {q.error.message}{' '}
          <Link className="underline" href="/console/learn/join">
            Open another code
          </Link>
        </Notice>
      )}
      {error && (
        <Notice error>
          {error}{' '}
          {pending.current && (
            <button
              className={action}
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await event(pending.current!.kind);
                })
              }
            >
              Retry the saved interaction
            </button>
          )}
        </Notice>
      )}
      {def && r && s && (
        <div
          className={
            'lesson-playground lesson-playback' +
            (present ? ' is-presenting' : '') +
            (presenterTools ? ' show-presenter-tools' : '')
          }
        >
          <header className="playground-header">
            <div className="playground-title">
              <Link href="/console/learn" aria-label="Back to lessons">
                <ArrowLeft size={18} />
              </Link>
              <div>
                <span>{present ? 'Presenting lesson' : 'Study playground'}</span>
                <h1>{def.title}</h1>
              </div>
            </div>
            <nav className="playground-modes" aria-label="Lesson modes">
              {r.owner && r.planId && (
                <Link href={`/console/learn/drafts/${r.planId}`}>
                  <Wand2 size={15} />
                  Create
                </Link>
              )}
              <a
                aria-current={!present ? 'page' : undefined}
                aria-label={present ? 'Switch to study' : 'Study mode'}
                href={`/console/learn/lessons/${id}?tenant=${tenant}`}
              >
                <BookOpen size={15} />
                Study
              </a>
              {r.owner && (
                <a
                  aria-current={present ? 'page' : undefined}
                  aria-label="Present lesson"
                  href={`/console/learn/lessons/${id}?tenant=${tenant}&present=true`}
                >
                  <Clapperboard size={15} />
                  Present
                </a>
              )}
            </nav>
            {present && (
              <button
                className={action}
                aria-pressed={presenterTools}
                onClick={() => setPresenterTools(!presenterTools)}
              >
                {presenterTools ? 'Hide presenter tools' : 'Presenter tools'}
              </button>
            )}
            <PlaygroundFullscreen />
          </header>
          {!r.reviewed && (
            <Notice>
              Private study snapshot · this material has not been published or verified. It cannot
              be shared with other learners.
            </Notice>
          )}
          <div className="playground-toolbar">
            <span className="text-sm text-ink-dim">
              {def.durationMinutes} min · {def.audience}
            </span>
            {r.owner && (
              <>
                <Link className={action} href="/console/learn">
                  My lesson drafts
                </Link>
              </>
            )}
            <span className="ml-auto text-sm" role="status">
              {busy
                ? 'Saving…'
                : present
                  ? 'Presentation does not change learner progress'
                  : `${completed}/${def.sections.length} sections saved`}
            </span>
          </div>
          <div className="playground-playback-body">
            <nav aria-label="Lesson sections" className="playground-timeline">
              {def.sections.map((x, i) => (
                <button
                  key={x.id}
                  disabled={busy || !!pending.current}
                  className={
                    action +
                    ' lesson-step flex w-full justify-between gap-2 text-left ' +
                    (s.id === x.id ? 'bg-veil-6' : '')
                  }
                  aria-current={s.id === x.id ? 'step' : undefined}
                  onClick={() => setSectionId(x.id)}
                >
                  <span className="playground-step-title">
                    <LessonSectionMark kind={x.kind} />
                    <span>
                      {i + 1}. {x.title}
                      {progress?.state.completed.includes(x.id) ? ' ✓' : ''}
                    </span>
                  </span>
                  <span className="text-xs">{x.minutes}m</span>
                </button>
              ))}
            </nav>
            <div className="playground-stage space-y-5">
              <Panel>
                <header className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-ink-dim">
                      {s.kind} · {s.minutes} minutes
                    </p>
                    <h2
                      className={
                        'mt-2 font-semibold tracking-tight ' +
                        (present ? 'text-3xl sm:text-4xl' : 'text-2xl')
                      }
                    >
                      {s.title}
                    </h2>
                  </div>
                </header>
                <p
                  className={
                    'max-w-prose whitespace-pre-wrap leading-relaxed ' + (present ? 'text-xl' : '')
                  }
                >
                  {s.body}
                </p>
                {(s.activity || companionSection?.activity) && (
                  <LessonActivity
                    key={s.id}
                    presentationTarget={present ? presentationTarget : undefined}
                    activity={s.activity ?? companionSection!.activity!}
                    companion={
                      s.activity?.scene.kind === 'none' ? companionSection?.activity : undefined
                    }
                    companionVisualUrl={companionUrl}
                    coaching={{ targetId: answerTarget, answer, busy: coachBusy }}
                    state={present ? initialLessonActivityState() : state}
                    busy={busy || !!pending.current}
                    onAction={(a) =>
                      void work(async () => {
                        await event('activity', a);
                      })
                    }
                    preview={!s.activity || (present && r.owner)}
                    exploreOnly={!s.activity || s.kind === 'exploration'}
                    visualUrl={
                      s.activity
                        ? `${API_PUBLIC_BASE}/learning/lesson-plans/releases/${id}/visual?tenant=${tenant}&section=${s.id}`
                        : companionUrl
                    }
                    onAsk={
                      (s.kind === 'quiz' && state.status !== 'completed') || present
                        ? undefined
                        : (targetId) =>
                            void work(async () => {
                              setAnswerTarget(targetId);
                              setAnswer('');
                              setCoachBusy(true);
                              try {
                                const value = await apiFetch<{ answer: string }>(
                                  `/learning/lesson-plans/releases/${id}/mentor?tenant=${tenant}`,
                                  {
                                    method: 'POST',
                                    body: {
                                      sectionId:
                                        s.activity?.scene.kind !== 'none' && s.activity
                                          ? s.id
                                          : companionSection!.id,
                                      targetId,
                                      question:
                                        'Explain this component using the reviewed lesson material.',
                                    },
                                  },
                                );
                                setAnswer(value.answer);
                              } finally {
                                setCoachBusy(false);
                              }
                            })
                    }
                  />
                )}
                {def.sketchfabUrl && s.kind === 'exploration' && (
                  <SketchfabWorkbench compact initialLink={def.sketchfabUrl} />
                )}
                {present && r.owner && s.notes && (
                  <details className="presentation-extra">
                    <summary className="cursor-pointer py-2">Speaker notes</summary>
                    <p className="whitespace-pre-wrap">{s.notes}</p>
                  </details>
                )}
                {present && r.owner && s.activity && (
                  <div className="space-y-3 presentation-extra">
                    <button className={action} onClick={() => setShowAnswers(!showAnswers)}>
                      {showAnswers ? 'Hide answers' : 'Reveal reviewed answers'}
                    </button>
                    {showAnswers &&
                      s.activity.steps.map((q) => (
                        <p className="rounded-lg border border-hairline p-3" key={q.id}>
                          {q.instruction}
                          <br />
                          {q.kind === 'choice'
                            ? q.choices
                                .filter((c) => q.correctIds.includes(c.id))
                                .map((c) => c.label)
                                .join('; ')
                            : q.kind === 'identify'
                              ? s.activity!.targets.find((t) => t.id === q.targetId)?.label
                              : q.kind === 'order'
                                ? q.correctOrder
                                    .map((id) => q.items.find((x) => x.id === id)?.label)
                                    .join(' → ')
                                : q.kind === 'match'
                                  ? Object.entries(q.pairs)
                                      .map(
                                        ([a, b]) =>
                                          `${q.left.find((x) => x.id === a)?.label}: ${q.right.find((x) => x.id === b)?.label}`,
                                      )
                                      .join('; ')
                                  : q.kind === 'operate'
                                    ? q.operation
                                    : 'Formative reflection'}
                          <br />
                          {q.explanation}
                        </p>
                      ))}
                  </div>
                )}
                {!present && (
                  <div className="space-y-2" aria-busy={busy}>
                    <button
                      className={action}
                      disabled={
                        busy ||
                        !!pending.current ||
                        (['quiz', 'practice'].includes(s.kind) && state.status !== 'completed')
                      }
                      onClick={() =>
                        void work(async () => {
                          await event('complete');
                        })
                      }
                    >
                      {progress?.state.completed.includes(s.id)
                        ? 'Continue'
                        : s.kind === 'recap'
                          ? 'Finish lesson'
                          : 'Save and continue'}
                    </button>
                    {busy && (
                      <p role="status" className="text-sm text-ink-dim">
                        Saving your progress…
                      </p>
                    )}
                  </div>
                )}
              </Panel>
              {!!excerpts.length && (
                <details className="rounded-xl border border-hairline p-4">
                  <summary className="cursor-pointer">Sources for this section</summary>
                  {excerpts.map((x) => (
                    <blockquote
                      className="mt-4 border-l-2 border-hairline pl-4 text-sm"
                      key={`${x.sourceId}:${x.passageId}`}
                    >
                      {x.text}
                      <cite className="mt-2 block">
                        {x.title} · page {x.page}
                      </cite>
                    </blockquote>
                  ))}
                </details>
              )}
              {!present && (s.kind !== 'quiz' || state.status === 'completed') && (
                <Panel>
                  <h3 className="font-semibold">Ask about this section</h3>
                  <label className="grid gap-2">
                    Your question
                    <textarea
                      className={control}
                      maxLength={1000}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                  </label>
                  <button
                    className={action}
                    disabled={busy || question.trim().length < 3}
                    onClick={() =>
                      void work(async () => {
                        setAnswerTarget('');
                        const value = await apiFetch<{ answer: string }>(
                          `/learning/lesson-plans/releases/${id}/mentor?tenant=${tenant}`,
                          { method: 'POST', body: { sectionId: s.id, question } },
                        );
                        setAnswer(value.answer);
                      })
                    }
                  >
                    Ask AI
                  </button>
                  <p className="text-sm text-ink-dim">
                    Uses reviewed lesson material. If AI is unavailable, source-based help remains
                    available.
                  </p>
                  {answer && !answerTarget && <Notice>{answer}</Notice>}
                </Panel>
              )}
              {(done || s.kind === 'recap') && (
                <Panel>
                  <h2 className="text-2xl font-semibold">
                    {done ? 'Your lesson recap' : 'Lesson takeaways'}
                  </h2>
                  <p>{def.summary}</p>
                  <ul className="list-disc space-y-2 pl-5">
                    {def.objectives.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  {Object.entries(progress?.state.activities ?? {})
                    .filter(([, v]) => v.mistakes > 0)
                    .map(([sid, v]) => (
                      <p key={sid}>
                        Revisit {def.sections.find((x) => x.id === sid)?.title}: {v.mistakes}{' '}
                        incorrect interactions before completion.
                      </p>
                    ))}
                  <p className="text-sm text-ink-dim">
                    Your practice feedback is formative. It is not a certificate or professional
                    assessment.
                  </p>
                </Panel>
              )}
              <details className="lesson-options" open={done || s.kind === 'recap'}>
                <summary>Export and sharing</summary>
                <div className="space-y-4 pt-4">
                  <h2 className="text-lg font-semibold">Keep or share this lesson</h2>
                  {r.owner && r.reviewed && (
                    <label className="grid max-w-xl gap-2">
                      Lesson visibility
                      <select
                        className={control}
                        value={r.visibility}
                        disabled={busy}
                        onChange={(e) =>
                          void work(async () => {
                            await apiFetch(`/learning/lesson-plans/releases/${id}/visibility`, {
                              method: 'PATCH',
                              body: { visibility: e.target.value },
                            });
                            await q.refetch();
                          })
                        }
                      >
                        <option value="private">Private · explicit invitations only</option>
                        <option value="institution">Institution-only · workspace members</option>
                        <option value="public">Public to everyone</option>
                      </select>
                    </label>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {[
                      ['pdf', 'student', 'Download personal PDF'],
                      ...(r.owner
                        ? [
                            ['pdf', 'teacher', 'Export teacher PDF'],
                            ['pptx', 'teacher', 'Export editable PPTX'],
                          ]
                        : []),
                    ].map(([format, audience, label]) => (
                      <button
                        className={action}
                        key={`${format}-${audience}`}
                        disabled={
                          busy || ['queued', 'active'].includes(task.data?.task.status ?? '')
                        }
                        onClick={() =>
                          void work(async () => {
                            const value = await apiFetch<{ task: Task }>(
                              `/learning/lesson-plans/releases/${id}/exports?tenant=${tenant}`,
                              { method: 'POST', body: { format, audience } },
                            );
                            setTaskId(value.task.id);
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {taskId && (
                    <Notice>
                      {task.data?.task.status === 'completed' ? (
                        <button className={action} onClick={() => void work(download)}>
                          Save export file
                        </button>
                      ) : task.data?.task.status === 'failed' ? (
                        task.data.task.error
                      ) : (
                        'Preparing your file in the background…'
                      )}
                    </Notice>
                  )}
                  {r.owner && r.reviewed && (
                    <div className="space-y-3 border-t border-hairline pt-4">
                      <p className="text-sm text-ink-dim">
                        Students sign in and open this code. It grants only lesson access; their
                        answers stay private.
                      </p>
                      <button
                        className={action}
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            const value = await apiFetch<{ code: string; shareId: string }>(
                              `/learning/lesson-plans/releases/${id}/shares`,
                              { method: 'POST' },
                            );
                            setCode(value.code);
                            setShareId(value.shareId);
                            await shares.refetch();
                          })
                        }
                      >
                        Create lesson link
                      </button>
                      {code && (
                        <div className="space-y-3">
                          <label className="grid gap-2">
                            Lesson sharing link
                            <input
                              readOnly
                              className={control}
                              value={`${location.origin}/learn/join?code=${code}`}
                            />
                          </label>
                          <label className="grid gap-2">
                            Lesson code
                            <input readOnly className={control} value={code} />
                          </label>
                        </div>
                      )}
                      {shares.data?.shares
                        .filter((x) => !x.revokedAt)
                        .map((x) => (
                          <button
                            key={x.id}
                            className={action}
                            disabled={busy}
                            onClick={() =>
                              void work(async () => {
                                await apiFetch(`/learning/lesson-plans/shares/${x.id}`, {
                                  method: 'DELETE',
                                });
                                if (x.id === shareId) setCode('');
                                await shares.refetch();
                              })
                            }
                          >
                            Revoke {x.id === shareId ? 'this link' : `link ${x.id.slice(0, 6)}`}
                          </button>
                        ))}
                    </div>
                  )}
                  {def.attribution && (
                    <p className="whitespace-pre-wrap text-sm text-ink-dim">
                      Attribution: {def.attribution}
                    </p>
                  )}
                </div>
              </details>
            </div>
          </div>
          {present && (
            <LessonPresentationControls
              section={s}
              index={index}
              sections={def.sections}
              targets={
                ['exploration', 'explanation', 'practice'].includes(s.kind)
                  ? ((s.activity ?? companionSection?.activity)?.targets.filter(
                      (t) => t.placement !== 'unplaced',
                    ) ?? [])
                  : []
              }
              onNavigate={setSectionId}
              onTarget={setPresentationTarget}
            />
          )}
        </div>
      )}
    </LearningLayout>
  );
}
