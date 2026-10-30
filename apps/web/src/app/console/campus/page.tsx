'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiFetch } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ErrorNote, EmptyState, LoadingBlock } from '../../../components/ui/feedback';

interface LessonOption {
  id: string;
  title: string;
  summary: string;
  passingScore: number;
}
interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  isPublished: boolean;
  lessons: readonly (LessonOption & { position: number; completed?: boolean })[];
  progress?: { completed: number; total: number };
  enrollment?: { status: string } | null;
}

export default function CampusPage() {
  const { can } = useSession();
  const client = useQueryClient();
  const courses = useQuery({
    queryKey: ['courses'],
    queryFn: () => apiFetch<{ courses: Course[] }>('/courses'),
  });
  const lessons = useQuery({
    queryKey: ['lessons'],
    queryFn: () => apiFetch<{ lessons: LessonOption[] }>('/lessons'),
    enabled: can('learning:manage'),
  });
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [lessonIds, setLessonIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (courses.isLoading) return <LoadingBlock label="Loading programs" />;
  if (courses.error) return <ErrorNote message={(courses.error as Error).message} />;
  async function createCourse() {
    setBusy('create');
    setError(null);
    try {
      await apiFetch('/courses', { method: 'POST', body: { title, slug, description, lessonIds } });
      setTitle('');
      setSlug('');
      setDescription('');
      setLessonIds([]);
      await client.invalidateQueries({ queryKey: ['courses'] });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function publish(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/courses/${id}/publish`, { method: 'POST' });
      await client.invalidateQueries({ queryKey: ['courses'] });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function enroll(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/courses/${id}/enrollments`, { method: 'POST' });
      await client.invalidateQueries({ queryKey: ['courses'] });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-8">
      <header className="border-b border-hairline pb-6">
        <p className="eyebrow">Programs</p>
        <h1 className="mt-2 text-ink">Your learning programs</h1>
        <p className="mt-3 max-w-[65ch] text-ink-dim">
          A program is a sequence of published lessons. A learner finishes it only after every
          assessment in that sequence has passing evidence.
        </p>
      </header>
      {can('learning:manage') ? (
        <details className="rounded-card border border-hairline bg-surface p-5">
          <summary className="cursor-pointer font-semibold text-ink">Build a program</summary>
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Program title"
                className="rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
              />
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="program-slug"
                className="rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
              />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does the learner achieve?"
              className="min-h-20 w-full rounded-control border border-hairline bg-surface p-3 text-sm text-ink"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              {lessons.data?.lessons.map((lesson) => (
                <label
                  key={lesson.id}
                  className="flex cursor-pointer gap-2 rounded-control border border-hairline p-3 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    checked={lessonIds.includes(lesson.id)}
                    onChange={() =>
                      setLessonIds((ids) =>
                        ids.includes(lesson.id)
                          ? ids.filter((id) => id !== lesson.id)
                          : [...ids, lesson.id],
                      )
                    }
                  />
                  <span>{lesson.title}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={
                  busy === 'create' ||
                  !title ||
                  !slug ||
                  description.length < 20 ||
                  lessonIds.length === 0
                }
                onClick={createCourse}
              >
                {busy === 'create' ? 'Creating…' : 'Create draft program'}
              </Button>
              {error ? <span className="text-sm text-state-rejected">{error}</span> : null}
            </div>
          </div>
        </details>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {courses.data?.courses.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {courses.data.courses.map((course) => {
            const done = course.progress?.completed ?? 0;
            const total = course.progress?.total ?? course.lessons.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <Card key={course.id} className="flex flex-col space-y-4 p-5">
                <div>
                  <p className="text-xs font-semibold text-brand">
                    {course.isPublished ? 'Published' : 'Draft'}
                    {course.enrollment ? ` · ${course.enrollment.status}` : ''}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-ink">{course.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-dim">{course.description}</p>
                </div>
                <ol className="space-y-2 text-sm text-ink-dim">
                  {course.lessons.map((lesson, index) => (
                    <li key={lesson.id} className="flex items-baseline justify-between gap-3">
                      <a className="text-ink hover:text-brand" href={`/console/lessons?lesson=${lesson.id}`}>
                        {index + 1}. {lesson.title}
                      </a>
                      <span className="shrink-0 text-xs text-ink-faint">
                        {lesson.completed ? 'Passed' : 'Not passed'}
                      </span>
                    </li>
                  ))}
                </ol>
                <div>
                  <div className="learn-progress" aria-hidden>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-ink-faint">
                    {done} of {total} lessons passed
                  </p>
                </div>
                <div className="mt-auto flex gap-2">
                  {course.isPublished && !course.enrollment ? (
                    <Button disabled={busy === course.id} onClick={() => enroll(course.id)}>
                      {busy === course.id ? 'Joining…' : 'Enroll'}
                    </Button>
                  ) : !course.isPublished && can('learning:manage') ? (
                    <Button disabled={busy === course.id} onClick={() => publish(course.id)}>
                      {busy === course.id ? 'Publishing…' : 'Publish program'}
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No programs yet"
          hint="Authors assemble published lessons into a curriculum. Learners enroll after the program is published."
        />
      )}
    </div>
  );
}
