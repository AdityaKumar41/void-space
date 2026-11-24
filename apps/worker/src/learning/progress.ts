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
    await db.learningTask.update({
      where: { id: taskId },
      data: { progress: next.slice(-16) as unknown as Prisma.InputJsonValue },
    });
  });
}
