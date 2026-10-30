'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ConsoleThumb } from '../../../components/console-kit';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { Button } from '../../../components/ui/button';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';
import { ExperienceBuilder } from '../../../components/experience-builder';
import { ExperiencePlayer } from '../../../components/experience-player';
interface Scenario {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'published';
  interactive: boolean;
  taskCount: number;
  media: { name: string; cid: string } | null;
}
export default function SimulationsPage() {
  const { can } = useSession();
  const manage = can('learning:manage');
  const scenarios = useQuery({
    queryKey: ['simulations', manage],
    queryFn: () =>
      apiFetch<{ scenarios: Scenario[] }>(`/simulations${manage ? '?includeDrafts=true' : ''}`),
  });
  const [active, setActive] = useState<Scenario | null>(null);
  const params = useSearchParams();
  useEffect(() => {
    const id = params.get('experience');
    const found = scenarios.data?.scenarios.find(
      (s) => s.id === id && s.interactive && s.status === 'published',
    );
    if (found) setActive(found);
  }, [params, scenarios.data]);
  const [editing, setEditing] = useState<string | null | false>(false);
  const refresh = () => {
    setEditing(false);
    void scenarios.refetch();
  };
  if (editing !== false)
    return <ExperienceBuilder key={editing ?? 'new'} id={editing ?? undefined} close={refresh} />;
  if (active)
    return (
      <ExperiencePlayer
        key={active.id}
        scenarioId={active.id}
        title={active.title}
        close={() => setActive(null)}
      />
    );
  if (scenarios.isLoading) return <LoadingBlock label="Loading practice experiences" />;
  if (scenarios.error) return <ErrorNote message={(scenarios.error as Error).message} />;
  const interactive = scenarios.data?.scenarios.filter((s) => s.interactive) ?? [];
  const legacy = scenarios.data?.scenarios.filter((s) => !s.interactive) ?? [];
  return (
    <div className="space-y-8 experience-hub">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-6">
        <div>
          <p className="eyebrow">Practice</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-ink">
            Spatial learning experiences
          </h1>
          <p className="mt-3 max-w-2xl text-ink-dim">
            Explore an approved object, perform tasks in its 3D scene and make decisions with
            visible consequences. Resume your work and replay the actions that led to a result.
          </p>
        </div>
        {manage ? <Button onClick={() => setEditing(null)}>Build an experience</Button> : null}
      </header>
      {!interactive.length ? (
        <div className="grid items-center gap-8 border-y border-hairline py-12 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="text-3xl font-semibold leading-tight text-ink">
              The object is the learning environment.
            </p>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-ink-dim">
              An author starts with a reviewed model, places learning targets on its surfaces and
              connects identification, model operations and decisions into a sequence.
            </p>
            {manage ? (
              <Button className="mt-6" variant="outline" onClick={() => setEditing(null)}>
                Create the first spatial experience
              </Button>
            ) : null}
          </div>
          <ol className="divide-y divide-hairline border-l border-hairline pl-6 text-sm text-ink-dim">
            <li className="py-4">01 · Locate components in the actual 3D scene</li>
            <li className="py-4">02 · Explode, isolate and reassemble the model</li>
            <li className="py-4">03 · Respond to a situation and see its consequence</li>
            <li className="py-4">04 · Review the recorded action sequence</li>
          </ol>
        </div>
      ) : (
        <div className="experience-catalog">
          {interactive.map((scenario) => (
            <article key={scenario.id} className="flex flex-col">
              <div className="experience-cover">
                <ConsoleThumb
                  cid={scenario.media?.cid ?? null}
                  alt={scenario.media?.name ?? scenario.title}
                  seed={scenario.id}
                />
              </div>
              <div className="px-6 pt-6">
                <p className="text-xs font-semibold text-brand">
                  {scenario.status === 'published' ? 'Available to learners' : 'Private draft'} ·{' '}
                  {scenario.taskCount} tasks
                  {scenario.media?.name ? ` · ${scenario.media.name}` : ''}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-ink">{scenario.title}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">
                  {scenario.description}
                </p>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 p-6">
                {scenario.status === 'published' ? (
                  <Button onClick={() => setActive(scenario)}>Enter experience</Button>
                ) : null}
                {manage ? (
                  <Button variant="ghost" onClick={() => setEditing(scenario.id)}>
                    {scenario.status === 'draft' ? 'Continue authoring' : 'View authoring'}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      {legacy.length ? (
        <details className="border-t border-hairline pt-5">
          <summary className="cursor-pointer text-sm text-ink-dim">
            Earlier checklist assessments ({legacy.length})
          </summary>
          <p className="mt-3 max-w-2xl text-xs text-ink-faint">
            These records are preserved. They have no interactive scene or task runtime and are not
            presented as simulations.
          </p>
          <ul className="mt-4 space-y-3">
            {legacy.map((item) => (
              <li key={item.id} className="text-sm text-ink-dim">
                {item.title} · {item.status}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
