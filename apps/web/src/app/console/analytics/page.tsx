'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BrainCircuit, Clock3, GraduationCap, Sparkles, Target } from 'lucide-react';
import { ApiRequestError, apiFetch } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';

const STAGES = ['Awareness', 'Practice', 'Apply', 'Mastery'] as const;

interface LearnerLessonReport {
  lessonId: string;
  title: string;
  progressPercent: number | null;
  learningTimeSeconds: number;
  attemptCount: number;
  averageScore: number | null;
  latestScore: number | null;
  latestPassed: boolean | null;
  latestStage: string | null;
  lastActivityAt: string | null;
}

interface LearningAnalytics {
  summary: {
    learnerCount: number;
    lessonCount: number;
    progressCount: number;
    averageProgressPercent: number | null;
    attemptCount: number;
    averageScore: number | null;
    passRate: number;
    learningTimeSeconds: number;
    credentialCount: number;
  };
  learners: {
    id: string;
    name: string;
    learningTimeSeconds: number;
    attemptCount: number;
    averageScore: number | null;
    passRate: number;
    latestStage: string | null;
    lastAttemptAt: string | null;
    credentialCount: number;
    lessonProgress: LearnerLessonReport[];
  }[];
  skills: {
    lessonId: string;
    title: string;
    learners: number;
    attempts: number;
    averageScore: number | null;
    masteryCount: number;
    averageProgressPercent: number | null;
    stageCounts: Record<string, number>;
  }[];
  performanceTrend: {
    date: string;
    attempts: number;
    averageScore: number | null;
  }[];
}

type LearnerReport = LearningAnalytics['learners'][number] & {
  assessmentHistory: {
    lessonId: string;
    lessonTitle: string;
    score: number;
    passed: boolean;
    stage: string;
    completedAt: string;
  }[];
};

interface LearningInsights {
  insights: string[];
  recommendations: string[];
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${minutes}m`;
}

function formatDate(value: string | null) {
  if (!value) return 'No activity recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function ScoreTrendChart({ trend }: { trend: LearningAnalytics['performanceTrend'] }) {
  const width = 720;
  const height = 220;
  const inset = { top: 16, right: 12, bottom: 30, left: 36 };
  const chartWidth = width - inset.left - inset.right;
  const chartHeight = height - inset.top - inset.bottom;
  const points = trend.flatMap((day, index) =>
    day.averageScore === null
      ? []
      : [
          {
            x: inset.left + (index / Math.max(1, trend.length - 1)) * chartWidth,
            y: inset.top + ((100 - day.averageScore) / 100) * chartHeight,
            score: day.averageScore,
            date: day.date,
            attempts: day.attempts,
          },
        ],
  );
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const maxAttempts = Math.max(1, ...trend.map((day) => day.attempts));

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily average quiz score and attempt count for the last 30 days"
        className="h-auto w-full text-brand"
      >
        <title>Quiz performance over the last 30 days</title>
        {[0, 50, 100].map((score) => {
          const y = inset.top + ((100 - score) / 100) * chartHeight;
          return (
            <g key={score}>
              <line
                x1={inset.left}
                x2={width - inset.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.12"
              />
              <text
                x={inset.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-current text-[11px] text-ink-faint"
              >
                {score}
              </text>
            </g>
          );
        })}
        {trend.map((day, index) => {
          const barWidth = Math.max(2, chartWidth / Math.max(1, trend.length) - 3);
          const barHeight = (day.attempts / maxAttempts) * 24;
          const x = inset.left + (index / Math.max(1, trend.length - 1)) * chartWidth;
          const labelDay = index % 7 === 0 || index === trend.length - 1;
          return (
            <g key={day.date}>
              {day.attempts > 0 ? (
                <rect
                  x={x - barWidth / 2}
                  y={height - inset.bottom - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx="2"
                  fill="currentColor"
                  fillOpacity="0.22"
                >
                  <title>{`${day.date}: ${day.attempts} attempt${day.attempts === 1 ? '' : 's'}`}</title>
                </rect>
              ) : null}
              {labelDay ? (
                <text
                  x={x}
                  y={height - 7}
                  textAnchor="middle"
                  className="fill-current text-[10px] text-ink-faint"
                >
                  {new Date(`${day.date}T00:00:00.000Z`).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </text>
              ) : null}
            </g>
          );
        })}
        {points.length > 1 ? (
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {points.map((point) => (
          <circle key={point.date} cx={point.x} cy={point.y} r="4" fill="currentColor">
            <title>{`${point.date}: ${point.score}% average across ${point.attempts} attempt${point.attempts === 1 ? '' : 's'}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-ink-dim">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />
          Daily average score
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-heat-20" aria-hidden />
          Quiz attempts
        </span>
      </div>
      {points.length === 0 ? (
        <p className="text-sm text-ink-dim">
          Quiz scores will appear here after learners submit assessments.
        </p>
      ) : null}
    </div>
  );
}

