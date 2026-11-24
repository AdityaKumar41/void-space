'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';
import { LearningLayout, Panel, Notice, control, action } from './learning-ui';
interface Listing {
  legacyLessons?: { id: string; title: string; isPublished: boolean }[];
  plans: {
    id: string;
    title: string;
    revision: number;
    releases: { id: string; revision: number; visibility?: string; reviewed: boolean }[];
  }[];
  shared: {
    id: string;
    tenantId: string;
    title: string;
    completed: number;
    total: number;
    durationMinutes: number;
  }[];
}
export function LessonHome() {
  const router = useRouter(),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
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
      title="Lessons"
      description="Create a lesson around an asset or an idea. Teach it, study it, and keep what you learn."
    >
      <div className="flex flex-wrap gap-3">
        <Link
          className={action + ' bg-brand text-[#172832]'}
          href="/console/learn/agent?intent=lesson"
        >
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
          <h2 className="text-xl font-semibold">Continue learning</h2>
          {q.data.shared
            .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
            .map((s) => (
              <Link
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline p-5 hover:bg-veil-6"
                key={s.id}
                href={`/console/learn/lessons/${s.id}?tenant=${s.tenantId}`}
              >
                <span className="font-semibold">{s.title}</span>
                <span className="text-sm text-ink-dim">
                  {s.completed === s.total ? 'Recap ready' : `${s.completed}/${s.total} sections`} ·{' '}
                  {s.durationMinutes} min
                </span>
              </Link>
            ))}
        </section>
      )}
      {filter !== 'shared' && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">My lessons</h2>
          {q.data?.plans
            .filter(
              (p) =>
                p.title.toLowerCase().includes(search.toLowerCase()) &&
                (filter !== 'drafts' ||
                  !p.releases.length ||
                  p.releases[0]!.revision !== p.revision) &&
                (filter !== 'published' || p.releases.some((r) => r.reviewed)),
            )
            .map((p) => (
              <article
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-hairline p-5"
              >
                <div>
                  <h3 className="font-semibold">{p.title}</h3>
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
                </div>
                <Link href={`/console/learn/drafts/${p.id}`} className={action}>
                  Open lesson
                </Link>
              </article>
            ))}
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
        <details className="rounded-xl border border-hairline p-5">
          <summary className="cursor-pointer font-semibold">Earlier lessons</summary>
          <p className="mt-3 text-sm text-ink-dim">
            Your existing lessons and original attempts remain available. Copy a lesson to work on a
            new draft with your agent.
          </p>
          {q.data.legacyLessons.map((l) => (
            <article
              className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4"
              key={l.id}
            >
              <Link className="underline" href={`/console/lessons?lesson=${l.id}`}>
                {l.title}
              </Link>
              <button
                className={action}
                disabled={!!busy}
                onClick={() => {
                  setBusy(l.id);
                  void apiFetch<{ plan: { id: string } }>(
                    `/learning/lesson-plans/from-lesson/${l.id}`,
                    { method: 'POST' },
                  )
                    .then((r) => router.push(`/console/learn/drafts/${r.plan.id}`))
                    .catch((e) => {
                      setError(e.message);
                      setBusy('');
                    });
                }}
              >
                Copy to new lesson workspace
              </button>
            </article>
          ))}
        </details>
      )}
      <details className="rounded-xl border border-hairline p-5">
        <summary className="cursor-pointer font-semibold">Try a complete example</summary>
        <div className="mt-4 flex flex-wrap gap-3">
          {[
            ['geometry', '3D components'],
            ['diagram', 'An educational diagram'],
            ['process', 'A process and sequence'],
          ].map(([key, label]) => (
            <button
              className={action}
              key={key}
              disabled={!ready || !!busy}
              onClick={() => void example(key!)}
            >
              {busy === key ? 'Opening…' : label}
            </button>
          ))}
        </div>
      </details>
    </LearningLayout>
  );
}
