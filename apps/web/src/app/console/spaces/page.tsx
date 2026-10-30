'use client';

import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { apiFetch } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { LessonPlayer, type DeliveryLesson } from '../../../components/lesson-player';
import { ExperiencePlayer } from '../../../components/experience-player';
import { ModelStage } from '../../../components/model-stage';
import { ErrorNote, EmptyState, LoadingBlock } from '../../../components/ui/feedback';

interface Lesson {
  id: string;
  title: string;
  isPublished: boolean;
}
interface Participant {
  userId: string;
  fullName: string;
  pose: unknown;
  lastSeenAt: string;
}
interface Room {
  id: string;
  title: string;
  status: string;
  lessonId: string | null;
  assetId: string | null;
  worldState: Record<string, unknown>;
  participants: readonly Participant[];
  media?: {
    versionId: string;
    cid: string | null;
    format: string;
    polycount: number | null;
  } | null;
}

export default function SpacesPage() {
  const { can } = useSession();
  const cache = useQueryClient();
  const rooms = useQuery({
    queryKey: ['spatial-rooms'],
    queryFn: () => apiFetch<{ rooms: Room[] }>('/spatial/rooms'),
    refetchInterval: 10_000,
  });
  const lessons = useQuery({
    queryKey: ['lessons'],
    queryFn: () => apiFetch<{ lessons: Lesson[] }>('/lessons'),
    enabled: can('spatial:manage'),
  });
  const experiences = useQuery({
    queryKey: ['room-experiences'],
    queryFn: () =>
      apiFetch<{ scenarios: { id: string; title: string; interactive: boolean }[] }>(
        '/simulations',
      ),
    enabled: can('spatial:manage'),
  });
  const [title, setTitle] = useState('');
  const [lessonId, setLessonId] = useState('');
  const params = useSearchParams();
  useEffect(() => {
    const room = params.get('room');
    if (room && rooms.data?.rooms.some((r) => r.id === room && r.status === 'live'))
      setActive(room);
  }, [params, rooms.data]);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (active)
    return (
      <RoomSession
        key={active}
        roomId={active}
        leave={() => {
          setActive(null);
          void cache.invalidateQueries({ queryKey: ['spatial-rooms'] });
        }}
      />
    );
  if (rooms.isLoading) return <LoadingBlock label="Loading shared spaces" />;
  if (rooms.error) return <ErrorNote message={(rooms.error as Error).message} />;
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ room: Room }>('/spatial/rooms', {
        method: 'POST',
        body: {
          title,
          ...(lessonId.startsWith('experience:')
            ? { experienceId: lessonId.slice(11) }
            : { lessonId }),
          worldState: { schemaVersion: 1, annotations: [] },
        },
      });
      await apiFetch(`/spatial/rooms/${result.room.id}/live`, { method: 'POST' });
      setTitle('');
      setLessonId('');
      await cache.invalidateQueries({ queryKey: ['spatial-rooms'] });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-8">
      <header className="border-b border-hairline pb-6">
        <p className="eyebrow">Spaces</p>
        <h1 className="mt-2 text-ink">Shared learning spaces</h1>
        <p className="mt-3 max-w-[65ch] text-ink-dim">
          A space is a live browser session around one published lesson or practice experience.
          People in the room share the current step. Presence drops when a browser stops checking
          in.
        </p>
      </header>
      {can('spatial:manage') ? (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold text-ink">Open a live space</h2>
          <div className="flex flex-wrap gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Space title"
              className="min-w-48 flex-1 rounded-control border border-hairline bg-surface px-3 text-sm text-ink"
            />
            <select
              value={lessonId}
              onChange={(e) => setLessonId(e.target.value)}
              className="rounded-control border border-hairline bg-surface px-3 text-sm text-ink"
            >
              <option value="">Choose a published lesson or experience</option>
              {experiences.data?.scenarios
                .filter((s) => s.interactive)
                .map((s) => (
                  <option key={s.id} value={`experience:${s.id}`}>
                    3D experience · {s.title}
                  </option>
                ))}
              {lessons.data?.lessons
                .filter((lesson) => lesson.isPublished)
                .map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
            </select>
            <Button disabled={busy || !title || !lessonId} onClick={create}>
              {busy ? 'Opening…' : 'Open space'}
            </Button>
          </div>
          {error ? <p className="text-sm text-state-rejected">{error}</p> : null}
        </Card>
      ) : null}
      {rooms.data?.rooms.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rooms.data.rooms.map((room) => (
            <Card key={room.id} className="flex flex-col space-y-3 p-5">
              <p className="text-xs font-semibold text-brand">
                Live · {room.participants.length}{' '}
                {room.participants.length === 1 ? 'person' : 'people'}
              </p>
              <h2 className="text-xl font-semibold text-ink">{room.title}</h2>
              <p className="text-sm leading-relaxed text-ink-dim">
                {room.lessonId
                  ? 'Everyone follows the same lesson step.'
                  : 'Everyone works in the same practice experience.'}
              </p>
              {room.participants.length ? (
                <p className="text-xs text-ink-faint">
                  {room.participants
                    .slice(0, 4)
                    .map((person) => person.fullName)
                    .join(', ')}
                  {room.participants.length > 4 ? ` +${room.participants.length - 4}` : ''}
                </p>
              ) : (
                <p className="text-xs text-ink-faint">No one is in the room right now.</p>
              )}
              <Button className="mt-auto w-fit" onClick={() => setActive(room.id)}>
                Join space
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No live spaces"
          hint="A facilitator opens a space from a published lesson or practice experience. It stays live while someone is present."
        />
      )}
    </div>
  );
}

