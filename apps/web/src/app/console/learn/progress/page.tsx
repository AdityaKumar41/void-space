'use client';
import Link from 'next/link';
import { Route, ArrowUpRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../../lib/api';
import { LearningLayout, Notice } from '../../../../components/learning-ui';
export default function Page() {
  const q = useQuery({
    queryKey: ['personal-learning-progress'],
    queryFn: () =>
      apiFetch<{
        lessons: {
          id: string;
          tenantId: string;
          title: string;
          completed: number;
          total: number;
          mistakes: number;
        }[];
      }>('/learning/progress'),
  });
  return (
    <LearningLayout
      title="My progress"
      description="Your own learning history, saved across sessions. Practice feedback is formative, not a professional qualification."
    >
      {q.isPending && <Notice>Loading your learning journey…</Notice>}
      {q.error && <Notice error>{q.error.message}</Notice>}
      <div className="space-y-3">
        {q.data?.lessons.map((l) => (
          <Link
            key={l.id}
            href={`/console/learn/lessons/${l.id}?tenant=${l.tenantId}`}
            className="block rounded-xl border border-hairline p-5 hover:bg-surface-raised"
          >
            <h2 className="font-semibold">{l.title}</h2>
            <p className="mt-2 text-sm text-ink-dim">
              {l.completed === l.total
                ? 'Completed · recap available'
                : `${l.completed}/${l.total} sections completed`}{' '}
              · {l.mistakes ? `${l.mistakes} interactions to revisit` : 'Keep exploring'}
            </p>
            <progress
              className="mt-3 w-full"
              aria-label={`${l.title} completion`}
              value={l.completed}
              max={l.total}
            />
          </Link>
        ))}
      </div>
      {q.data && !q.data.lessons.length && (
        <div className="learning-empty">
          <Route size={38} />
          <h2>Your journey starts with one lesson.</h2>
          <p>Explore a model, try a question and come back here to pick up where you stopped.</p>
          <Link href="/console/learn">
            Find your first lesson <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
    </LearningLayout>
  );
}
