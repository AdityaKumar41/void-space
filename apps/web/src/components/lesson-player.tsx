'use client';

import { useEffect, useState } from 'react';
import { ModelStage } from './model-stage';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { ErrorNote } from './ui/feedback';
import { useLessonProgress } from '../lib/use-lesson-progress';
import { apiFetch } from '../lib/api';

export interface DeliveryLesson {
  id: string;
  assetId: string;
  title: string;
  summary: string;
  narration: string;
  outline: string[];
  questions: { id: string; prompt: string; options: string[] }[];
  passingScore: number;
  isPublished: boolean;
  media: { versionId: string; cid: string | null; format: string; polycount: number | null } | null;
}
interface Result {
  score: number;
  passed: boolean;
  stage: string;
  credential: { id: string; verificationCode: string } | null;
}

export function LessonPlayer({
  lesson,
  close,
  sharedStep,
  onSharedStep,
}: {
  lesson: DeliveryLesson;
  close?: () => void;
  sharedStep?: number;
  onSharedStep?: (step: number) => void;
}) {
  const [modelReady, setModelReady] = useState(false);
  const progress = useLessonProgress(lesson.id, lesson.media?.versionId);
  const { step, assessment, answers } = progress.state;
  const setStep = (step: number) => progress.update({ step });
  const setAssessment = (assessment: boolean) => progress.update({ assessment });
  const setAnswers = (answers: Record<string, number>) => progress.update({ answers });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [mentorMode, setMentorMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (
      progress.loaded &&
      sharedStep !== undefined &&
      Number.isInteger(sharedStep) &&
      sharedStep >= 0 &&
      sharedStep < lesson.outline.length
    )
      setStep(sharedStep);
  }, [sharedStep, lesson.outline.length, progress.loaded]);
  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );
  function move(next: number) {
    setStep(next);
    onSharedStep?.(next);
  }
  function narrate() {
    if (!window.speechSynthesis) {
      setError('Narration is unavailable in this browser. The full transcript is below.');
      return;
    }
    window.speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(lesson.narration);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }
  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ answer: string; mode: string }>(
        `/lessons/${lesson.id}/mentor`,
        { method: 'POST', body: { question } },
      );
      setAnswer(response.answer);
      setMentorMode(response.mode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await apiFetch<Result>(`/lessons/${lesson.id}/attempts`, {
          method: 'POST',
          body: { answers },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5 lesson-workspace">
      {close ? (
        <Button variant="ghost" onClick={close}>
          ← All lessons
        </Button>
      ) : null}
      <div>
        <p className="eyebrow">{assessment ? 'ASSESS UNDERSTANDING' : 'EXPLORE THE ASSET'}</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{lesson.title}</h1>
        <p className="mt-2 max-w-3xl text-ink-dim">{lesson.summary}</p>
        <p role="status" className="mt-3 text-xs text-ink-faint">
          {progress.status}
        </p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {result ? (
        <Card className="space-y-4 p-5">
          <h2 className="text-2xl text-ink">
            {result.passed ? 'Assessment passed' : 'Review and try again'}
          </h2>
          <p className="text-ink-dim">
            {result.score}% · {result.stage} · Required {lesson.passingScore}%
          </p>
          {result.credential ? (
            <div>
              <p className="text-sm text-ink">Completion verification record</p>
              <code className="block break-all text-xs text-brand">
                {result.credential.verificationCode}
              </code>
              <a
                className="mt-3 inline-block text-brand underline"
                href={`/api/v1/credentials/${result.credential.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open credential JSON
              </a>
            </div>
          ) : null}
          <Button
            onClick={() => {
              setResult(null);
              setAssessment(false);
              setAnswers({});
            }}
          >
            Review lesson
          </Button>
        </Card>
      ) : (
        <>
          <fieldset
            disabled={!progress.loaded}
            className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(16rem,1fr)]"
          >
            <div>
              {lesson.media?.cid ? (
                <ModelStage
                  key={lesson.media.versionId}
                  onReady={() => setModelReady(true)}
                  cid={lesson.media.cid}
                  format={lesson.media.format}
                  name={lesson.title}
                  polycount={lesson.media.polycount}
                  presentation
                />
              ) : (
                <Card className="p-6 text-ink-dim">
                  This reviewed version has no pinned 3D preview yet. The lesson transcript remains
                  available.
                </Card>
              )}
              <p className="mt-2 text-xs text-ink-dim">
                {lesson.media?.cid ? (
                  <span role="status">
                    {modelReady ? '3D asset ready. ' : 'Loading reviewed 3D asset… '}
                  </span>
                ) : null}
                Orbit by dragging; scroll to zoom. This is the asset version saved with this lesson.
              </p>
            </div>
            <Card className="space-y-4 p-5">
              <p className="eyebrow">
                GUIDED WALKTHROUGH · {step + 1}/{lesson.outline.length}
              </p>
              <h2 className="text-xl text-ink">{lesson.outline[step]}</h2>
              <nav aria-label="Lesson steps" className="space-y-2">
                {lesson.outline.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => move(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={`block w-full rounded-control border p-3 text-left text-sm ${i === step ? 'border-brand text-ink' : 'border-hairline text-ink-dim'}`}
                  >
                    {i + 1}. {item}
                  </button>
                ))}
              </nav>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={step === 0} onClick={() => move(step - 1)}>
                  Previous
                </Button>
                <Button
                  disabled={step === lesson.outline.length - 1}
                  onClick={() => move(step + 1)}
                >
                  Next step
                </Button>
              </div>
            </Card>
          </fieldset>
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-ink">Lesson transcript</h2>
              <Button variant="ghost" onClick={narrate}>
                {speaking ? 'Stop narration' : 'Read aloud'}
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-ink-dim">{lesson.narration}</p>
          </Card>
          {!assessment ? (
            <Button
              disabled={!progress.loaded}
              variant="primary"
              onClick={() => setAssessment(true)}
            >
              Begin assessment · {lesson.questions.length} questions
            </Button>
          ) : (
            <Card className="space-y-6 p-5">
              <h2 className="text-xl text-ink">Check your understanding</h2>
              {lesson.questions.map((q, i) => (
                <fieldset key={q.id} className="space-y-2">
                  <legend className="mb-3 text-ink">
                    {i + 1}. {q.prompt}
                  </legend>
                  {q.options.map((option, index) => (
                    <label
                      key={index}
                      className="flex cursor-pointer gap-3 rounded-control border border-hairline p-3 text-sm text-ink-dim"
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={answers[q.id] === index}
                        onChange={() => setAnswers({ ...answers, [q.id]: index })}
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>
              ))}
              <Button
                disabled={
                  !progress.loaded ||
                  busy ||
                  lesson.questions.some((q) => answers[q.id] === undefined)
                }
                onClick={submit}
              >
                {busy ? 'Scoring…' : 'Submit assessment'}
              </Button>
            </Card>
          )}
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold text-ink">Lesson guide</h2>
            <div className="flex gap-2">
              <input
                aria-label="Question about this lesson"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about this lesson"
                className="min-w-0 flex-1 rounded-control border border-hairline bg-surface p-3 text-sm text-ink"
              />
              <Button disabled={busy || question.trim().length < 2} onClick={ask}>
                Ask
              </Button>
            </div>
            {answer ? (
              <div>
                <p className="text-xs text-brand">
                  {mentorMode === 'ai'
                    ? 'AI response · check against the transcript'
                    : 'Transcript reference'}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-ink-dim">{answer}</p>
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
