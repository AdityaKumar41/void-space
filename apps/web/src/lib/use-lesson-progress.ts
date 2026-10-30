'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
interface ProgressState {
  step: number;
  assessment: boolean;
  answers: Record<string, number>;
}
interface Saved extends ProgressState {
  revision: number;
}
const empty = (): ProgressState => ({ step: 0, assessment: false, answers: {} });
/** Serial autosave with revision checks. Reading state never counts as a passed attempt. */
export function useLessonProgress(lessonId: string, assetVersionId: string | null) {
  const [state, setState] = useState<ProgressState>(empty);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading saved progress…');
  const [tick, setTick] = useState(0);
  const revision = useRef(0);
  const lastSaved = useRef('');
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    apiFetch<{ progress: Saved | null }>(`/lessons/${lessonId}/progress`)
      .then(({ progress }) => {
        if (cancelled) return;
        const next = progress
          ? { step: progress.step, assessment: progress.assessment, answers: progress.answers }
          : empty();
        revision.current = progress?.revision ?? 0;
        lastSaved.current = JSON.stringify(next);
        setState(next);
        setLoaded(true);
        setStatus(progress ? 'Saved progress restored' : 'Progress saves automatically');
      })
      .catch(() => {
        if (!cancelled)
          setStatus('Saved progress could not load. Reopen this lesson to try again.');
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [lessonId]);
  useEffect(() => {
    if (!loaded) return;
    const snapshot = JSON.stringify(state);
    if (snapshot === lastSaved.current) return;
    setStatus('Saving progress…');
    const timer = setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        const { progress } = await apiFetch<{ progress: Saved }>(`/lessons/${lessonId}/progress`, {
          method: 'PATCH',
          body: { ...state, assetVersionId: assetVersionId ?? null, revision: revision.current },
        });
        revision.current = progress.revision;
        lastSaved.current = snapshot;
        if (mounted.current) setStatus('All progress saved');
      } catch (error) {
        if (mounted.current) setStatus(`Progress not saved: ${(error as Error).message}`);
      } finally {
        saving.current = false;
        if (mounted.current && lastSaved.current === snapshot) setTick((t) => t + 1);
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [state, loaded, assetVersionId, lessonId, tick]);
  return {
    state,
    loaded,
    status,
    update: (changes: Partial<ProgressState>) =>
      setState((current) => ({ ...current, ...changes })),
  };
}
