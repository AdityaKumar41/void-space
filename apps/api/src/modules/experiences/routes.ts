import { recordAudit, withTenant, type Prisma } from '@void-space/db';
import {
  experienceActionSchema,
  experienceStateSchema,
  storedExperienceSchema,
  startExperienceSchema,
} from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { parseBody } from '../../lib/http';
import { advanceExperience, initialExperienceState, publicExperienceStep } from './runtime';
const params = z.object({ id: z.string().uuid() });
type RunRow = {
  id: string;
  scenarioId: string;
  mode: string;
  status: string;
  revision: number;
  definition: unknown;
  state: unknown;
  attemptId: string | null;
  startedAt: Date;
  completedAt: Date | null;
};
export function runView(run: RunRow) {
  const { definition, media } = storedExperienceSchema.parse(run.definition);
  const state = experienceStateSchema.parse(run.state);
  const mode = run.mode === 'assessment' ? 'assessment' : 'practice';
  const step = definition.steps[state.stepIndex];
  const possible = definition.steps.reduce((sum, s) => sum + s.weight, 0);
  return {
    id: run.id,
    scenarioId: run.scenarioId,
    mode,
    status: run.status,
    revision: run.revision,
    state,
    media,
    hotspots: definition.hotspots,
    totalSteps: definition.steps.length,
    currentStep: step && run.status === 'active' ? publicExperienceStep(step, mode) : null,
    score: Math.round((state.earned * 100) / possible),
    passed:
      mode === 'assessment' &&
      run.status === 'completed' &&
      Math.round((state.earned * 100) / possible) >= definition.passingScore,
    passingScore: definition.passingScore,
    attemptId: run.attemptId,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}
export async function experienceRoutes(app: FastifyInstance) {
  app.post('/simulations/:id/runs', { preHandler: app.authenticate }, async (request, reply) => {
    const p = request.principal!;
    const { id } = params.parse(request.params);
    const input = parseBody(startExperienceSchema, request.body ?? {});
    const run = await withTenant(p.tenantId, async (db) => {
      // Serialize start/resume for this learner, including simultaneous tabs.
      await db.$queryRaw`SELECT id FROM users WHERE id=${p.userId}::uuid FOR UPDATE`;
      const scenario = await db.simulationScenario.findFirst({
        where: { id, tenantId: p.tenantId, status: 'published' },
      });
      if (!scenario) throw new NotFoundError('Published experience');
      const definition = storedExperienceSchema.safeParse(scenario.experience);
      if (!definition.success)
        throw new ConflictError(
          'This is a legacy checklist, not an interactive experience. An author must add a scene and tasks.',
        );
      const active = await db.experienceRun.findFirst({
        where: { scenarioId: id, learnerId: p.userId, status: 'active' },
      });
      if (active && !input.restart && active.mode === input.mode) return active;
      if (active) {
        await db.experienceRun.update({
          where: { id: active.id },
          data: { status: 'abandoned', completedAt: new Date() },
        });
        await recordAudit(
          {
            action: 'simulation.run_abandoned',
            entityType: 'experience_run',
            entityId: active.id,
            actorId: p.userId,
            actorLabel: p.fullName,
          },
          db,
        );
      }
      const created = await db.experienceRun.create({
        data: {
          tenantId: p.tenantId,
          scenarioId: id,
          learnerId: p.userId,
          mode: input.mode,
          definition: definition.data as Prisma.InputJsonValue,
          state: initialExperienceState(),
        },
      });
      await recordAudit(
        {
          action: 'simulation.run_started',
          entityType: 'experience_run',
          entityId: created.id,
          actorId: p.userId,
          actorLabel: p.fullName,
          afterState: {
            scenarioId: id,
            mode: input.mode,
            versionId: definition.data.media.versionId,
          },
        },
        db,
      );
      return created;
    });
    return reply.status(201).send({ run: runView(run) });
  });
  app.get('/simulations/:id/runs', { preHandler: app.authenticate }, async (request) => {
    const p = request.principal!;
    const { id } = params.parse(request.params);
    const runs = await withTenant(p.tenantId, (db) =>
      db.experienceRun.findMany({
        where: { scenarioId: id, learnerId: p.userId },
        orderBy: { startedAt: 'desc' },
        take: 30,
      }),
    );
    return { runs: runs.map(runView) };
  });
  app.get('/experience-runs/:id', { preHandler: app.authenticate }, async (request) => {
    const p = request.principal!;
    const { id } = params.parse(request.params);
    const run = await withTenant(p.tenantId, (db) =>
      db.experienceRun.findFirst({ where: { id, learnerId: p.userId } }),
    );
    if (!run) throw new NotFoundError('Experience run');
    return { run: runView(run) };
  });
  app.post(
    '/experience-runs/:id/events',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const p = request.principal!;
      const { id } = params.parse(request.params);
      const action = parseBody(experienceActionSchema, request.body);
      const result = await withTenant(p.tenantId, async (db) => {
        const locks = await db.$queryRaw<
          { id: string }[]
        >`SELECT id FROM experience_runs WHERE id=${id}::uuid AND learner_id=${p.userId}::uuid FOR UPDATE`;
        if (!locks.length) throw new NotFoundError('Experience run');
        const run = await db.experienceRun.findFirstOrThrow({ where: { id, learnerId: p.userId } });
        const previous = await db.experienceEvent.findUnique({
          where: { runId_eventKey: { runId: id, eventKey: action.eventKey } },
        });
        if (previous) {
          const prior = previous.action as Record<string, unknown>;
          if (
            ['kind', 'targetId', 'choiceId', 'operation', 'revision'].some(
              (key) => prior[key] !== (action as unknown as Record<string, unknown>)[key],
            )
          )
            throw new ConflictError('This event key was used for a different action.');
          return { run, event: previous, duplicate: true };
        }
        if (run.revision !== action.revision)
          throw new ConflictError(
            'This run changed in another tab. Reload its current task.',
            'RUN_REVISION_CONFLICT',
          );
        if (run.status !== 'active')
          throw new ConflictError('This run has finished. Start another attempt.');
        const { definition } = storedExperienceSchema.parse(run.definition);
        const state = experienceStateSchema.parse(run.state);
        const next = advanceExperience(
          definition,
          state,
          action,
          run.mode === 'assessment' ? 'assessment' : 'practice',
        );
        const step = definition.steps[state.stepIndex]!;
        const event = await db.experienceEvent.create({
          data: {
            tenantId: p.tenantId,
            runId: id,
            eventKey: action.eventKey,
            sequence: run.revision + 1,
            stepId: step.id,
            action: action as Prisma.InputJsonValue,
            outcome: {
              correct: next.correct,
              feedback: next.state.feedback,
              state: next.state,
              score: next.score,
            },
          },
        });
        let attemptId = run.attemptId;
        if (next.state.status !== 'active') {
          const attempt = await db.scenarioAttempt.create({
            data: {
              tenantId: p.tenantId,
              scenarioId: run.scenarioId,
              learnerId: p.userId,
              score: next.score,
              passed: next.passed,
              evidence: {
                source: 'interactive-experience-v1',
                runId: id,
                mode: run.mode,
                actionCount: run.revision + 1,
                mistakes: next.state.mistakes,
              },
            },
          });
          attemptId = attempt.id;
          await recordAudit(
            {
              action: 'simulation.assessment_completed',
              entityType: 'scenario_attempt',
              entityId: attempt.id,
              actorId: p.userId,
              actorLabel: p.fullName,
              afterState: { runId: id, mode: run.mode, score: next.score, passed: next.passed },
            },
            db,
          );
        }
        const updated = await db.experienceRun.update({
          where: { id },
          data: {
            revision: { increment: 1 },
            state: next.state,
            status: next.state.status,
            attemptId,
            completedAt: next.state.status === 'active' ? null : new Date(),
          },
        });
        await recordAudit(
          {
            action: 'simulation.action_recorded',
            entityType: 'experience_event',
            entityId: event.id,
            actorId: p.userId,
            actorLabel: p.fullName,
            afterState: {
              runId: id,
              stepId: step.id,
              correct: next.correct,
              sequence: event.sequence,
            },
          },
          db,
        );
        return { run: updated, event, duplicate: false };
      });
      return reply.status(result.duplicate ? 200 : 201).send({
        run: runView(result.run),
        event: {
          id: result.event.id,
          sequence: result.event.sequence,
          outcome: result.event.outcome,
        },
        duplicate: result.duplicate,
      });
    },
  );
  app.get('/experience-runs/:id/replay', { preHandler: app.authenticate }, async (request) => {
    const p = request.principal!;
    const { id } = params.parse(request.params);
    return withTenant(p.tenantId, async (db) => {
      const run = await db.experienceRun.findFirst({
        where: { id, learnerId: p.userId },
        include: { events: { orderBy: { sequence: 'asc' } } },
      });
      if (!run) throw new NotFoundError('Experience run');
      return {
        run: runView(run),
        events: run.events.map((event) => ({
          id: event.id,
          sequence: event.sequence,
          stepId: event.stepId,
          action: event.action,
          outcome: event.outcome,
          at: event.createdAt.toISOString(),
        })),
      };
    });
  });
}
