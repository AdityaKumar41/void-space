import { BookOpen, Box, CircleHelp, Flag, Hand, Play } from 'lucide-react';
export function LessonSectionMark({ kind }: { kind: string }) {
  const Icon =
    kind === 'exploration'
      ? Box
      : kind === 'quiz'
        ? CircleHelp
        : kind === 'recap'
          ? Flag
          : kind === 'practice'
            ? Hand
            : kind === 'introduction'
              ? Play
              : BookOpen;
  return (
    <span className={`lesson-section-mark mark-${kind}`} aria-hidden="true">
      <Icon size={16} strokeWidth={1.6} />
    </span>
  );
}
