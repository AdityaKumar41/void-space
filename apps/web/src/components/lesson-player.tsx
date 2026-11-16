'use client';

import { useEffect, useState } from 'react';
import { ModelStage } from './model-stage';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { ErrorNote } from './ui/feedback';
import { useLessonProgress } from '../lib/use-lesson-progress';
import { apiFetch } from '../lib/api';
import { LANGUAGES, useLanguage } from '../lib/language';
import type { LanguageCode } from '@void-space/types';

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
type LessonTranslation = Pick<
  DeliveryLesson,
  'title' | 'summary' | 'narration' | 'outline' | 'questions'
>;

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
  const { language, t } = useLanguage();
  const progress = useLessonProgress(lesson.id, lesson.media?.versionId ?? null);
  const { step, assessment, answers } = progress.state;
  const setStep = (step: number) => progress.update({ step });
  const setAssessment = (assessment: boolean) => progress.update({ assessment });
  const setAnswers = (answers: Record<string, number>) => progress.update({ answers });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [translation, setTranslation] = useState<{
    language: LanguageCode;
    content: LessonTranslation;
  } | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translating, setTranslating] = useState(false);
  const isTranslationVisible = showTranslation && translation?.language === language;
  const displayedLesson = isTranslationVisible && translation
    ? { ...lesson, ...translation.content }
    : lesson;

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
    const utterance = new SpeechSynthesisUtterance(displayedLesson.narration);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
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
  async function translateLesson() {
    if (translation?.language === language) {
      setShowTranslation((visible) => !visible);
      return;
    }

    setTranslating(true);
    setError(null);
    try {
      const result = await apiFetch<{ translation: LessonTranslation }>(
        `/translations/lessons/${lesson.id}`,
        { method: 'POST', body: { targetLanguage: language } },
      );
      setTranslation({ language, content: result.translation });
      setShowTranslation(true);
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      setError(
        code === 'AI_TRANSLATION_UNAVAILABLE'
          ? t('AI translation is unavailable. Configure a text AI provider and try again.')
          : t('Could not translate this content. Try again.'),
      );
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="space-y-5 lesson-workspace">
      {close ? (
        <button type="button" onClick={close} className="text-sm text-ink-dim hover:text-ink">
          ← {t('All lessons')}
        </button>
      ) : null}
      <div>
        <p className="eyebrow">{assessment ? t('Quiz') : t('Lesson')}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-ink">{displayedLesson.title}</h1>
          {language === 'en' ? null : (
            <Button variant="ghost" disabled={translating} onClick={() => void translateLesson()}>
              {translating
                ? t('Translating…')
                : isTranslationVisible
                  ? t('Show original')
                  : t('Translate to {language}', {
                      language:
                        LANGUAGES.find((option) => option.code === language)?.label ?? language,
                    })}
            </Button>
          )}
        </div>
        {isTranslationVisible ? (
          <p className="mt-2 text-xs text-ink-faint">
            {t('Translation is shown temporarily and does not change the original.')}
          </p>
        ) : null}
        <p className="mt-3 max-w-[65ch] text-ink-dim">{displayedLesson.summary}</p>
        <div className="mt-4 max-w-md">
          <div className="learn-progress" aria-hidden>
            <span
              style={{
                width: `${assessment ? 100 : Math.round(((step + 1) / displayedLesson.outline.length) * 100)}%`,
              }}
            />
          </div>
          <p role="status" className="mt-2 text-xs text-ink-faint">
            {progress.status}
            {assessment
              ? ` · ${t('Assessment')}`
              : ` · ${t('Step {current} of {total}', {
                  current: step + 1,
                  total: displayedLesson.outline.length,
                })}`}
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
          <div
            className={
              lesson.media?.cid
                ? 'grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.95fr)]'
                : 'min-w-0'
            }
          >
            <fieldset disabled={!progress.loaded} className="min-w-0 border-0 p-0">
            <Card className="space-y-4 p-5">
              <p className="eyebrow">
                {t('Study')} · {step + 1} / {displayedLesson.outline.length}
              </p>
              <h2 className="text-xl text-ink">{displayedLesson.outline[step]}</h2>
              <nav aria-label={t('Lesson steps')} className="space-y-2">
                {displayedLesson.outline.map((item, i) => (
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
                  {t('Previous')}
                </Button>
                <Button
                  disabled={step === displayedLesson.outline.length - 1}
                  onClick={() => move(step + 1)}
                >
                  {t('Next step')}
                </Button>
              </div>
            </Card>
            </fieldset>
            {lesson.media?.cid ? (
              <ModelStage
                cid={lesson.media.cid}
                format={lesson.media.format}
                name={displayedLesson.title}
                polycount={lesson.media.polycount}
              />
            ) : null}
          </div>
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-ink">{t('Reading')}</h2>
              <Button variant="ghost" onClick={narrate}>
                {speaking ? t('Stop narration') : t('Read aloud')}
              </Button>
            </div>
            <p className="max-w-[65ch] whitespace-pre-wrap leading-relaxed text-ink-dim">
              {displayedLesson.narration}
            </p>
          </Card>
          {!assessment ? (
            <Button
              disabled={!progress.loaded}
              variant="primary"
              onClick={() => setAssessment(true)}
            >
              {t('Start quiz · {count} questions', { count: displayedLesson.questions.length })}
            </Button>
          ) : (
            <Card className="space-y-6 p-5">
              <h2 className="text-xl text-ink">{t('Quiz')}</h2>
              {displayedLesson.questions.map((q, i) => (
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
                  displayedLesson.questions.some((q) => answers[q.id] === undefined)
                }
                onClick={submit}
              >
                {busy ? t('Scoring…') : t('Submit quiz')}
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
