import type { Passage } from './documents';
/** Keep passage identity while selecting relevant excerpts from every attached document. */
export function retrieveLearningSources(
  sources: { id: string; title: string; passages: unknown }[],
  query: string,
  budget = 36000,
) {
  const terms = new Set(
    (query.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
      (t) =>
        ![
          'lesson',
          'create',
          'about',
          'using',
          'these',
          'with',
          'from',
          'please',
          'minutes',
          'learners',
        ].includes(t),
    ),
  );
  const perSource = Math.max(500, Math.floor(budget / Math.max(1, sources.length)));
  return sources.map((source) => {
    const passages = Array.isArray(source.passages)
      ? (source.passages as unknown as Passage[])
      : [];
    const ranked = passages
      .map((p, index) => ({
        p,
        index,
        score: [...terms].reduce((n, t) => n + (p.text.toLowerCase().includes(t) ? 1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    let remaining = Math.min(perSource, 10000);
    const selected: Passage[] = [];
    for (const { p } of ranked.slice(0, 3)) {
      if (remaining < 100) break;
      const text = p.text.slice(0, remaining);
      selected.push({ ...p, text });
      remaining -= text.length;
    }
    return { id: source.id, title: source.title, passages: selected };
  });
}
