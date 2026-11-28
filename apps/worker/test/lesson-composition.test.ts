import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { composeLessonDraft, composeLessonSectionDraft } from '../src/learning/lesson-composition';
function content() {
  return {
    title: 'Spheres and their properties',
    summary: 'Explore a sphere and compare its curved surface with flat faces.',
    audience: 'Learners aged 13+',
    durationMinutes: 15,
    objectives: ['Describe a sphere’s curved surface'],
    sections: ['introduction', 'explanation', 'exploration', 'quiz', 'recap'].map((kind, i) => ({
      id: `section_${i}`,
      kind,
      title: `Learning section ${i + 1}`,
      minutes: 3,
      body: 'A sphere has a curved surface. All surface points are the same distance from its center.',
      notes: '',
      sourceRefs: [],
      ...(kind === 'quiz'
        ? {
            quiz: {
              prompt: 'Which statement describes a sphere?',
              choices: [
                { id: 'curved', label: 'It has a curved surface' },
                { id: 'flat', label: 'It has only flat faces' },
              ],
              correctIds: ['curved'],
              explanation: 'A sphere has a curved surface.',
            },
          }
        : {}),
    })),
  };
}
describe('trusted lesson content composition', () => {
  it('attaches the selected private model and reviewed labels without generated viewer code', () => {
    const id = randomUUID(),
      def = composeLessonDraft(content(), {
        sourceIds: [],
        privateModelId: id,
        model: {
          id,
          title: 'Sphere',
          metadata: {
            labelsReviewed: true,
            labels: [
              {
                id: 'surface',
                label: 'Surface',
                meshKey: 'mesh-0',
                position: [0, 0, 0],
                explanation: 'The curved surface of the sphere.',
              },
            ],
          },
        },
      });
    expect(def.privateModelId).toBe(id);
    expect(def.sections[2]!.activity?.scene).toEqual({ kind: 'model', privateModelId: id });
    expect(def.sections[2]!.activity?.targets[0]?.meshKey).toBe('mesh-0');
    expect(def.sections[3]!.activity?.steps[0]).toMatchObject({
      kind: 'choice',
      correctIds: ['curved'],
    });
  });
  it('includes lesson-owned annotation explanations without inventing geometric mappings', () => {
    const raw = content();
    Object.assign(raw.sections[2]!, {
      annotations: [
        {
          id: 'surface',
          label: 'Curved surface',
          explanation: 'The curved exterior encloses the sphere.',
          sourceRefs: [],
        },
      ],
    });
    const id = randomUUID();
    const def = composeLessonDraft(raw, {
      sourceIds: [],
      privateModelId: id,
      model: { id, title: 'Sphere', metadata: {} },
    });
    expect(def.sections[2]!.activity!.targets[0]).toMatchObject({
      label: 'Curved surface',
      placement: 'unplaced',
      position: [0, 0, 0],
    });
    expect(def.sections[2]!.activity!.targets[0]!.meshKey).toBeUndefined();
  });
  it('distinguishes a selected model reference from invalid text citations', () => {
    const id = randomUUID(),
      raw = content();
    raw.sections[2]!.sourceRefs = [{ sourceId: id, passageId: null }] as never;
    raw.sections[3]!.body = '';
    const def = composeLessonDraft(raw, {
      sourceIds: [],
      privateModelId: id,
      model: { id, title: 'Sphere', metadata: { labelsReviewed: false } },
    });
    expect(def.sections[2]!.sourceRefs).toEqual([]);
    expect(def.sections[2]!.activity?.scene).toEqual({ kind: 'model', privateModelId: id });
    expect(def.sections[3]!.body).toContain('question below');
    raw.sections[2]!.sourceRefs = [{ sourceId: randomUUID(), passageId: null }] as never;
    expect(() => composeLessonDraft(raw, { sourceIds: [] })).toThrow();
  });
  it('does not promote unverified component labels into a lesson', () => {
    const id = randomUUID(),
      def = composeLessonDraft(content(), {
        sourceIds: [],
        privateModelId: id,
        model: {
          id,
          title: 'Unidentified anatomy',
          metadata: { labelsReviewed: false, labels: [{ id: 'guess', label: 'Guessed organ' }] },
        },
      });
    expect(def.sections[2]!.activity?.targets).toEqual([]);
  });
  it('rejects missing/invalid answer keys and allocates the requested duration without changing answers', () => {
    const missing = content();
    delete (missing.sections[3] as { quiz?: unknown }).quiz;
    expect(() => composeLessonDraft(missing, { sourceIds: [] })).toThrow('answer key');
    const bad = content();
    bad.sections[3]!.quiz!.correctIds = ['unknown'];
    expect(() => composeLessonDraft(bad, { sourceIds: [] })).toThrow();
    const timing = content();
    timing.durationMinutes = 20;
    const timed = composeLessonDraft(timing, { sourceIds: [], durationMinutes: 30 });
    expect(timed.durationMinutes).toBe(30);
    expect(timed.sections.reduce((n, s) => n + s.minutes, 0)).toBe(30);
  });
});

it('composes a single focused section while retaining all other lesson bytes and timing', () => {
  const original = composeLessonDraft(content(), { sourceIds: [] });
  const section = {
    ...content().sections[4]!,
    body: 'A clearer recap with a short self-check and a revision suggestion.',
  };
  const result = composeLessonSectionDraft({ section }, { sourceIds: [], original }, section.id);
  expect(result.sections[4]!.body).toBe(section.body);
  expect(result.sections.slice(0, 4)).toEqual(original.sections.slice(0, 4));
  expect(result.durationMinutes).toBe(original.durationMinutes);
  expect(() =>
    composeLessonSectionDraft(
      { section: { ...section, minutes: 10 } },
      { sourceIds: [], original },
      section.id,
    ),
  ).toThrow('timing');
  expect(() =>
    composeLessonSectionDraft(
      { section, otherSections: [] },
      { sourceIds: [], original },
      section.id,
    ),
  ).toThrow();
});
