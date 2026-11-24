'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LessonPlan } from '@void-space/types';
import { apiFetch, API_PUBLIC_BASE } from '../lib/api';
import { Notice, action } from './learning-ui';
const Visual = dynamic(() => import('./learning-visual'), { ssr: false });
export function PublicLearningLesson({ id }: { id: string }) {
  const [sectionId, setSectionId] = useState(''),
    [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['public-lesson', id],
    queryFn: () =>
      apiFetch<{ definition: LessonPlan; lesson: { title: string; tenantId: string } }>(
        `/learning/public-lessons/${id}`,
      ),
    retry: false,
  });
  const d = q.data?.definition,
    s = d?.sections.find((s) => s.id === sectionId) ?? d?.sections[0];
  return (
    <main id="main" className="agent-workspace agent-onboarding">
      <div className="mx-auto max-w-6xl space-y-6 rounded-2xl bg-white p-6 sm:p-10">
        <nav className="flex gap-5 text-sm">
          <Link href="/learn">Void Space</Link>
          <Link href="/learn/discover">Public lessons</Link>
        </nav>
        {q.error && <Notice error>{q.error.message}</Notice>}
        {d && s && (
          <>
            <header className="space-y-3">
              <h1 className="text-3xl font-semibold">{d.title}</h1>
              <p className="max-w-prose text-ink-dim">{d.summary}</p>
              <p className="text-sm text-ink-dim">
                {d.durationMinutes} minutes · {d.audience} · Reviewed by its author
              </p>
              <Link
                className={action + ' inline-block'}
                href={`/login?next=${encodeURIComponent(`/console/learn/discover?lesson=${id}`)}`}
              >
                Sign in to practise and save progress
              </Link>
            </header>
            <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
              <nav className="space-y-2" aria-label="Lesson sections">
                {d.sections.map((x) => (
                  <button
                    key={x.id}
                    className={action + ' w-full text-left'}
                    aria-current={x.id === s.id ? 'step' : undefined}
                    onClick={() => {
                      setSectionId(x.id);
                      setSelected(null);
                    }}
                  >
                    {x.title} · {x.minutes}m
                  </button>
                ))}
              </nav>
              <article className="min-w-0 space-y-4">
                <h2 className="text-2xl font-semibold">{s.title}</h2>
                <p className="max-w-prose whitespace-pre-wrap leading-relaxed">{s.body}</p>
                {s.activity && s.activity.scene.kind !== 'none' && (
                  <Visual
                    activity={s.activity}
                    selected={selected}
                    onSelect={setSelected}
                    exploded={false}
                    isolated={null}
                    visualUrl={`${API_PUBLIC_BASE}/learning/public-lessons/${id}/visual?section=${s.id}`}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {s.activity?.targets.map((t) => (
                    <button key={t.id} className={action} onClick={() => setSelected(t.id)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                {selected && (
                  <p>{s.activity?.targets.find((t) => t.id === selected)?.explanation}</p>
                )}
                {['quiz', 'practice'].includes(s.kind) && (
                  <Notice>
                    Sign in for interactive questions, feedback and your personal recap. Answer keys
                    and private teaching notes are not included in this public view.
                  </Notice>
                )}
              </article>
            </div>
            <p className="text-sm text-ink-dim">{d.attribution}</p>
          </>
        )}
      </div>
    </main>
  );
}
