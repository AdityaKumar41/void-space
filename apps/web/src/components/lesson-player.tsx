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
  assetId: string | null;
  title: string;
  summary: string;
  narration: string;
  outline: string[];
  questions: { id: string; prompt: string; options: string[] }[];
  passingScore: number;
  isPublished: boolean;
  media: { versionId: string; cid: string | null; format: string; polycount: number | null } | null;
}
interface ReviewItem {
  id: string;
  prompt: string;
  correct: boolean;
  yourAnswer: string;
  rightAnswer: string;
  explanation: string;
}
interface Result {
  score: number;
  passed: boolean;
  stage: string;
  review?: ReviewItem[];
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
  const progress = useLessonProgress(lesson.id, lesson.media?.versionId ?? null);
  const { step, assessment, answers } = progress.state;
  const setStep = (step: number) => progress.update({ step });
  const setAssessment = (assessment: boolean) => progress.update({ assessment });
  const setAnswers = (answers: Record<string, number>) => progress.update({ answers });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [mentorMode, setMentorMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
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
  async function ask(text = question) {
    const prompt = text.trim();
    if (prompt.length < 2) return;
    setQuestion(prompt);
    setAsking(true);
    setError(null);
    try {
      const response = await apiFetch<{ answer: string; mode: string }>(
        `/lessons/${lesson.id}/mentor`,
        { method: 'POST', body: { question: prompt } },
      );
      setAnswer(response.answer);
      setMentorMode(response.mode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
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
        <button type="button" onClick={close} className="text-sm text-ink-dim hover:text-ink">
          ← All lessons
        </button>
      ) : null}
      <div>
        <p className="eyebrow">{assessment ? 'Quiz' : 'Lesson'}</p>
        <h1 className="mt-2 text-ink">{lesson.title}</h1>
        <p className="mt-3 max-w-[65ch] text-ink-dim">{lesson.summary}</p>
        <div className="mt-4 max-w-md">
          <div className="learn-progress" aria-hidden>
            <span
              style={{
                width: `${assessment ? 100 : Math.round(((step + 1) / lesson.outline.length) * 100)}%`,
              }}
            />
          </div>
          <p role="status" className="mt-2 text-xs text-ink-faint">
            {progress.status}
            {assessment ? ' · Assessment' : ` · Step ${step + 1} of ${lesson.outline.length}`}
          </p>
        </div>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {result ? (
        <Card className="space-y-4 p-6">
          <p className="eyebrow">{result.passed ? 'Passed' : 'Not yet'}</p>
          <h2 className="text-5xl font-semibold tracking-tight text-ink">{result.score}%</h2>
          <p className="text-ink-dim">
            {result.passed ? 'Quiz passed' : 'Review the marked answers and try again'} · required{' '}
            {lesson.passingScore}%
          </p>
          {result.review?.length ? (
            <ul className="space-y-3">
              {result.review.map((item, index) => (
                <li key={item.id} className="rounded-control border border-hairline p-4">
                  <p className="text-sm font-medium text-ink">
                    {index + 1}. {item.prompt}
                  </p>
                  <p className="mt-2 text-sm text-ink-dim">
                    Your answer: {item.yourAnswer || 'Blank'} · {item.correct ? 'Correct' : 'Not correct'}
                  </p>
                  {item.correct ? null : (
                    <p className="mt-1 text-sm text-ink">Right answer: {item.rightAnswer}</p>
                  )}
                  <p className="learn-note mt-3">{item.explanation}</p>
                </li>
              ))}
            </ul>
          ) : null}
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
            className={
              lesson.media?.cid
                ? 'grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.85fr)]'
                : 'min-w-0'
            }
          >
            <Card className="space-y-4 p-5">
              <p className="eyebrow">
                Study · {step + 1} of {lesson.outline.length}
              </p>
              <h2 className="text-xl text-ink">{lesson.outline[step]}</h2>
              <nav aria-label="Lesson steps" className="space-y-2">
                {lesson.outline.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => move(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={`learn-step ${i === step ? 'is-current' : ''}`}
                  >
                    <span className="mr-2 font-mono text-[11px] text-ink-faint">{i + 1}</span>
                    {item}
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
            {lesson.media?.cid ? (
              <div>
                <ModelStage
                  key={lesson.media.versionId}
                  onReady={() => setModelReady(true)}
                  cid={lesson.media.cid}
                  format={lesson.media.format}
                  name={lesson.title}
                  polycount={lesson.media.polycount}
                  presentation
                />
                <p className="mt-2 text-xs text-ink-dim" role="status">
                  {modelReady ? 'Model ready. ' : 'Loading the model… '}
                  Drag to turn it. Scroll to zoom.
                </p>
              </div>
            ) : null}
          </fieldset>
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-ink">Reading</h2>
              <Button variant="ghost" onClick={narrate}>
                {speaking ? 'Stop narration' : 'Read aloud'}
              </Button>
            </div>
            <p className="max-w-[65ch] whitespace-pre-wrap leading-relaxed text-ink-dim">
              {lesson.narration}
            </p>
          </Card>
          {!assessment ? (
            <Button
              disabled={!progress.loaded}
              variant="primary"
              onClick={() => setAssessment(true)}
            >
              Start quiz · {lesson.questions.length} questions
            </Button>
          ) : (
            <Card className="space-y-6 p-5">
              <h2 className="text-xl text-ink">Quiz</h2>
              {lesson.questions.map((q, i) => (
                <fieldset key={q.id} className="space-y-2">
                  <legend className="mb-3 text-ink">
                    {i + 1}. {q.prompt}
                  </legend>
                  {q.options.map((option, index) => (
                    <label
                      key={index}
                      className={`learn-choice ${answers[q.id] === index ? 'is-selected' : ''}`}
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
                {busy ? 'Scoring…' : 'Submit quiz'}
              </Button>
            </Card>
          )}
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold text-ink">Ask about this lesson</h2>
            <p className="max-w-[65ch] text-sm leading-relaxed text-ink-dim">
              Type a question about the reading. The reply uses this lesson. It does not give away
              the quiz answers.
            </p>
            <div className="flex flex-wrap gap-2">
              {lesson.outline.slice(0, 3).map((step) => (
                <button
                  key={step}
                  type="button"
                  className="learn-step"
                  disabled={asking}
                  onClick={() => void ask(`What should I know about this: ${step}`)}
                >
                  {step}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                aria-label="Question about this lesson"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void ask();
                }}
                placeholder="Example: What does the right atrium do?"
                className="min-w-0 flex-1 rounded-control border border-hairline bg-surface p-3 text-sm text-ink"
              />
              <Button disabled={asking || question.trim().length < 2} onClick={() => void ask()}>
                {asking ? 'Looking…' : 'Ask'}
              </Button>
            </div>
            {answer ? (
              <div className="learn-note" role="status">
                <p className="mb-2 text-xs font-semibold text-brand">
                  {mentorMode === 'ai' ? 'Answer from the lesson model' : 'Answer from this lesson'}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{answer}</p>
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
