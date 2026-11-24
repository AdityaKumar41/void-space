'use client';
import type { LessonPlan, LearningActivity } from '@void-space/types';
import { control, action } from './learning-ui';
export function LessonSectionEditor({
  section,
  onChange,
  sources,
}: {
  section: LessonPlan['sections'][number];
  onChange: (s: LessonPlan['sections'][number]) => void;
  sources: { id: string; title: string; passages: { id: string; page: number; text: string }[] }[];
}) {
  const updateActivity = (a: LearningActivity) => onChange({ ...section, activity: a });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <label className="grid gap-2">
          Section title
          <input
            className={control}
            value={section.title}
            maxLength={160}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
          />
        </label>
        <label className="grid gap-2">
          Minutes
          <input
            type="number"
            min={1}
            max={180}
            className={control}
            value={section.minutes}
            onChange={(e) => onChange({ ...section, minutes: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className="grid gap-2">
        Lesson content
        <textarea
          className={control + ' min-h-44'}
          maxLength={8000}
          value={section.body}
          onChange={(e) => onChange({ ...section, body: e.target.value })}
        />
      </label>
      <label className="grid gap-2">
        Private teaching notes
        <textarea
          className={control + ' min-h-24'}
          maxLength={4000}
          value={section.notes}
          onChange={(e) => onChange({ ...section, notes: e.target.value })}
        />
      </label>
      <label className="grid gap-2">
        Source references
        <select
          multiple
          className={control + ' min-h-24'}
          value={section.sourceRefs.map((r) => `${r.sourceId}:${r.passageId}`)}
          onChange={(e) =>
            onChange({
              ...section,
              sourceRefs: Array.from(e.target.selectedOptions).map((o) => {
                const [sourceId, passageId] = o.value.split(':');
                return { sourceId: sourceId!, passageId: passageId! };
              }),
            })
          }
        >
          {sources.flatMap((s) =>
            s.passages.map((p) => (
              <option value={`${s.id}:${p.id}`} key={`${s.id}:${p.id}`}>
                {s.title} · page {p.page} · {p.id}
              </option>
            )),
          )}
        </select>
        <span className="text-sm text-ink-dim">
          Select the passages supporting this section. Without references, facts require your
          independent review.
        </span>
      </label>
      {section.activity && (
        <details open>
          <summary className="cursor-pointer py-2 font-semibold">
            Visual and inline activity
          </summary>
          <div className="mt-3 space-y-5">
            {section.activity.targets.map((t, i) => (
              <fieldset key={t.id} className="space-y-3 rounded-lg border border-hairline p-3">
                <legend>Component {i + 1}</legend>
                <label className="grid gap-2">
                  Name
                  <input
                    className={control}
                    value={t.label}
                    maxLength={100}
                    onChange={(e) =>
                      updateActivity({
                        ...section.activity!,
                        targets: section.activity!.targets.map((n) =>
                          n.id === t.id ? { ...n, label: e.target.value } : n,
                        ),
                      })
                    }
                  />
                </label>
                <label className="grid gap-2">
                  Reviewed explanation
                  <textarea
                    className={control}
                    value={t.explanation}
                    maxLength={2000}
                    onChange={(e) =>
                      updateActivity({
                        ...section.activity!,
                        targets: section.activity!.targets.map((n) =>
                          n.id === t.id ? { ...n, explanation: e.target.value } : n,
                        ),
                      })
                    }
                  />
                </label>
                {[0, 1, 2].map((axis) => (
                  <label className="grid gap-1 text-sm" key={axis}>
                    {['Horizontal', 'Vertical', 'Depth'][axis]} position
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={t.position[axis]}
                      onChange={(e) => {
                        const position = [...t.position] as [number, number, number];
                        position[axis] = Number(e.target.value);
                        updateActivity({
                          ...section.activity!,
                          targets: section.activity!.targets.map((n) =>
                            n.id === t.id ? { ...n, position } : n,
                          ),
                        });
                      }}
                    />
                  </label>
                ))}
                {section.activity!.scene.kind === 'model' && (
                  <label className="grid gap-2">
                    Confirmed mesh key (optional)
                    <input
                      className={control}
                      value={t.meshKey ?? ''}
                      onChange={(e) =>
                        updateActivity({
                          ...section.activity!,
                          targets: section.activity!.targets.map((n) => {
                            if (n.id !== t.id) return n;
                            const { meshKey, ...rest } = n;
                            return {
                              ...rest,
                              ...(e.target.value ? { meshKey: e.target.value } : {}),
                            };
                          }),
                        })
                      }
                    />
                    <span className="text-sm text-ink-dim">
                      Leave blank for an annotation hotspot. Only use a key you confirmed in the
                      model preview.
                    </span>
                  </label>
                )}
              </fieldset>
            ))}
            {section.activity.scene.kind !== 'none' && (
              <button
                className={action}
                onClick={() =>
                  updateActivity({
                    ...section.activity!,
                    targets: [
                      ...section.activity!.targets,
                      {
                        id: `part_${Date.now()}`,
                        label: 'New component',
                        explanation: '',
                        position: [0, 0, 0],
                        sourceRefs: [],
                      },
                    ],
                  })
                }
              >
                Add component hotspot
              </button>
            )}
            {section.activity.steps.map((q, i) => (
              <fieldset key={q.id} className="space-y-3 rounded-lg border border-hairline p-3">
                <legend>
                  Question {i + 1} · {q.kind}
                </legend>
                <label className="grid gap-2">
                  Instruction
                  <textarea
                    className={control}
                    maxLength={1500}
                    value={q.instruction}
                    onChange={(e) =>
                      updateActivity({
                        ...section.activity!,
                        steps: section.activity!.steps.map((n) =>
                          n.id === q.id ? { ...n, instruction: e.target.value } : n,
                        ),
                      })
                    }
                  />
                </label>
                <label className="grid gap-2">
                  Explanation after the answer
                  <textarea
                    className={control}
                    value={q.explanation}
                    maxLength={2000}
                    onChange={(e) =>
                      updateActivity({
                        ...section.activity!,
                        steps: section.activity!.steps.map((n) =>
                          n.id === q.id ? { ...n, explanation: e.target.value } : n,
                        ),
                      })
                    }
                  />
                </label>
                {q.kind === 'choice' &&
                  q.choices.map((c) => (
                    <label className="flex items-center gap-3" key={c.id}>
                      <input
                        type="checkbox"
                        aria-label={`Correct answer: ${c.label}`}
                        checked={q.correctIds.includes(c.id)}
                        onChange={() =>
                          updateActivity({
                            ...section.activity!,
                            steps: section.activity!.steps.map((n) =>
                              n.id === q.id
                                ? {
                                    ...q,
                                    correctIds: q.correctIds.includes(c.id)
                                      ? q.correctIds.filter((x) => x !== c.id)
                                      : [...q.correctIds, c.id],
                                  }
                                : n,
                            ),
                          })
                        }
                      />
                      <input
                        aria-label={`Answer option ${c.id}`}
                        className={control + ' w-full'}
                        maxLength={300}
                        value={c.label}
                        onChange={(e) =>
                          updateActivity({
                            ...section.activity!,
                            steps: section.activity!.steps.map((n) =>
                              n.id === q.id
                                ? {
                                    ...q,
                                    choices: q.choices.map((x) =>
                                      x.id === c.id ? { ...x, label: e.target.value } : x,
                                    ),
                                  }
                                : n,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                {q.kind === 'identify' && (
                  <label className="grid gap-2">
                    Correct component
                    <select
                      className={control}
                      value={q.targetId}
                      onChange={(e) =>
                        updateActivity({
                          ...section.activity!,
                          steps: section.activity!.steps.map((n) =>
                            n.id === q.id ? { ...q, targetId: e.target.value } : n,
                          ),
                        })
                      }
                    >
                      {section.activity!.targets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {q.kind === 'order' && (
                  <label className="grid gap-2">
                    Correct sequence (item IDs, one per line)
                    <textarea
                      className={control}
                      value={q.correctOrder.join('\n')}
                      onChange={(e) =>
                        updateActivity({
                          ...section.activity!,
                          steps: section.activity!.steps.map((n) =>
                            n.id === q.id
                              ? { ...q, correctOrder: e.target.value.split('\n').filter(Boolean) }
                              : n,
                          ),
                        })
                      }
                    />
                    <span className="text-sm">
                      {q.items.map((x) => `${x.id}: ${x.label}`).join(' · ')}
                    </span>
                  </label>
                )}
                {q.kind === 'match' &&
                  q.left.map((l) => (
                    <label key={l.id} className="grid gap-2">
                      {l.label}
                      <select
                        className={control}
                        value={q.pairs[l.id] ?? ''}
                        onChange={(e) =>
                          updateActivity({
                            ...section.activity!,
                            steps: section.activity!.steps.map((n) =>
                              n.id === q.id
                                ? { ...q, pairs: { ...q.pairs, [l.id]: e.target.value } }
                                : n,
                            ),
                          })
                        }
                      >
                        <option value="">Choose the reviewed match</option>
                        {q.right.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
              </fieldset>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
