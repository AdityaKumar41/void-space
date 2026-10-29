'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Compass, GraduationCap, Users } from 'lucide-react';
import { useSession } from '../../lib/session';
import { apiFetch } from '../../lib/api';
import { ModelStage } from '../../components/model-stage';
import { ConsoleThumb } from '../../components/console-kit';
import { buttonVariants } from '../../components/ui/button';
import { ErrorNote, LoadingBlock } from '../../components/ui/feedback';
interface Course {
  id: string;
  title: string;
  description: string;
  lessons: { id: string; title: string; completed?: boolean }[];
  progress?: { completed: number; total: number };
  enrollment?: { status: string } | null;
}
interface Lesson {
  id: string;
  title: string;
  summary: string;
  media: { cid: string | null } | null;
}
interface Experience {
  id: string;
  title: string;
  description: string;
  interactive: boolean;
  taskCount: number;
  media: { cid: string; format: string; name: string; polycount: number | null };
}
interface Room {
  id: string;
  title: string;
  status: string;
  participants: { userId: string }[];
}
export default function HomePage() {
  const { session, can } = useSession();
  const courses = useQuery({
    queryKey: ['courses'],
    queryFn: () => apiFetch<{ courses: Course[] }>('/courses'),
  });
  const lessons = useQuery({
    queryKey: ['home-lessons'],
    queryFn: () => apiFetch<{ lessons: Lesson[] }>('/lessons'),
  });
  const experiences = useQuery({
    queryKey: ['home-experiences'],
    queryFn: () => apiFetch<{ scenarios: Experience[] }>('/simulations'),
  });
  const rooms = useQuery({
    queryKey: ['home-rooms'],
    queryFn: () => apiFetch<{ rooms: Room[] }>('/spatial/rooms'),
    enabled: can('spatial:join'),
  });
  if (courses.isLoading || lessons.isLoading || experiences.isLoading)
    return <LoadingBlock label="Preparing your learning workspace" />;
  const error = courses.error || lessons.error || experiences.error;
  if (error) return <ErrorNote message={(error as Error).message} />;
  const programs = courses.data?.courses ?? [];
  const enrolled = programs.filter((c) => c.enrollment);
  const completed = enrolled.filter((c) => c.enrollment?.status === 'completed').length;
  const live = rooms.data?.rooms.filter((r) => r.status === 'live') ?? [];
  const featured = experiences.data?.scenarios.find((s) => s.interactive);
  const learning = lessons.data?.lessons ?? [];
  const firstName = session?.user.fullName.split(' ')[0] ?? 'there';
  return (
    <div>
      <div className="learning-welcome">
        <div>
          <p className="mb-2 text-xs text-ink-dim">Your learning workspace</p>
          <h1>Welcome back, {firstName}.</h1>
          <p className="mt-3 text-[13px] text-ink-dim">
            Explore something new. Put what you learn into practice.
          </p>
        </div>
        <Link href="/console/campus" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Browse programs <ArrowRight size={14} />
        </Link>
      </div>
      {featured ? (
        <section className="learning-hero" aria-label="Featured practice experience">
          <div className="learning-hero-copy">
            <span className="flex items-center gap-2 text-xs font-semibold text-brand">
              <Compass size={16} /> Learn through practice
            </span>
            <h2>{featured.title}</h2>
            <p className="line-clamp-3">{featured.description}</p>
            <div className="mt-6 flex flex-wrap items-center gap-5">
              <Link
                href={`/console/simulations?experience=${featured.id}`}
                className={buttonVariants({ variant: 'primary' })}
              >
                Enter experience <ArrowRight size={15} />
              </Link>
              <span className="text-[11px] text-ink-faint">
                {featured.taskCount} interactive tasks
              </span>
            </div>
          </div>
          <ModelStage
            cid={featured.media.cid}
            format={featured.media.format}
            name={featured.media.name}
            polycount={featured.media.polycount}
            compact
            presentation
            className="!h-[340px] !min-h-[280px] !max-h-none"
          />
        </section>
      ) : (
        <section className="learning-hero">
          <div className="learning-hero-copy">
            <span className="text-xs font-semibold text-brand">Start with curiosity</span>
            <h2>Your next skill starts here.</h2>
            <p>Explore guided lessons and programs built from your workspace’s reviewed content.</p>
            <Link
              href="/console/lessons"
              className={buttonVariants({ variant: 'primary', className: 'mt-6' })}
            >
              Explore lessons <ArrowRight size={15} />
            </Link>
          </div>
          <div className="grid place-items-center bg-deeper p-8">
            <BookOpen size={84} strokeWidth={0.7} className="text-ink-faint" />
          </div>
        </section>
      )}
      <section className="learning-stats" aria-label="Your learning overview">
        {[
          { label: 'Programs in progress', value: enrolled.length - completed, icon: BookOpen },
          { label: 'Programs completed', value: completed, icon: GraduationCap },
          { label: 'Rooms live now', value: live.length, icon: Users },
        ].map((stat) => (
          <div key={stat.label} className="learning-stat">
            <div>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
            <div className="learning-stat-icon">
              <stat.icon size={20} strokeWidth={1.5} />
            </div>
          </div>
        ))}
      </section>
      <div className="learning-columns">
        <section>
          <div className="learning-section-head">
            <h2>{enrolled.length ? 'Continue your learning' : 'Explore lessons'}</h2>
            <Link href={enrolled.length ? '/console/campus' : '/console/lessons'}>
              View all <span aria-hidden>↗</span>
            </Link>
          </div>
          {enrolled.length ? (
            <div className="learning-list">
              {enrolled.slice(0, 4).map((course) => {
                const next = course.lessons.find((l) => !l.completed);
                return (
                  <Link
                    key={course.id}
                    className="learning-list-row"
                    href={next ? `/console/lessons?lesson=${next.id}` : '/console/campus'}
                  >
                    <span className="learning-stat-icon">
                      <GraduationCap size={21} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3>{course.title}</h3>
                      <p>
                        {course.progress?.completed ?? 0} of {course.lessons.length} lessons
                        complete
                      </p>
                    </div>
                    <ArrowRight size={16} className="text-ink-faint" />
                  </Link>
                );
              })}
            </div>
          ) : learning.length ? (
            <div className="learning-list">
              {learning.slice(0, 4).map((lesson) => (
                <Link
                  key={lesson.id}
                  className="learning-list-row"
                  href={`/console/lessons?lesson=${lesson.id}`}
                >
                  <div className="h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-deeper">
                    <ConsoleThumb
                      cid={lesson.media?.cid ?? null}
                      alt={lesson.title}
                      seed={lesson.id}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3>{lesson.title}</h3>
                    <p className="line-clamp-1">{lesson.summary}</p>
                  </div>
                  <ArrowRight size={16} className="text-ink-faint" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="learning-section-empty">
              Your workspace has no released lessons yet.{' '}
              {can('learning:manage') ? (
                <Link className="text-brand underline" href="/console/lessons">
                  Create your first lesson.
                </Link>
              ) : (
                'Released lessons will appear here when an author publishes them.'
              )}
            </div>
          )}
        </section>
        <section>
          <div className="learning-section-head">
            <h2>Learn together</h2>
            <Link href="/console/spaces">All spaces ↗</Link>
          </div>
          <div className="learning-list">
            {live.length ? (
              live.slice(0, 3).map((room) => (
                <Link
                  href={`/console/spaces?room=${room.id}`}
                  key={room.id}
                  className="learning-list-row"
                >
                  <span className="learning-stat-icon">
                    <Users size={21} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3>{room.title}</h3>
                    <p>{room.participants.length} present · Live room</p>
                  </div>
                  <ArrowRight size={16} />
                </Link>
              ))
            ) : (
              <div className="p-6">
                <Users size={26} strokeWidth={1.3} className="mb-4 text-ink-faint" />
                <h3 className="font-semibold text-ink">Space to learn together</h3>
                <p className="mt-2 text-xs leading-7 text-ink-dim">
                  Join a shared lesson or practice alongside your team. Live rooms appear here when
                  a facilitator opens one.
                </p>
                <Link
                  href="/console/spaces"
                  className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-brand"
                >
                  Explore spaces <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </div>
          <Link
            href="/console/field-guides"
            className="mt-5 flex items-center gap-4 rounded-xl border border-hairline bg-surface p-5"
          >
            <span className="learning-stat-icon">
              <Compass size={21} />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Guidance at the point of work</h3>
              <p className="mt-1 text-xs text-ink-dim">Open a field guide, one step at a time.</p>
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}
