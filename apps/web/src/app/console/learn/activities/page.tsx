'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { LearningLayout, Panel, Notice, control, action } from '../../../../components/learning-ui';
import { starterCatalog } from '../../../learn/starter-catalog';
interface Activity {
  id: string;
  title: string;
  summary: string;
  kind: string;
  status: string;
  scope: string;
  estimatedMinutes: number;
}
interface Overview {
  assignments: {
    id: string;
    title: string;
    kind: string;
    releaseId: string;
    classroom: { title: string };
  }[];
  continue: { id: string; activityId: string; title: string; mode: string }[];
  review: { activityId: string; title: string; mistakes: number }[];
  achievements: { id: string; title: string }[];
}
export default function LearningHome() {
  const router = useRouter(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [search, setSearch] = useState('');
  const activities = useQuery({
    queryKey: ['learning-activities'],
    queryFn: () => apiFetch<{ activities: Activity[] }>('/learning/activities'),
  });
  const overview = useQuery({
    queryKey: ['learning-overview'],
    queryFn: () => apiFetch<Overview>('/learning/overview'),
  });
  useEffect(() => {
    localStorage.setItem('void-workspace-mode', 'learning');
    window.dispatchEvent(new Event('void-workspace-mode'));
    setSearch(new URLSearchParams(location.search).get('q') ?? '');
  }, []);
  async function open(key: string) {
    setBusy(key);
    setError('');
    try {
      const r = await apiFetch<{ activity: { id: string } }>(`/learning/starters/${key}/import`, {
        method: 'POST',
      });
      router.push(`/console/learn/${r.activity.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }
  return (
    <LearningLayout
      title="Your next step"
      description="Continue where you stopped, complete assigned work or explore something new."
    >
      {error && <Notice error>{error}</Notice>}
      {overview.error && (
        <Notice error>
          {overview.error.message}{' '}
          <button onClick={() => overview.refetch()}>Retry progress</button>
        </Notice>
      )}
      {overview.data && (
        <div className="grid gap-5 md:grid-cols-2">
          <Panel>
            <h2 className="text-xl font-semibold">Continue learning</h2>
            {overview.data.continue.length ? (
              overview.data.continue.map((r) => (
                <p key={r.id}>
                  <Link className="underline" href={`/console/learn/${r.activityId}`}>
                    {r.title} · Resume {r.mode}
                  </Link>
                </p>
              ))
            ) : (
              <p className="text-ink-dim">
                Choose an activity below. Your progress is saved after each action.
              </p>
            )}
          </Panel>
          <Panel>
            <h2 className="text-xl font-semibold">Assigned to you</h2>
            {overview.data.assignments.length ? (
              overview.data.assignments.map((a) => (
                <p key={a.id}>
                  <Link
                    className="underline"
                    href={
                      a.kind === 'activity'
                        ? `/console/learn/${a.releaseId}`
                        : a.kind === 'program'
                          ? `/console/learn/programs/${a.releaseId}`
                          : `/console/lessons?lesson=${a.releaseId}`
                    }
                  >
                    {a.title}
                  </Link>
                  <span className="block text-sm text-ink-dim">{a.classroom.title}</span>
                </p>
              ))
            ) : (
              <p className="text-ink-dim">
                No assigned work.{' '}
                <Link className="underline" href="/console/classes">
                  Join a class
                </Link>{' '}
                or study independently.
              </p>
            )}
          </Panel>
          {overview.data.review.length > 0 && (
            <Panel>
              <h2 className="text-xl font-semibold">Review mistakes</h2>
              {overview.data.review.map((r, i) => (
                <p key={i}>
                  <Link className="underline" href={`/console/learn/${r.activityId}`}>
                    {r.title}
                  </Link>{' '}
                  · {r.mistakes} mistakes to revisit
                </p>
              ))}
            </Panel>
          )}
          {overview.data.achievements.length > 0 && (
            <Panel>
              <h2 className="text-xl font-semibold">Achievements</h2>
              {overview.data.achievements.map((a) => (
                <p key={a.id}>{a.title}</p>
              ))}
            </Panel>
          )}
        </div>
      )}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Reviewed starter activities</h2>
        <p className="text-ink-dim">
          First-party examples for independent practice. Import a private copy to begin.
        </p>
        <div className="divide-y divide-hairline">
          {starterCatalog.map((item) => (
            <article
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-4 py-5"
            >
              <div className="max-w-2xl space-y-1">
                <p className="text-xs text-ink-dim">
                  {item.kind} · {item.estimatedMinutes} min
                </p>
                <h3 className="text-lg font-medium">{item.title}</h3>
                <p className="text-sm text-ink-dim">{item.summary}</p>
              </div>
              <button className={action} disabled={Boolean(busy)} onClick={() => open(item.id)}>
                {busy === item.id ? 'Opening…' : 'Explore activity'}
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Your activities</h2>
        <label className="grid max-w-md gap-2">
          Search learning
          <input
            className={control}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {activities.isPending && <Notice>Loading activities…</Notice>}
        {activities.error && (
          <Notice error>
            {activities.error.message} <button onClick={() => activities.refetch()}>Retry</button>
          </Notice>
        )}
        <div className="divide-y divide-hairline">
          {activities.data?.activities
            .filter((a) => (a.title + ' ' + a.summary).toLowerCase().includes(search.toLowerCase()))
            .map((a) => (
              <article key={a.id} className="space-y-2 py-5">
                <Link className="text-lg font-medium underline" href={`/console/learn/${a.id}`}>
                  {a.title}
                </Link>
                <p className="max-w-2xl text-sm text-ink-dim">{a.summary}</p>
                <p className="text-xs text-ink-dim">
                  {a.kind} · {a.estimatedMinutes} min ·{' '}
                  {a.scope === 'private' ? 'Private practice' : a.status}
                </p>
              </article>
            ))}
        </div>
        {activities.data?.activities.length === 0 && (
          <Notice>Your private practice and published class activities will appear here.</Notice>
        )}
      </section>
    </LearningLayout>
  );
}
