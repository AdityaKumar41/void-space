'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Compass, ArrowUpRight } from 'lucide-react';
import { LessonCover } from './lesson-cover';
import { apiFetch } from '../lib/api';
import { LearningLayout, Notice, action, control } from './learning-ui';
export function LessonDiscovery() {
  const [search, setSearch] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const router = useRouter();
  const q = useQuery({
    queryKey: ['public-lessons'],
    queryFn: () =>
      apiFetch<{
        lessons: {
          id: string;
          title: string;
          summary: string;
          durationMinutes: number;
          audience: string;
          authorLabel: string;
        }[];
      }>('/learning/public-lessons'),
  });
  useEffect(() => {
    const lesson = new URLSearchParams(location.search).get('lesson');
    if (lesson)
      apiFetch<{ releaseId: string; tenantId: string }>(`/learning/public-lessons/${lesson}/open`, {
        method: 'POST',
      })
        .then((r) => router.replace(`/console/learn/lessons/${r.releaseId}?tenant=${r.tenantId}`))
        .catch((e) => setError(e.message));
  }, []);
  return (
    <LearningLayout
      title="Discover lessons"
      description="Public lessons from independent authors and institutions. Authors review their own material before sharing."
    >
      <label className="grid max-w-lg gap-2">
        Find a subject
        <input className={control} value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {error && <Notice error>{error}</Notice>}
      {q.isPending && <Notice>Finding public lessons…</Notice>}
      {q.error && <Notice error>{q.error.message}</Notice>}
      <section className="learning-lesson-grid">
        {q.data?.lessons
          .filter((l) => `${l.title} ${l.summary}`.toLowerCase().includes(search.toLowerCase()))
          .map((l) => (
            <article key={l.id} className="learning-lesson-card">
              <LessonCover />
              <div className="learning-lesson-card-copy">
                <h2 className="text-xl font-semibold">{l.title}</h2>
                <p className="mt-2 max-w-prose text-sm text-ink-dim">{l.summary}</p>
                <p className="mt-3 text-xs text-ink-dim">
                  {l.durationMinutes} min · {l.audience} · {l.authorLabel}
                </p>
                <button
                  className={action + ' self-start'}
                  disabled={!!busy}
                  onClick={() => {
                    setBusy(l.id);
                    setError('');
                    void apiFetch<{ releaseId: string; tenantId: string }>(
                      `/learning/public-lessons/${l.id}/open`,
                      { method: 'POST' },
                    )
                      .then((r) =>
                        router.push(`/console/learn/lessons/${r.releaseId}?tenant=${r.tenantId}`),
                      )
                      .catch((e) => {
                        setError(e.message);
                        setBusy('');
                      });
                  }}
                >
                  {busy === l.id ? 'Opening…' : 'Study lesson'}
                </button>
              </div>
            </article>
          ))}
      </section>
      {q.data && !q.data.lessons.length && (
        <div className="learning-empty">
          <Compass size={38} />
          <h2>Your next discovery is ahead.</h2>
          <p>
            No public lessons have been shared yet. You can explore a complete example or open a
            lesson code.
          </p>
          <Link href="/console/learn">
            Try an interactive lesson <ArrowUpRight size={16} />
          </Link>
          <Link href="/console/learn/join">Open a lesson code</Link>
        </div>
      )}
    </LearningLayout>
  );
}
