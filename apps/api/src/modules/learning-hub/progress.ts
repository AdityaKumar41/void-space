import type { TenantClient } from '@void-space/db';
/** Only persisted server evidence can satisfy program requirements. */
export async function unitProgress(db: TenantClient, courseId: string, learnerId: string) {
  const units = await db.learningProgramUnit.findMany({
    where: { courseId },
    orderBy: { position: 'asc' },
    include: {
      lesson: { select: { id: true, title: true } },
      scenario: { select: { id: true, title: true } },
    },
  });
  const [lessons, runs] = await Promise.all([
    db.lessonAttempt.findMany({
      where: {
        learnerId,
        passed: true,
        lessonId: { in: units.flatMap((u) => (u.lessonId ? [u.lessonId] : [])) },
      },
    }),
    db.experienceRun.findMany({
      where: {
        learnerId,
        status: 'completed',
        scenarioId: { in: units.flatMap((u) => (u.scenarioId ? [u.scenarioId] : [])) },
      },
      include: { attempt: { select: { passed: true } } },
    }),
  ]);
  return units.map((u) => ({
    ...u,
    completed: u.lessonId
      ? lessons.some((a) => a.lessonId === u.lessonId)
      : runs.some(
          (r) =>
            r.scenarioId === u.scenarioId &&
            (u.requirement === 'complete_practice' ||
              (r.mode === 'assessment' && r.attempt?.passed === true)),
        ),
  }));
}
export async function syncLearningPrograms(db: TenantClient, learnerId: string) {
  const enrollments = await db.courseEnrollment.findMany({
    where: { learnerId, status: 'active', course: { units: { some: {} } } },
  });
  for (const enrollment of enrollments) {
    const units = await unitProgress(db, enrollment.courseId, learnerId);
    if (units.length && units.every((u) => u.completed))
      await db.courseEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'completed', completedAt: new Date() },
      });
  }
}
