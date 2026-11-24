import { Box, GitBranch, Image as ImageIcon, BookOpen } from 'lucide-react';
export type LessonVisualKind = 'model' | 'diagram' | 'process' | 'none';
/** Small format artwork; never downloads a model or pretends to be its thumbnail. */
export function LessonCover({ kind = 'none' }: { kind?: LessonVisualKind }) {
  const Icon =
    kind === 'model'
      ? Box
      : kind === 'process'
        ? GitBranch
        : kind === 'diagram'
          ? ImageIcon
          : BookOpen;
  return (
    <div className={`lesson-cover lesson-cover-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 420 210" fill="none">
        {kind === 'model' ? (
          <>
            <path
              d="m210 32 85 49v92l-85 49-85-49V81z"
              fill="#d8d9f3"
              transform="translate(0 -24)"
            />
            <path
              d="m125 57 85 50 85-50M210 107v91M125 57v92l85 49 85-49V57l-85-49z"
              stroke="#7167a4"
              strokeWidth="2"
            />
            <ellipse cx="210" cy="196" rx="100" ry="8" fill="#dbdbe6" />
            <path
              d="M210 13v182m-77-132 153 86m0-86-153 86"
              stroke="#9b95bd"
              strokeDasharray="3 5"
            />
            <circle cx="210" cy="107" r="5" fill="#7167a4" />
            <path d="M97 42h-34m260 110h35" stroke="#b1adcb" />
            <circle cx="97" cy="42" r="4" fill="#7167a4" />
            <circle cx="323" cy="152" r="4" fill="#7167a4" />
          </>
        ) : kind === 'process' ? (
          <>
            <path d="M92 105h236" stroke="#a8bcb0" strokeWidth="3" />
            {[100, 210, 320].map((x, i) => (
              <g key={x}>
                <rect
                  x={x - 34}
                  y="72"
                  width="68"
                  height="68"
                  rx="20"
                  fill={i === 1 ? '#bed7ca' : '#e0eae4'}
                  stroke="#7e9f8c"
                />
                <path d={`m${x - 10} 104 7 8 15-17`} stroke="#557664" strokeWidth="3" />
              </g>
            ))}
          </>
        ) : kind === 'diagram' ? (
          <>
            <path d="M120 143 210 63l90 80M120 143h180" stroke="#c7a271" strokeWidth="2" />
            {[
              [120, 143],
              [210, 63],
              [300, 143],
            ].map(([x, y], i) => (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r="28"
                  fill={i === 1 ? '#f0d7ae' : '#f5e8d3'}
                  stroke="#bd9965"
                />
                <circle cx={x} cy={y} r="7" fill="#b48c53" />
              </g>
            ))}
          </>
        ) : (
          <>
            <path
              d="M210 65c-30-18-62-18-92-5v96c30-13 62-13 92 5 30-18 62-18 92-5V60c-30-13-62-13-92 5z"
              fill="#dfdfe4"
              stroke="#a1a1ad"
              strokeWidth="2"
            />
            <path
              d="M210 65v96m-70-78h45m-45 20h45m50-20h45m-45 20h45"
              stroke="#a1a1ad"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      <span>
        <Icon size={14} />
        {kind === 'model'
          ? 'Interactive 3D'
          : kind === 'diagram'
            ? 'Visual diagram'
            : kind === 'process'
              ? 'Step by step'
              : 'Guided lesson'}
      </span>
    </div>
  );
}
