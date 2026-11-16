import { withTenant } from '@void-space/db';
import { generateText, isTextAiConfigured, TextAiError } from '@void-space/studio-ai/text';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiEnv } from '../../env';
import { NotFoundError, ServiceUnavailableError } from '../../lib/errors';

const stages = ['Awareness', 'Practice', 'Apply', 'Mastery'] as const;
const insightSchema = z.object({
  insights: z.array(z.string().trim().min(20).max(240)).min(1).max(3),
  recommendations: z.array(z.string().trim().min(20).max(240)).min(1).max(3),
});

function percentage(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 1000) / 10;
}

async function getLearningAnalytics(tenantId: string) {
  return withTenant(tenantId, async (db) => {
    const lessons = await db.lesson.findMany({
      where: { tenantId, isPublished: true },
      select: {
        id: true,
        title: true,
        outline: true,
        attempts: {
          select: {
            learnerId: true,
            score: true,
            passed: true,
            stage: true,
            completedAt: true,
            credential: { select: { id: true } },
          },
          orderBy: { completedAt: 'desc' },
        },
        progress: {
          select: {
            learnerId: true,
            step: true,
            assessment: true,
            learningTimeSeconds: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { title: 'asc' },
    });
    const learnerIds = [
      ...new Set(
        lessons.flatMap((lesson) => [
          ...lesson.attempts.map((attempt) => attempt.learnerId),
          ...lesson.progress.map((progress) => progress.learnerId),
        ]),
      ),
    ];
    const users = learnerIds.length
      ? await db.user.findMany({
          where: { tenantId, id: { in: learnerIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const names = new Map(users.map((user) => [user.id, user.fullName]));

    const learners = new Map<
      string,
      {
        id: string;
        name: string;
        learningTimeSeconds: number;
        attempts: {
          lessonId: string;
          lessonTitle: string;
          score: number;
          passed: boolean;
          stage: string;
          completedAt: Date;
        }[];
        credentialCount: number;
        lessons: Map<
          string,
          {
            lessonId: string;
            title: string;
            progressPercent: number | null;
            learningTimeSeconds: number;
            attemptCount: number;
            averageScore: number | null;
            latestScore: number | null;
            latestPassed: boolean | null;
            latestStage: string | null;
            lastActivityAt: Date | null;
          }
        >;
      }
    >();
    const trend = new Map<string, { scores: number[]; attempts: number }>();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 29);
    for (let offset = 0; offset < 30; offset += 1) {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + offset);
      trend.set(day.toISOString().slice(0, 10), { scores: [], attempts: 0 });
    }

    const getLearner = (learnerId: string) => {
      let learner = learners.get(learnerId);
      if (!learner) {
        learner = {
          id: learnerId,
          name: names.get(learnerId) ?? 'Learner',
          learningTimeSeconds: 0,
          attempts: [],
          credentialCount: 0,
          lessons: new Map(),
        };
        learners.set(learnerId, learner);
      }
      return learner;
    };

    const skills = lessons.map((lesson) => {
      const outline = z.array(z.string()).safeParse(lesson.outline);
      const stepCount = outline.success ? outline.data.length : 0;
      const latestByLearner = new Map<
        string,
        { stage: string; completedAt: Date; score: number; passed: boolean }
      >();
      const assessmentByLearner = new Map<
        string,
        {
          scoreTotal: number;
          attemptCount: number;
          latest: (typeof lesson.attempts)[number] | null;
        }
      >();
      for (const attempt of lesson.attempts) {
        const learner = getLearner(attempt.learnerId);
        let report = learner.lessons.get(lesson.id);
        if (!report) {
          report = {
            lessonId: lesson.id,
            title: lesson.title,
            progressPercent: null,
            learningTimeSeconds: 0,
            attemptCount: 0,
            averageScore: null,
            latestScore: null,
            latestPassed: null,
            latestStage: null,
            lastActivityAt: null,
          };
          learner.lessons.set(lesson.id, report);
        }
        learner.attempts.push({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          score: attempt.score,
          passed: attempt.passed,
          stage: attempt.stage,
          completedAt: attempt.completedAt,
        });
        const assessment = assessmentByLearner.get(attempt.learnerId) ?? {
          scoreTotal: 0,
          attemptCount: 0,
          latest: null,
        };
        assessment.scoreTotal += attempt.score;
        assessment.attemptCount += 1;
        if (!assessment.latest) assessment.latest = attempt;
        assessmentByLearner.set(attempt.learnerId, assessment);
        report.attemptCount += 1;
        report.averageScore =
          Math.round((assessment.scoreTotal / assessment.attemptCount) * 10) / 10;
        report.latestScore = assessment.latest.score;
        report.latestPassed = assessment.latest.passed;
        report.latestStage = assessment.latest.stage;
        if (!report.lastActivityAt || attempt.completedAt > report.lastActivityAt)
          report.lastActivityAt = attempt.completedAt;
        if (attempt.credential) learner.credentialCount += 1;
        if (!latestByLearner.has(attempt.learnerId))
          latestByLearner.set(attempt.learnerId, attempt);
        const day = trend.get(attempt.completedAt.toISOString().slice(0, 10));
        if (day) {
          day.attempts += 1;
          day.scores.push(attempt.score);
        }
      }
      for (const progress of lesson.progress) {
        const learner = getLearner(progress.learnerId);
        let report = learner.lessons.get(lesson.id);
        if (!report) {
          report = {
            lessonId: lesson.id,
            title: lesson.title,
            progressPercent: null,
            learningTimeSeconds: 0,
            attemptCount: 0,
            averageScore: null,
            latestScore: null,
            latestPassed: null,
            latestStage: null,
            lastActivityAt: null,
          };
          learner.lessons.set(lesson.id, report);
        }
        learner.learningTimeSeconds += progress.learningTimeSeconds;
        report.learningTimeSeconds = progress.learningTimeSeconds;
        report.progressPercent =
          stepCount === 0
            ? null
            : progress.assessment
              ? 100
              : Math.round(((progress.step + 1) / stepCount) * 100);
        if (!report.lastActivityAt || progress.updatedAt > report.lastActivityAt)
          report.lastActivityAt = progress.updatedAt;
      }
      const latest = [...latestByLearner.values()];
      const progressReports = lesson.progress
        .map((progress) => {
          if (stepCount === 0) return null;
          return progress.assessment ? 100 : Math.round(((progress.step + 1) / stepCount) * 100);
        })
        .filter((value): value is number => value !== null);
      return {
        lessonId: lesson.id,
        title: lesson.title,
        learners: new Set([
          ...lesson.attempts.map((attempt) => attempt.learnerId),
          ...lesson.progress.map((progress) => progress.learnerId),
        ]).size,
        attempts: lesson.attempts.length,
        averageScore:
          lesson.attempts.length === 0
            ? null
            : Math.round(
                (lesson.attempts.reduce((sum, attempt) => sum + attempt.score, 0) /
                  lesson.attempts.length) *
                  10,
              ) / 10,
        masteryCount: latest.filter((attempt) => attempt.stage === 'Mastery').length,
        averageProgressPercent:
          progressReports.length === 0
            ? null
            : Math.round(
                progressReports.reduce((sum, value) => sum + value, 0) / progressReports.length,
              ),
        stageCounts: Object.fromEntries(
          stages.map((stage) => [
            stage,
            latest.filter((attempt) => attempt.stage === stage).length,
          ]),
        ),
      };
    });

    const learnerRows = [...learners.values()]
      .map((learner) => {
        const latest = [...learner.attempts].sort(
          (a, b) => b.completedAt.getTime() - a.completedAt.getTime(),
        )[0];
        const scoreTotal = learner.attempts.reduce((sum, attempt) => sum + attempt.score, 0);
        const passed = learner.attempts.filter((attempt) => attempt.passed).length;
        return {
          id: learner.id,
          name: learner.name,
          learningTimeSeconds: learner.learningTimeSeconds,
          attemptCount: learner.attempts.length,
          averageScore:
            learner.attempts.length === 0
              ? null
              : Math.round((scoreTotal / learner.attempts.length) * 10) / 10,
          passRate: percentage(passed, learner.attempts.length),
          latestStage: latest?.stage ?? null,
          lastAttemptAt: latest?.completedAt.toISOString() ?? null,
          credentialCount: learner.credentialCount,
          assessmentHistory: learner.attempts
            .slice()
            .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
            .map((attempt) => ({
              lessonId: attempt.lessonId,
              lessonTitle: attempt.lessonTitle,
              score: attempt.score,
              passed: attempt.passed,
              stage: attempt.stage,
              completedAt: attempt.completedAt.toISOString(),
            })),
          lessonProgress: [...learner.lessons.values()]
            .map((lesson) => ({
              ...lesson,
              lastActivityAt: lesson.lastActivityAt?.toISOString() ?? null,
            }))
            .sort((a, b) => a.title.localeCompare(b.title)),
        };
      })
      .sort(
        (a, b) => b.learningTimeSeconds - a.learningTimeSeconds || a.name.localeCompare(b.name),
      );
    const attempts = lessons.flatMap((lesson) => lesson.attempts);
    const passingCount = attempts.filter((attempt) => attempt.passed).length;
    const progressReports = lessons
      .flatMap((lesson) =>
        lesson.progress.map((progress) => {
          const outline = z.array(z.string()).safeParse(lesson.outline);
          if (!outline.success || outline.data.length === 0) return null;
          return progress.assessment
            ? 100
            : Math.round(((progress.step + 1) / outline.data.length) * 100);
        }),
      )
      .filter((value): value is number => value !== null);
    return {
      summary: {
        learnerCount: learnerRows.length,
        lessonCount: lessons.length,
        progressCount: lessons.reduce((sum, lesson) => sum + lesson.progress.length, 0),
        averageProgressPercent:
          progressReports.length === 0
            ? null
            : Math.round(
                progressReports.reduce((sum, value) => sum + value, 0) / progressReports.length,
              ),
        attemptCount: attempts.length,
        averageScore:
          attempts.length === 0
            ? null
            : Math.round(
                (attempts.reduce((sum, attempt) => sum + attempt.score, 0) / attempts.length) * 10,
              ) / 10,
        passRate: percentage(passingCount, attempts.length),
        learningTimeSeconds: learnerRows.reduce(
          (sum, learner) => sum + learner.learningTimeSeconds,
          0,
        ),
        credentialCount: attempts.filter((attempt) => attempt.credential !== null).length,
      },
      learners: learnerRows,
      skills,
      performanceTrend: [...trend].map(([date, day]) => ({
        date,
        attempts: day.attempts,
        averageScore:
          day.scores.length === 0
            ? null
            : Math.round(
                (day.scores.reduce((sum, score) => sum + score, 0) / day.scores.length) * 10,
              ) / 10,
      })),
    };
  });
}

export async function learningAnalyticsRoutes(app: FastifyInstance, env: ApiEnv) {
  app.get(
    '/learning/analytics',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const principal = request.principal!;
      return getLearningAnalytics(principal.tenantId);
    },
  );

  app.get(
    '/learning/analytics/learners/:learnerId',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const { learnerId } = z.object({ learnerId: z.string().uuid() }).parse(request.params);
      const principal = request.principal!;
      const analytics = await getLearningAnalytics(principal.tenantId);
      const learner = analytics.learners.find((item) => item.id === learnerId);
      if (!learner) throw new NotFoundError('Learner report');
      return learner;
    },
  );

  app.post(
    '/learning/analytics/insights',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const textConfig = {
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        OPENAI_MODEL: env.OPENAI_MODEL,
        OPENAI_BASE_URL: env.OPENAI_BASE_URL,
        GEMINI_API_KEY: env.GEMINI_API_KEY,
        GEMINI_MODEL: env.GEMINI_MODEL,
        GEMINI_BASE_URL: env.GEMINI_BASE_URL,
        AI_TEXT_TIMEOUT_MS: env.AI_TEXT_TIMEOUT_MS,
      };
      if (!isTextAiConfigured(textConfig))
        throw new ServiceUnavailableError('AI insights are not configured', 'AI_NOT_CONFIGURED');
      const principal = request.principal!;
      const analytics = await getLearningAnalytics(principal.tenantId);
      let result;
      try {
        result = await generateText(
          textConfig,
          {
            json: true,
            maxTokens: 700,
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content:
                  'You are a learning analytics assistant. Interpret only the supplied, tenant-scoped aggregate metrics. Do not infer causes, diagnose individual learners, or claim unsupported skills. Return JSON with an insights array and a recommendations array, each containing 1 to 3 concise, actionable items. Recommendations must be low-risk teaching or content actions grounded in the supplied metrics. If the metrics are sparse, state that evidence is limited and recommend collecting more activity rather than inventing trends.',
              },
              {
                role: 'user',
                content: JSON.stringify({
                  summary: analytics.summary,
                  lessons: analytics.skills.map(
                    ({
                      title,
                      learners,
                      attempts,
                      averageScore,
                      masteryCount,
                      averageProgressPercent,
                      stageCounts,
                    }) => ({
                      title,
                      learners,
                      attempts,
                      averageScore,
                      masteryCount,
                      averageProgressPercent,
                      stageCounts,
                    }),
                  ),
                  dailyPerformance: analytics.performanceTrend,
                  stages,
                }),
              },
            ],
            validate: (text) => {
              insightSchema.parse(JSON.parse(text));
            },
          },
        );
      } catch (error) {
        request.log.error({ err: error }, 'learning analytics insight generation failed');
        if (error instanceof TextAiError) {
          const labels: Record<string, readonly [string, string]> = {
            gemini: ['Google Gemini', 'GEMINI_API_KEY'],
            openai: ['OpenAI', 'OPENAI_API_KEY'],
            openrouter: ['OpenRouter', 'OPENROUTER_API_KEY'],
            compatible: ['The configured AI_TEXT provider', 'AI_TEXT_*'],
          };
          // Prefer the provider the chain tried first (Gemini when configured), then OpenAI.
          const primary =
            error.failures.find((failure) => failure.provider === 'gemini') ??
            error.failures.find((failure) => failure.provider === 'openai') ??
            error.failures[0];
          const [label, keyName] = (primary && labels[primary.provider]) ?? [
            'The configured AI provider',
            'GEMINI_API_KEY',
          ];
          const reasons = (primary
            ? error.failures.filter((failure) => failure.provider === primary.provider)
            : error.failures
          ).map((failure) => failure.reason);
          const has = (pattern: RegExp) => reasons.some((reason) => pattern.test(reason));
          if (has(/^Provider HTTP 40[13]\b/))
            throw new ServiceUnavailableError(
              `${label} rejected the configured API key. Verify ${keyName} in the root .env file and restart the API.`,
              'AI_PROVIDER_AUTH_FAILED',
            );
          // OpenAI signals an empty account as HTTP 429 with insufficient_quota /
          // credit_balance_exhausted; Gemini free tier answers 429 when its quota is
          // exhausted. A generic 429 is a rate or usage limit. Both are actionable,
          // and they are not the same fix.
          if (
            has(
              /^Provider HTTP 429\b.*\b(insufficient_quota|credit_balance_exhausted|resource_exhausted|quota)\b/,
            )
          )
            throw new ServiceUnavailableError(
              `${label} reports insufficient quota for the key behind ${keyName}. For the Gemini free tier, limits reset per minute/per day — wait and retry, or check usage in Google AI Studio; OpenAI accounts need credits on the OpenAI billing page.`,
              'AI_PROVIDER_QUOTA_EXCEEDED',
            );
          if (has(/^Provider HTTP 429\b/))
            throw new ServiceUnavailableError(
              `${label} rate or free-tier usage limit reached for the key behind ${keyName} (HTTP 429). Wait a moment and retry, or raise the account usage limit.`,
              'AI_PROVIDER_RATE_LIMITED',
            );
        }
        throw new ServiceUnavailableError(
          'AI insights could not be generated',
          'AI_INSIGHTS_UNAVAILABLE',
        );
      }
      request.log.info(
        {
          provider: result.provider,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
        'learning analytics insights generated',
      );
      return insightSchema.parse(JSON.parse(result.text));
    },
  );
}