function RoomSession({ roomId, leave }: { roomId: string; leave: () => void }) {
  const { can } = useSession();
  const cache = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [follow, setFollow] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const room = useQuery({
    queryKey: ['spatial-room', roomId],
    queryFn: () => apiFetch<{ room: Room }>(`/spatial/rooms/${roomId}`),
    refetchInterval: 3_000,
    retry: false,
  });
  const lessonId = room.data?.room.lessonId;
  const experienceId =
    typeof room.data?.room.worldState.experienceId === 'string'
      ? room.data.room.worldState.experienceId
      : null;
  const lesson = useQuery({
    queryKey: ['spatial-lesson', lessonId],
    queryFn: () => apiFetch<{ lesson: DeliveryLesson }>(`/lessons/${lessonId}`),
    enabled: Boolean(lessonId),
  });
  useEffect(() => {
    let disposed = false;
    const report = async () => {
      try {
        await apiFetch(`/spatial/rooms/${roomId}/heartbeat`, {
          method: 'POST',
          body: { pose: { position: [0, 1.6, 0], device: 'web' } },
        });
        if (!disposed) {
          setJoined(true);
          setError(null);
          void cache.invalidateQueries({ queryKey: ['spatial-room', roomId] });
        }
      } catch (e) {
        if (!disposed) {
          setJoined(false);
          setError((e as Error).message);
        }
      }
    };
    void report();
    const timer = window.setInterval(report, 20_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [roomId, cache]);
  async function exit() {
    setLeaving(true);
    try {
      await apiFetch(`/spatial/rooms/${roomId}/leave`, { method: 'POST', body: {} });
      leave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLeaving(false);
    }
  }
  async function endSession() {
    setLeaving(true);
    try {
      await apiFetch(`/spatial/rooms/${roomId}/archive`, { method: 'POST' });
      leave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLeaving(false);
    }
  }
  async function shareStep(step: number) {
    if (!can('spatial:manage')) return;
    setSyncing(true);
    try {
      await apiFetch(`/spatial/rooms/${roomId}/world`, {
        method: 'PATCH',
        body: { worldState: { ...room.data?.room.worldState, lessonStep: step } },
      });
      await room.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  if (room.isLoading) return <LoadingBlock label="Entering the space" />;
  const current = room.data?.room;
  const sharedStep = current?.worldState.lessonStep;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Shared space</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">
            {current?.title ?? 'Space unavailable'}
          </h1>
          <p className="mt-1 text-sm text-ink-dim">
            {joined ? 'Connected · presence refreshes every 20 seconds' : 'Connecting to presence…'}{' '}
            · Shared steps refresh every 3 seconds.
          </p>
        </div>
        <Button variant="ghost" disabled={leaving} onClick={exit}>
          {leaving ? 'Leaving…' : 'Leave space'}
        </Button>
      </div>
      {error || room.error ? <ErrorNote message={error ?? (room.error as Error).message} /> : null}
      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          {lesson.error ? <ErrorNote message={(lesson.error as Error).message} /> : null}
          {lessonId && lesson.isLoading ? <LoadingBlock label="Loading the room lesson" /> : null}
          {experienceId && current ? (
            <ExperiencePlayer
              scenarioId={experienceId}
              title={current.title}
              close={() => {
                void exit();
              }}
            />
          ) : null}
          {lesson.data ? (
            <LessonPlayer
              key={lesson.data.lesson.id}
              lesson={lesson.data.lesson}
              sharedStep={follow && typeof sharedStep === 'number' ? sharedStep : undefined}
              onSharedStep={can('spatial:manage') ? shareStep : undefined}
            />
          ) : null}
          {!experienceId && !lessonId && current?.media?.cid ? (
            <ModelStage
              cid={current.media.cid}
              format={current.media.format}
              name={current.title}
              polycount={current.media.polycount}
            />
          ) : null}
          {!experienceId && !lessonId && current && !current.media?.cid ? (
            <Card className="p-5 text-ink-dim">The room asset has no pinned preview yet.</Card>
          ) : null}
        </div>
        <Card className="space-y-4 p-5">
          <p className="eyebrow">{current?.participants.length ?? 0} present</p>
          {can('spatial:manage') ? (
            <Button variant="outline" disabled={leaving} onClick={endSession}>
              End session for everyone
            </Button>
          ) : null}
          {current?.participants.map((p) => (
            <p key={p.userId} className="text-sm text-ink">
              {p.fullName}
            </p>
          ))}
          {lessonId ? (
            <>
              <label className="flex gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                />
                Follow facilitator steps
              </label>
              <p className="text-xs text-ink-dim">
                {can('spatial:manage')
                  ? 'Selecting a step shares it with this room.'
                  : 'Turn off follow to explore at your own pace. Assessments are individual.'}
                {syncing ? ' Sharing…' : ''}
              </p>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
