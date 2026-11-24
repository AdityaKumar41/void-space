'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../lib/api';
import { useSession } from '../lib/session';
import { useRouter } from 'next/navigation';
import { LearningLayout, Panel, Notice, control, action } from './learning-ui';
interface Unit {
  id?: string;
  kind: 'lesson' | 'activity' | 'quiz';
  releaseId: string;
  requirement: 'complete_practice' | 'pass_assessment';
}
interface SavedUnit {
  position: number;
  kind: Unit['kind'];
  lessonId: string | null;
  scenarioId: string | null;
  requirement: Unit['requirement'];
  completed: boolean;
  lesson: { id: string; title: string } | null;
  scenario: { id: string; title: string } | null;
}
interface Program {
  course: { id: string; title: string; description: string; isPublished: boolean };
  meta: { outcomes: string[]; level: string; estimatedMinutes: number } | null;
  units: SavedUnit[];
}
export function LearningProgram({ id }: { id?: string }) {
  const { can } = useSession(),
    router = useRouter();
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [units, setUnits] = useState<Unit[]>([]),
    [outcomes, setOutcomes] = useState(''),
    [minutes, setMinutes] = useState(30),
    [level, setLevel] = useState('beginner');
  const program = useQuery({
    queryKey: ['learning-program', id],
    queryFn: () => apiFetch<Program>(`/learning/programs/${id}/units`),
    enabled: !!id,
  });
  const courses = useQuery({
    queryKey: ['courses'],
    queryFn: () =>
      apiFetch<{
        courses: {
          id: string;
          title: string;
          description: string;
          isPublished: boolean;
          enrollment: { status: string } | null;
        }[];
      }>('/courses'),
    enabled: !id,
  });
  const lessons = useQuery({
    queryKey: ['lessons'],
    queryFn: () => apiFetch<{ lessons: { id: string; title: string }[] }>('/lessons'),
    enabled: can('learning:manage'),
  });
  const activities = useQuery({
    queryKey: ['learning-activities'],
    queryFn: () =>
      apiFetch<{ activities: { id: string; title: string; status: string; kind: string }[] }>(
        '/learning/activities',
      ),
    enabled: can('learning:manage'),
  });
  useEffect(() => {
    if (program.data) {
      setUnits(
        program.data.units.map((u) => ({
          kind: u.kind,
          releaseId: u.lessonId ?? u.scenarioId!,
          requirement: u.requirement,
        })),
      );
      setOutcomes(program.data.meta?.outcomes.join('\n') ?? '');
      setMinutes(program.data.meta?.estimatedMinutes ?? 30);
      setLevel(program.data.meta?.level ?? 'beginner');
    }
  }, [program.data]);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await program.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const data = program.data;
  return (
    <LearningLayout
      title={data?.course.title ?? 'Learning programs'}
      description={
        data?.course.description ?? 'Follow an ordered path of lessons, activities and assessments.'
      }
    >
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {program.error && <Notice error>{program.error.message}</Notice>}
      {!id && (
        <>
          {courses.error && <Notice error>{courses.error.message}</Notice>}
          {courses.data?.courses.map((c) => (
            <Panel key={c.id}>
              <Link
                className="text-xl font-semibold underline"
                href={`/console/learn/programs/${c.id}`}
              >
                {c.title}
              </Link>
              <p className="text-ink-dim">{c.description}</p>
              <p className="text-sm">
                {c.enrollment?.status === 'completed'
                  ? 'Achieved'
                  : c.isPublished
                    ? 'Published'
                    : 'Draft'}
              </p>
            </Panel>
          ))}
          {can('learning:manage') && (
            <Panel>
              <h2 className="text-xl font-semibold">Create a connected program</h2>
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void work(async () => {
                    const r = await apiFetch<{ course: { id: string } }>('/learning/programs', {
                      method: 'POST',
                      body: Object.fromEntries(form),
                    });
                    router.push(`/console/learn/programs/${r.course.id}`);
                  });
                }}
              >
                <label className="grid gap-2">
                  Program title
                  <input className={control} name="title" required minLength={3} />
                </label>
                <label className="grid gap-2">
                  Description
                  <textarea className={control} name="description" required minLength={10} />
                </label>
                <button className={action} disabled={busy}>
                  Create program draft
                </button>
              </form>
            </Panel>
          )}
        </>
      )}
      {data && (
        <>
          <Panel>
            <div className="flex flex-wrap gap-5 text-sm text-ink-dim">
              <span>{data.meta?.level ?? 'All levels'}</span>
              <span>{data.meta?.estimatedMinutes ?? '—'} minutes</span>
              <span>
                {data.units.filter((u) => u.completed).length}/{data.units.length} completed
              </span>
            </div>
            {data.meta?.outcomes.length ? (
              <ul className="list-inside list-disc space-y-2">
                {data.meta.outcomes.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-dim">
                This program uses the existing lesson path.{' '}
                <Link className="underline" href="/console/campus">
                  Open legacy programs
                </Link>
              </p>
            )}
            {data.course.isPublished && (
              <button
                className={action}
                disabled={busy}
                onClick={() =>
                  work(async () => {
                    await apiFetch(`/courses/${id}/enrollments`, { method: 'POST' });
                    setMessage(
                      'Enrolled. Completion follows saved server evidence for each required unit.',
                    );
                  })
                }
              >
                Enroll / update completion
              </button>
            )}
          </Panel>
          <ol className="space-y-3">
            {data.units.map((u) => (
              <li key={u.position}>
                <Panel>
                  <p className="text-sm text-ink-dim">
                    {u.position}. {u.kind} ·{' '}
                    {u.requirement === 'pass_assessment'
                      ? 'Pass the assessment'
                      : 'Complete guided practice'}
                  </p>
                  <Link
                    className="text-lg font-semibold underline"
                    href={
                      u.lessonId
                        ? `/console/lessons?lesson=${u.lessonId}`
                        : `/console/learn/${u.scenarioId}`
                    }
                  >
                    {u.lesson?.title ?? u.scenario?.title}
                  </Link>
                  <span className="block text-sm">
                    {u.completed ? 'Completed' : 'Next learning step'}
                  </span>
                </Panel>
              </li>
            ))}
          </ol>
          {can('learning:manage') && !data.course.isPublished && (
            <Panel>
              <h2 className="text-xl font-semibold">Build the ordered path</h2>
              <label className="grid gap-2">
                Outcomes (one per line)
                <textarea
                  className={control}
                  value={outcomes}
                  onChange={(e) => setOutcomes(e.target.value)}
                />
              </label>
              <label className="grid gap-2">
                Level
                <select
                  className={control}
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  {['beginner', 'intermediate', 'advanced'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                Estimated effort in minutes
                <input
                  className={control}
                  type="number"
                  min={1}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              {units.map((unit, i) => (
                <fieldset className="grid gap-3 border-b border-hairline pb-4" key={i}>
                  <legend className="py-2">Unit {i + 1}</legend>
                  <select
                    aria-label={`Unit ${i + 1} release`}
                    className={control}
                    value={`${unit.kind}:${unit.releaseId}`}
                    onChange={(e) => {
                      const [kind, releaseId] = e.target.value.split(':');
                      setUnits((v) =>
                        v.map((u, n) =>
                          n === i ? { ...u, kind: kind as Unit['kind'], releaseId: releaseId! } : u,
                        ),
                      );
                    }}
                  >
                    <option value="activity:">Choose a published release</option>
                    {lessons.data?.lessons.map((l) => (
                      <option key={l.id} value={`lesson:${l.id}`}>
                        Lesson: {l.title}
                      </option>
                    ))}
                    {activities.data?.activities
                      .filter((a) => a.status === 'published')
                      .map((a) => (
                        <option
                          key={a.id}
                          value={`${a.kind === 'none' ? 'quiz' : 'activity'}:${a.id}`}
                        >
                          {a.kind === 'none' ? 'Quiz' : 'Activity'}: {a.title}
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label={`Unit ${i + 1} completion`}
                    className={control}
                    value={unit.requirement}
                    onChange={(e) =>
                      setUnits((v) =>
                        v.map((u, n) =>
                          n === i
                            ? { ...u, requirement: e.target.value as Unit['requirement'] }
                            : u,
                        ),
                      )
                    }
                  >
                    <option value="pass_assessment">Pass assessment</option>
                    {unit.kind === 'activity' && (
                      <option value="complete_practice">Complete guided practice</option>
                    )}
                  </select>
                  <div className="flex gap-2">
                    <button
                      className={action}
                      disabled={i === 0}
                      onClick={() =>
                        setUnits((v) => {
                          const c = [...v];
                          [c[i - 1], c[i]] = [c[i]!, c[i - 1]!];
                          return c;
                        })
                      }
                    >
                      Move up
                    </button>
                    <button
                      className={action}
                      onClick={() => setUnits((v) => v.filter((_, n) => n !== i))}
                    >
                      Remove
                    </button>
                  </div>
                </fieldset>
              ))}
              <button
                className={action}
                onClick={() =>
                  setUnits((v) => [
                    ...v,
                    { kind: 'activity', releaseId: '', requirement: 'pass_assessment' },
                  ])
                }
              >
                Add unit
              </button>
              <div className="flex flex-wrap gap-3">
                <button
                  className={action}
                  disabled={busy || !units.length}
                  onClick={() =>
                    work(async () => {
                      await apiFetch(`/learning/programs/${id}/units`, {
                        method: 'PUT',
                        body: {
                          units,
                          outcomes: outcomes.split('\n').filter(Boolean),
                          level,
                          estimatedMinutes: minutes,
                        },
                      });
                      setMessage('Program path saved.');
                    })
                  }
                >
                  Save path
                </button>
                <button
                  className={action}
                  disabled={busy || !data.units.length}
                  onClick={() =>
                    work(async () => {
                      await apiFetch(`/courses/${id}/publish`, { method: 'POST' });
                      setMessage(
                        'Program published. Referenced releases and completion rules are immutable.',
                      );
                    })
                  }
                >
                  Publish saved program
                </button>
              </div>
            </Panel>
          )}
        </>
      )}
    </LearningLayout>
  );
}
