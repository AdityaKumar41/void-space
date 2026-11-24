'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
      {q.error && <Notice error>{q.error.message}</Notice>}
      <section className="divide-y divide-hairline">
        {q.data?.lessons
          .filter((l) => `${l.title} ${l.summary}`.toLowerCase().includes(search.toLowerCase()))
          .map((l) => (
            <article key={l.id} className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <h2 className="text-xl font-semibold">{l.title}</h2>
                <p className="mt-2 max-w-prose text-sm text-ink-dim">{l.summary}</p>
                <p className="mt-3 text-xs text-ink-dim">
                  {l.durationMinutes} min · {l.audience} · {l.authorLabel}
                </p>
              </div>
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
            </article>
          ))}
      </section>
      {q.data && !q.data.lessons.length && (
        <Notice>
          No public lessons yet. Create a lesson with your agent, review it and choose Public to
          everyone when publishing.{' '}
          <Link className="underline" href="/console/learn/agent">
            Start with your agent
          </Link>
        </Notice>
      )}
    </LearningLayout>
  );
}
