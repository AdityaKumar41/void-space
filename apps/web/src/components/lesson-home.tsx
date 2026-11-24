'use client';
import Link from 'next/link';
import { useLearningProfile } from '../lib/learning-profile';
import { Box, Clock3, ArrowUpRight, Plus, Sparkles, CheckCircle2 } from 'lucide-react';
import { LessonCover, type LessonVisualKind } from './lesson-cover';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';
import { LearningLayout, Panel, Notice, control, action } from './learning-ui';
interface Listing {
  legacyLessons?: { id: string; title: string }[];
  plans: {
    id: string;
    title: string;
    revision: number;
    preview?: {
      kind: LessonVisualKind;
      durationMinutes: number;
      sectionCount: number;
      componentCount: number;
      summary: string;
    };
    releases: { id: string; revision: number; visibility?: string; reviewed: boolean }[];
  }[];
  shared: {
    id: string;
    tenantId: string;
    title: string;
    preview?: { kind: LessonVisualKind; summary: string };
    completed: number;
    total: number;
    durationMinutes: number;
  }[];
}
export function LessonHome() {
  const profile = useLearningProfile();
  const teacher = profile.data?.persona === 'teacher';
  const router = useRouter(),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [importId, setImportId] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const q = useQuery({
    queryKey: ['lesson-plans'],
    queryFn: () => apiFetch<Listing>('/learning/lesson-plans'),
  });
  useEffect(() => {
    localStorage.setItem('void-workspace-mode', 'learning');
    window.dispatchEvent(new Event('void-workspace-mode'));
    setSearch(new URLSearchParams(location.search).get('q') ?? '');
    setReady(true);
  }, []);
  async function example(key: string) {
    setBusy(key);
    setError('');
    try {
      const r = await apiFetch<{ plan: { id: string } }>(`/learning/lesson-plans/examples/${key}`, {
        method: 'POST',
      });
      router.push(`/console/learn/drafts/${r.plan.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }
  return (
    <LearningLayout
      title={teacher ? 'Teaching materials' : 'Lessons'}
      description={
        teacher
          ? 'Prepare, review and share lessons for your institution.'
          : 'Create a lesson around an asset or an idea. Study it and keep what you learn.'
      }
    >
      <div className="learning-start-bar">
        <div>
          <Box size={25} />
          <span>
            <strong>{teacher ? 'Bring your lesson to life.' : 'Learn by exploring.'}</strong>
            <small>Choose a model, then turn it into a session.</small>
          </span>
        </div>
        <Link className="learning-primary" href="/console/learn/library">
          Choose a 3D model <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          className={action + ' bg-brand text-[#262626]'}
          href="/console/learn/agent?intent=lesson"
        >
          <Sparkles className="inline mr-2" size={15} />
          Create lesson
        </Link>
        <Link className={action} href="/console/learn/join">
          Open a lesson code
        </Link>
      </div>
      {error && <Notice error>{error}</Notice>}
      {q.error && (
        <Notice error>
          {q.error.message} <button onClick={() => void q.refetch()}>Retry</button>
        </Notice>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm">
          Find a lesson
          <input
            className={control}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your lessons"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Show
          <select className={control} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All lessons</option>
            <option value="drafts">Drafts</option>
            <option value="published">Published</option>
            <option value="shared">Shared with me</option>
          </select>
        </label>
      </div>
      {q.isPending && <Notice>Loading your lessons…</Notice>}
      {filter !== 'drafts' && filter !== 'published' && !!q.data?.shared.length && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            {teacher ? 'Shared teaching materials' : 'Continue learning'}
          </h2>
          <div className="learning-lesson-grid">
            {q.data.shared
              .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
              .map((s) => (
                <Link
                  className="learning-lesson-card"
                  key={s.id}
                  href={`/console/learn/lessons/${s.id}?tenant=${s.tenantId}`}
                >
                  <LessonCover kind={s.preview?.kind} />
                  <div className="learning-lesson-card-copy">
                    <span className="font-semibold">{s.title}</span>
                    <span className="text-sm text-ink-dim">
                      {teacher
                        ? 'Lesson resource'
                        : s.completed === s.total
                          ? 'Recap ready'
                          : `${s.completed}/${s.total} sections`}{' '}
                      · {s.durationMinutes} min
                    </span>
                    {!teacher && (
                      <progress
                        aria-label={`${s.title} completion`}
                        value={s.completed}
                        max={s.total}
                      />
                    )}
                    <span className="learning-card-action">
                      {teacher ? 'Open material' : 'Continue learning'} <ArrowUpRight size={16} />
                    </span>
                  </div>
                </Link>
              ))}
          </div>
        </section>
      )}
      {filter !== 'shared' && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            {teacher ? 'My teaching materials' : 'My lessons'}
          </h2>
          <div className="learning-lesson-grid">
            {q.data?.plans
              .filter(
                (p) =>
                  p.title.toLowerCase().includes(search.toLowerCase()) &&
                  (filter !== 'drafts' ||
                    !p.releases.some((r) => r.reviewed && r.revision === p.revision)) &&
                  (filter !== 'published' || p.releases.some((r) => r.reviewed)),
              )
              .map((p) => (
                <article key={p.id} className="learning-lesson-card">
                  <LessonCover kind={p.preview?.kind} />
                  <div className="learning-lesson-card-copy">
                    <h3 className="font-semibold">{p.title}</h3>
                    {p.preview && <p className="learning-card-summary">{p.preview.summary}</p>}
                    <span className="text-xs text-ink-dim">
                      {p.releases.find((r) => r.reviewed)?.visibility === 'public'
                        ? 'Public to everyone'
                        : p.releases.find((r) => r.reviewed)?.visibility === 'institution'
                          ? 'Institution-only'
                          : 'Private'}
                    </span>
                    <p className="mt-1 text-sm text-ink-dim">
                      {p.releases.some((r) => r.reviewed)
                        ? `Published${p.releases[0]!.revision !== p.revision ? ' · newer draft' : ''}`
                        : 'Private lesson'}
                    </p>
                    <div className="learning-card-meta">
                      {p.preview && (
                        <>
                          <span>
                            <Clock3 size={14} />
                            {p.preview.durationMinutes} min
                          </span>
                          <span>
                            {p.preview.componentCount
                              ? `${p.preview.componentCount} components`
                              : `${p.preview.sectionCount} steps`}
                          </span>
                        </>
                      )}
                    </div>
                    <Link href={`/console/learn/drafts/${p.id}`} className="learning-card-action">
                      Open lesson <ArrowUpRight size={16} />
                    </Link>
                  </div>
                </article>
              ))}
          </div>
          {q.data && !q.data.plans.length && (
            <Panel>
              <h3 className="font-semibold">Start with something you want to explain</h3>
              <p className="text-ink-dim">
                Choose a model, add your topic and ask the agent for a 30- or 60-minute lesson. You
                can review every section before sharing.
              </p>
            </Panel>
          )}
        </section>
      )}
      {!!q.data?.legacyLessons?.length && (
        <details className="lesson-options">
          <summary>Import a saved lesson</summary>
          <p className="mt-3 text-sm text-ink-dim">
            Bring an existing lesson into this workspace as a new draft. Its original records stay
            saved.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <select
              className={control}
              aria-label="Saved lesson to import"
              value={importId}
              onChange={(e) => setImportId(e.target.value)}
            >
              <option value="">Choose a saved lesson</option>
              {q.data.legacyLessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
            <button
              className={action}
              disabled={!importId || !!busy}
              onClick={() => {
                setBusy(importId);
                setError('');
                void apiFetch<{ plan: { id: string } }>(
                  `/learning/lesson-plans/from-lesson/${importId}`,
                  { method: 'POST' },
                )
                  .then((r) => router.push(`/console/learn/drafts/${r.plan.id}`))
                  .catch((e) => {
                    setError(e.message);
                    setBusy('');
                  });
              }}
            >
              {busy === importId ? 'Importing…' : 'Import as a draft'}
            </button>
          </div>
        </details>
      )}
      <section className="learning-examples" aria-label="Explore examples">
        <div>
          <h2>Try a complete example</h2>
          <p>Start exploring now. No setup or AI generation needed.</p>
        </div>
        <div className="learning-lesson-grid">
          {[
            ['geometry', '3D components', 'model', 'Select, isolate and understand each part.'],
            [
              'diagram',
              'An educational diagram',
              'diagram',
              'Follow connections and match components.',
            ],
            [
              'process',
              'A process and sequence',
              'process',
              'Put a workflow in order and test a decision.',
            ],
          ].map(([key, label, kind, description]) => (
            <button
              key={key}
              className="learning-example-card"
              disabled={!ready || !!busy}
              onClick={() => void example(key!)}
              aria-label={label}
            >
              <LessonCover kind={kind as LessonVisualKind} />
              <span>
                <strong>{busy === key ? 'Opening…' : label}</strong>
                <small>{description}</small>
                <ArrowUpRight size={17} />
              </span>
            </button>
          ))}
        </div>
      </section>
    </LearningLayout>
  );
}
