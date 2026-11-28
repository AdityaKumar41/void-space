import { UnrecoverableError } from 'bullmq';
import { withTenant, type Prisma } from '@void-space/db';
export interface LearningToolStep {
  id: string;
  label: string;
  status: 'working' | 'complete' | 'failed';
  detail?: string;
  updatedAt: string;
}
/** Persist actual execution stages, not a timed or fabricated progress animation. */
export async function learningToolProgress(
  tenantId: string,
  taskId: string,
  id: string,
  label: string,
  status: LearningToolStep['status'],
  detail?: string,
) {
  await withTenant(tenantId, async (db) => {
    await db.$queryRaw`SELECT id FROM learning_tasks WHERE id=${taskId}::uuid FOR UPDATE`;
    const task = await db.learningTask.findUnique({ where: { id: taskId } });
    if (!task) return;
    if (task.status === 'cancelled') throw new UnrecoverableError('Generation stopped.');
    const previous = Array.isArray(task.progress)
      ? (task.progress as unknown as LearningToolStep[])
      : [];
    const step = {
      id,
      label,
      status,
      ...(detail ? { detail: detail.slice(0, 300) } : {}),
      updatedAt: new Date().toISOString(),
    };
    const index = previous.findIndex((s) => s.id === id),
      next = [...previous];
    if (index < 0) next.push(step);
    else next[index] = step;
    if (task.kind === 'agent_turn')
      await db.learningAgentEvent.create({
        data: { tenantId, runId: taskId, payload: { type: 'step', ...step } },
      });
    await db.learningTask.update({
      where: { id: taskId },
      data: { progress: next.slice(-16) as unknown as Prisma.InputJsonValue },
    });
  });
}

/** Record actual provider usage once per successful checkpoint, without prompts or credentials. */
export async function learningToolUsage(
  tenantId: string,
  taskId: string,
  stage: string,
  usage: { provider: string; model: string; inputTokens: number; outputTokens: number },
) {
  await withTenant(tenantId, async (db) => {
    await db.$queryRaw`SELECT id FROM learning_tasks WHERE id=${taskId}::uuid FOR UPDATE`;
    const task = await db.learningTask.findUniqueOrThrow({ where: { id: taskId } });
    if (task.status === 'cancelled') throw new UnrecoverableError('Generation stopped.');
    const previous = Array.isArray(task.progress)
      ? (task.progress as unknown as LearningToolStep[])
      : [];
    const id = `usage-${stage}`;
    if (previous.some((s) => s.id === id)) return;
    const safeUsage = {
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
    const step = {
      id,
      label: 'Model usage',
      status: 'complete',
      detail: `${usage.provider} · ${usage.model} · ${usage.inputTokens} input / ${usage.outputTokens} output tokens`,
      updatedAt: new Date().toISOString(),
      usage: safeUsage,
    };
    await db.learningTask.update({
      where: { id: taskId },
      data: { progress: [...previous, step].slice(-16) as unknown as Prisma.InputJsonValue },
    });
    if (task.kind === 'agent_turn')
      await db.learningAgentEvent.create({
        data: { tenantId, runId: taskId, payload: { type: 'usage', stage, ...safeUsage } },
      });
  });
}