export default function LearningAnalyticsPage() {
  const { can } = useSession();
  const allowed = can('learning:manage');
  const [learnerQuery, setLearnerQuery] = useState('');
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const analytics = useQuery({
    queryKey: ['learning-analytics'],
    queryFn: () => apiFetch<LearningAnalytics>('/learning/analytics'),
    enabled: allowed,
  });
  const learnerReport = useQuery({
    queryKey: ['learning-analytics', 'learner', selectedLearnerId],
    queryFn: () => apiFetch<LearnerReport>(`/learning/analytics/learners/${selectedLearnerId}`),
    enabled: allowed && selectedLearnerId !== null,
  });
  const insights = useMutation({
    mutationFn: () =>
      apiFetch<LearningInsights>('/learning/analytics/insights', { method: 'POST' }),
  });

  if (!allowed)
    return (
      <div className="space-y-3">
        <p className="eyebrow">Learning analytics</p>
        <h1 className="text-ink">Access restricted</h1>
        <p className="text-sm text-ink-dim">
          You need learning-management permission to view learner analytics.
        </p>
      </div>
    );
  if (analytics.isLoading) return <LoadingBlock label="Preparing learning analytics" />;
  if (analytics.error) return <ErrorNote message={(analytics.error as Error).message} />;
  const data = analytics.data;
  if (!data) return <ErrorNote message="Learning analytics could not be loaded." />;

  const metrics = [
    { label: 'Learners tracked', value: data.summary.learnerCount, icon: GraduationCap },
    { label: 'Quiz attempts', value: data.summary.attemptCount, icon: Target },
    {
      label: 'Average quiz score',
      value: data.summary.averageScore === null ? '—' : `${data.summary.averageScore}%`,
      icon: BrainCircuit,
    },
    { label: 'Quiz pass rate', value: `${data.summary.passRate}%`, icon: Target },
    {
      label: 'Learning time',
      value: formatDuration(data.summary.learningTimeSeconds),
      icon: Clock3,
    },
    {
      label: 'Average lesson progress',
      value:
        data.summary.averageProgressPercent === null
          ? '—'
          : `${data.summary.averageProgressPercent}%`,
      icon: GraduationCap,
    },
  ];
  const search = learnerQuery.trim().toLocaleLowerCase();
  const visibleLearners = data.learners.filter((learner) =>
    learner.name.toLocaleLowerCase().includes(search),
  );
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="eyebrow">Learning analytics</p>
        <h1 className="text-ink">See how learning is progressing.</h1>
        <p className="max-w-[65ch] text-sm leading-relaxed text-ink-dim">
          Explore quiz performance, lesson progress, foreground study time and skill development
          from your workspace activity.
        </p>
      </header>

      <section aria-label="Learning overview" className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="flex items-start gap-4 p-5">
            <span className="rounded-control bg-veil-6 p-2 text-brand">
              <Icon size={18} aria-hidden />
            </span>
            <div>
              <p className="text-xs text-ink-dim">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
            </div>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-semibold text-ink">Quiz performance</h2>
            <p className="mt-1 text-sm text-ink-dim">
              Daily average scores and attempt volume for the last 30 days.
            </p>
          </div>
          <ScoreTrendChart trend={data.performanceTrend} />
        </Card>
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-semibold text-ink">Learning activity</h2>
            <p className="mt-1 text-sm text-ink-dim">
              Published lesson progress tracked in this workspace.
            </p>
          </div>
          <dl className="divide-y divide-hairline">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-ink-dim">Published lessons</dt>
              <dd className="font-semibold text-ink">{data.summary.lessonCount}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-ink-dim">Learner lesson records</dt>
              <dd className="font-semibold text-ink">{data.summary.progressCount}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-ink-dim">Credentials issued</dt>
              <dd className="font-semibold text-ink">{data.summary.credentialCount}</dd>
            </div>
          </dl>
        </Card>
      </section>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={17} className="text-brand" aria-hidden />
            <h2 className="font-semibold text-ink">AI learning insights</h2>
          </div>
          <Button variant="outline" disabled={insights.isPending} onClick={() => insights.mutate()}>
            {insights.isPending ? 'Analysing…' : 'Generate insights'}
          </Button>
        </div>
        <p className="text-sm leading-relaxed text-ink-dim">
          Google Gemini (free tier) analyses workspace-level scores, lesson progress and
          activity trends. Learner names and individual reports are not sent.
        </p>
        {insights.error ? (
          <p role="alert" className="text-sm text-state-rejected">
            {insights.error instanceof ApiRequestError &&
            insights.error.code === 'AI_NOT_CONFIGURED'
              ? 'No AI provider is configured on the API. Set GEMINI_API_KEY (free tier) in the root .env file and restart the API.'
              : insights.error instanceof ApiRequestError &&
                  insights.error.code === 'AI_PROVIDER_AUTH_FAILED'
                ? 'The configured AI provider rejected the API key. Verify GEMINI_API_KEY (or OPENAI_API_KEY) in the root .env file and restart the API. The key must not be shared in chat or browser code.'
                  : insights.error instanceof ApiRequestError &&
                      insights.error.code === 'AI_PROVIDER_QUOTA_EXCEEDED'
                    ? 'The configured AI provider reports insufficient quota. For the Gemini free tier, usage limits reset per minute/per day — wait and retry or check usage in Google AI Studio; OpenAI accounts need credits on the OpenAI billing page.'
                    : insights.error instanceof ApiRequestError &&
                        insights.error.code === 'AI_PROVIDER_RATE_LIMITED'
                      ? 'The configured AI provider rate or free-tier usage limit was reached. Wait a moment and retry, or raise the account usage limit.'
                : insights.error instanceof ApiRequestError &&
                    insights.error.code === 'AI_INSIGHTS_UNAVAILABLE'
                  ? 'The AI provider is unavailable or could not return valid insights. Check the API provider configuration and try again.'
                  : (insights.error as Error).message}
          </p>
        ) : null}
        {insights.data ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-ink">Performance analysis</h3>
              <ul aria-live="polite" className="space-y-3">
                {insights.data.insights.map((insight, index) => (
                  <li key={`${index}-${insight}`} className="learn-note text-sm leading-relaxed">
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-ink">Recommendations</h3>
              <ul className="space-y-3">
                {insights.data.recommendations.map((recommendation, index) => (
                  <li
                    key={`${index}-${recommendation}`}
                    className="rounded-control border border-hairline p-4 text-sm leading-relaxed text-ink-dim"
                  >
                    {recommendation}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Lesson progress and skill development</h2>
          <p className="mt-1 text-sm text-ink-dim">
            Progress reflects the learner’s latest saved position. Skill stages reflect the latest
            submitted assessment for each lesson.
          </p>
        </div>
        {data.skills.length === 0 ? (
          <Card className="p-5 text-sm text-ink-dim">
            Publish lessons and collect learner activity to see progress and skill development.
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.skills.map((skill) => {
              const stageTotal = STAGES.reduce(
                (sum, stage) => sum + (skill.stageCounts[stage] ?? 0),
                0,
              );
              return (
                <Card key={skill.lessonId} className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="font-semibold text-ink">{skill.title}</h3>
                    <span className="shrink-0 text-xs text-ink-dim">
                      {skill.learners} learner{skill.learners === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-ink-dim">Attempts</p>
                      <p className="mt-1 font-semibold text-ink">{skill.attempts}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-dim">Average score</p>
                      <p className="mt-1 font-semibold text-ink">
                        {skill.averageScore === null ? '—' : `${skill.averageScore}%`}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-dim">Average progress</p>
                      <p className="mt-1 font-semibold text-ink">
                        {skill.averageProgressPercent === null
                          ? '—'
                          : `${skill.averageProgressPercent}%`}
                      </p>
                    </div>
                  </div>
                  <div
                    className="flex h-2 overflow-hidden rounded-full bg-veil-8"
                    role="img"
                    aria-label={`Latest assessment stages: ${STAGES.map((stage) => `${stage} ${skill.stageCounts[stage] ?? 0}`).join(', ')}`}
                  >
                    {STAGES.map((stage, index) => {
                      const count = skill.stageCounts[stage] ?? 0;
                      return count > 0 ? (
                        <span
                          key={stage}
                          className={index === 3 ? 'bg-brand' : 'bg-brand/60'}
                          style={{ width: `${stageTotal === 0 ? 0 : (count / stageTotal) * 100}%` }}
                        />
                      ) : null;
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {STAGES.map((stage) => (
                      <span
                        key={stage}
                        className="rounded-control border border-hairline px-2.5 py-1 text-xs text-ink-dim"
                      >
                        {stage} · {skill.stageCounts[stage] ?? 0}
                      </span>
                    ))}
                    <span className="rounded-control border border-hairline px-2.5 py-1 text-xs text-ink-dim">
                      At mastery · {skill.masteryCount}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">Student reports</h2>
            <p className="mt-1 text-sm text-ink-dim">
              Search learners and open a report with their progress, time and assessment history.
            </p>
          </div>
          <label className="grid gap-1 text-xs text-ink-dim">
            Search learners
            <input
              type="search"
              value={learnerQuery}
              onChange={(event) => setLearnerQuery(event.target.value)}
              placeholder="Find a learner"
              className="h-10 min-w-56 rounded-control border border-hairline bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
          </label>
        </div>
        <Card>
          {data.learners.length === 0 ? (
            <p className="p-5 text-sm text-ink-dim">
              Learner activity will appear here as lessons are studied and assessed.
            </p>
          ) : visibleLearners.length === 0 ? (
            <p className="p-5 text-sm text-ink-dim">No learners match that search.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-hairline text-xs text-ink-dim">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Learner
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Study time
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Lessons tracked
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Attempts
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Average score
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Latest stage
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      <span className="sr-only">Report</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {visibleLearners.map((learner) => (
                    <tr
                      key={learner.id}
                      className={learner.id === selectedLearnerId ? 'bg-veil-4' : undefined}
                    >
                      <th scope="row" className="px-5 py-3 font-medium text-ink">
                        {learner.name}
                      </th>
                      <td className="px-5 py-3 text-ink-dim">
                        {formatDuration(learner.learningTimeSeconds)}
                      </td>
                      <td className="px-5 py-3 text-ink-dim">{learner.lessonProgress.length}</td>
                      <td className="px-5 py-3 text-ink-dim">{learner.attemptCount}</td>
                      <td className="px-5 py-3 text-ink-dim">
                        {learner.averageScore === null ? '—' : `${learner.averageScore}%`}
                      </td>
                      <td className="px-5 py-3 text-ink-dim">{learner.latestStage ?? '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="outline"
                          aria-pressed={learner.id === selectedLearnerId}
                          onClick={() => setSelectedLearnerId(learner.id)}
                        >
                          View report
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selectedLearnerId ? (
          <Card className="space-y-5 p-5">
            {learnerReport.isLoading ? (
              <LoadingBlock label="Preparing student report" />
            ) : learnerReport.error ? (
              <ErrorNote message={(learnerReport.error as Error).message} />
            ) : learnerReport.data ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">Student report</p>
                    <h3 className="mt-1 text-lg font-semibold text-ink">
                      {learnerReport.data.name}
                    </h3>
                    <p className="mt-1 text-sm text-ink-dim">
                      Last assessment · {formatDate(learnerReport.data.lastAttemptAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-dim">
                    <span>{formatDuration(learnerReport.data.learningTimeSeconds)} study time</span>
                    <span>{learnerReport.data.passRate}% pass rate</span>
                    <span>{learnerReport.data.credentialCount} credentials</span>
                  </div>
                </div>
                {learnerReport.data.lessonProgress.length === 0 ? (
                  <p className="text-sm text-ink-dim">
                    No lesson activity is recorded for this learner yet.
                  </p>
                ) : (
                  <div className="divide-y divide-hairline">
                    {learnerReport.data.lessonProgress.map((lesson) => (
                      <div
                        key={lesson.lessonId}
                        className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                      >
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <h4 className="font-medium text-ink">{lesson.title}</h4>
                            <span className="text-xs text-ink-dim">
                              {lesson.progressPercent === null
                                ? 'No saved lesson position'
                                : `${lesson.progressPercent}% lesson position`}
                            </span>
                          </div>
                          {lesson.progressPercent === null ? null : (
                            <div
                              className="mt-2 h-1.5 overflow-hidden rounded-full bg-veil-8"
                              role="progressbar"
                              aria-label={`${lesson.title} lesson position`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={lesson.progressPercent}
                            >
                              <span
                                className="block h-full rounded-full bg-brand"
                                style={{ width: `${lesson.progressPercent}%` }}
                              />
                            </div>
                          )}
                          <p className="mt-2 text-xs text-ink-dim">
                            {lesson.attemptCount} attempt{lesson.attemptCount === 1 ? '' : 's'}
                            {lesson.latestScore === null ? '' : ` · Latest ${lesson.latestScore}%`}
                            {lesson.latestStage ? ` · ${lesson.latestStage}` : ''}
                            {lesson.latestPassed === null
                              ? ''
                              : lesson.latestPassed
                                ? ' · Passed'
                                : ' · Not passed'}
                          </p>
                        </div>
                        <div className="text-xs text-ink-dim md:text-right">
                          <p>{formatDuration(lesson.learningTimeSeconds)} study time</p>
                          <p className="mt-1">{formatDate(lesson.lastActivityAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <section aria-label="Assessment history" className="space-y-3">
                  <h4 className="font-semibold text-ink">Assessment history</h4>
                  {learnerReport.data.assessmentHistory.length === 0 ? (
                    <p className="text-sm text-ink-dim">No assessments have been submitted.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <thead className="border-b border-hairline text-xs text-ink-dim">
                          <tr>
                            <th scope="col" className="px-3 py-2 font-medium">
                              Lesson
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              Score
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              Result
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              Stage
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              Completed
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {learnerReport.data.assessmentHistory.map((attempt) => (
                            <tr key={`${attempt.lessonId}-${attempt.completedAt}`}>
                              <td className="px-3 py-2 text-ink">{attempt.lessonTitle}</td>
                              <td className="px-3 py-2 text-ink-dim">{attempt.score}%</td>
                              <td className="px-3 py-2 text-ink-dim">
                                {attempt.passed ? 'Passed' : 'Not passed'}
                              </td>
                              <td className="px-3 py-2 text-ink-dim">{attempt.stage}</td>
                              <td className="px-3 py-2 text-ink-dim">
                                {formatDate(attempt.completedAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <ErrorNote message="The selected learner report could not be loaded." />
            )}
          </Card>
        ) : null}
      </section>
    </div>
  );
}
