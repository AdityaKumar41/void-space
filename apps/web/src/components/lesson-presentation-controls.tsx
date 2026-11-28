'use client';
import { useEffect, useRef, useState } from 'react';
import type { LessonPlan, LearningTarget } from '@void-space/types';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { action } from './learning-ui';

export function LessonPresentationControls({
  section,
  index,
  sections,
  targets,
  onNavigate,
  onTarget,
}: {
  section: LessonPlan['sections'][number];
  index: number;
  sections: LessonPlan['sections'];
  targets: LearningTarget[];
  onNavigate: (id: string) => void;
  onTarget: (id: string | null) => void;
}) {
  const duration = Math.max(1, section.minutes * 60);
  const [remaining, setRemaining] = useState(duration),
    [running, setRunning] = useState(false),
    [automatic, setAutomatic] = useState(false),
    [finished, setFinished] = useState(false),
    [readAloud, setReadAloud] = useState(false),
    [speechAvailable, setSpeechAvailable] = useState(false),
    [message, setMessage] = useState('');
  const callbacks = useRef({ onNavigate, onTarget });
  callbacks.current = { onNavigate, onTarget };
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;
  useEffect(() => {
    setSpeechAvailable('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
  }, []);
  useEffect(() => {
    setRemaining(duration);
    setFinished(false);
    setRunning(automatic);
  }, [section.id, duration]);
  useEffect(() => {
    if (!running) return;
    const end = Date.now() + remainingRef.current * 1000;
    const tick = () => {
      const next = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) {
        setRunning(false);
        if (automatic && index < sections.length - 1)
          callbacks.current.onNavigate(sections[index + 1]!.id);
        else {
          setAutomatic(false);
          setFinished(index === sections.length - 1);
        }
      }
    };
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [running, automatic, section.id, index, sections]);
  // Spend the first third on the introduction, then highlight each reviewed pin in order.
  const elapsed = duration - remaining;
  const targetIndex =
    automatic && elapsed >= duration / 3 && targets.length
      ? Math.min(
          targets.length - 1,
          Math.floor(((elapsed - duration / 3) / ((duration * 2) / 3)) * targets.length),
        )
      : -1;
  const target = targets[targetIndex];
  useEffect(() => {
    callbacks.current.onTarget(target?.id ?? null);
  }, [target?.id]);
  const narration = target
    ? `${target.label}. ${target.explanation}`
    : `${section.title}. ${section.body}`;
  useEffect(() => {
    if (!speechAvailable) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (!readAloud || finished) return;
    const utterance = new SpeechSynthesisUtterance(narration);
    utterance.lang = 'en';
    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        setMessage('Read aloud could not start. Try again or continue with the text.');
        setReadAloud(false);
      }
    };
    synth.speak(utterance);
    return () => {
      utterance.onerror = null;
      synth.cancel();
    };
  }, [narration, readAloud, speechAvailable, finished]);
  useEffect(() => {
    if (!speechAvailable || !readAloud) return;
    if (automatic && !running) window.speechSynthesis.pause?.();
    else window.speechSynthesis.resume?.();
  }, [automatic, running, speechAvailable, readAloud]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        setRunning(false);
        if (speechAvailable) window.speechSynthesis.cancel();
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [speechAvailable]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (element.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'ArrowRight' && index < sections.length - 1) {
        event.preventDefault();
        setAutomatic(false);
        setRunning(false);
        callbacks.current.onNavigate(sections[index + 1]!.id);
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        setAutomatic(false);
        setRunning(false);
        callbacks.current.onNavigate(sections[index - 1]!.id);
      } else if (event.code === 'Space' && !element.closest('button,a')) {
        event.preventDefault();
        if (!remainingRef.current) setRemaining(duration);
        setRunning((value) => !value);
      }
    };
    const fullscreen = () => {
      if (!document.fullscreenElement) setRunning(false);
    };
    window.addEventListener('keydown', keys);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => {
      window.removeEventListener('keydown', keys);
      document.removeEventListener('fullscreenchange', fullscreen);
    };
  }, [index, sections, duration]);
  function navigate(next: number) {
    setRunning(false);
    setAutomatic(false);
    callbacks.current.onNavigate(sections[next]!.id);
  }
  return (
    <section className="lesson-presentation-controls" aria-label="Presentation controls">
      <div className="presentation-position">
        <span>
          Section {index + 1} of {sections.length}
        </span>
        <output aria-label="Section timer">
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
        </output>
        <progress aria-label="Section elapsed time" max={duration} value={elapsed} />
      </div>
      <div className="presentation-actions">
        <button className={action} disabled={index === 0} onClick={() => navigate(index - 1)}>
          Previous section
        </button>
        <button
          className={action}
          disabled={index === sections.length - 1}
          onClick={() => navigate(index + 1)}
        >
          Next section
        </button>
        <button
          className={action}
          onClick={() => {
            if (!remaining) setRemaining(duration);
            setRunning(!running);
          }}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
          {running ? 'Pause timer' : 'Start timer'}
        </button>
        <button
          className={action}
          aria-pressed={automatic}
          onClick={async (event) => {
            if (automatic) {
              setAutomatic(false);
              setRunning(false);
              return;
            }
            setMessage('');
            setAutomatic(true);
            setFinished(false);
            if (!remaining) setRemaining(duration);
            setRunning(true);
            const stage = event.currentTarget.closest<HTMLElement>('.lesson-playground');
            if (!document.fullscreenElement && document.fullscreenEnabled)
              try {
                await stage?.requestFullscreen();
              } catch {
                setMessage(
                  'Browser fullscreen was unavailable. The presentation fills this window.',
                );
              }
          }}
        >
          {automatic ? 'Stop autoplay' : 'Start autoplay'}
        </button>
        <button
          className={action}
          onClick={() => {
            setRemaining(duration);
            setRunning(false);
            setAutomatic(false);
            setFinished(false);
          }}
          aria-label="Restart section timer"
        >
          <RotateCcw size={16} />
        </button>
        <button
          className={action}
          disabled={!speechAvailable}
          aria-pressed={readAloud}
          onClick={() => {
            setMessage('');
            setReadAloud(!readAloud);
          }}
        >
          {readAloud ? <VolumeX size={16} /> : <Volume2 size={16} />}
          {readAloud ? 'Stop reading' : 'Read aloud'}
        </button>
      </div>
      <p className="presentation-playback-status" role="status">
        {message && <span>{message} </span>}
        {finished
          ? 'Presentation complete. You can revisit any section.'
          : automatic
            ? running
              ? 'Autoplay · sections and annotation highlights follow the authored timings.'
              : 'Autoplay paused. Start the timer to resume.'
            : 'Manual presentation · advance when ready. Autoplay uses the section timings.'}
        {!speechAvailable && ' Read aloud is unavailable in this browser.'}
      </p>
    </section>
  );
}
