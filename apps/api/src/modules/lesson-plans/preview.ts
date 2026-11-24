import type { LessonPlan } from '@void-space/types';
/** Listing metadata only. No model download, source excerpts or assessment keys. */
export function lessonPreview(definition: LessonPlan) {
  const visual = definition.sections.find(
    (s) => s.kind !== 'quiz' && s.activity && s.activity.scene.kind !== 'none',
  )?.activity;
  return {
    kind: visual?.scene.kind ?? 'none',
    durationMinutes: definition.durationMinutes,
    sectionCount: definition.sections.length,
    componentCount: visual?.targets.length ?? 0,
    summary: definition.summary,
  };
}
