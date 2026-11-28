import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { lessonTemplate } from '@void-space/types';
import { starterActivity } from '../../api/src/modules/learning-hub/starters';
import { composeAnnotationProposal } from '../src/learning/lesson-annotations';
const plan = () =>
  lessonTemplate(
    {
      topic: 'Geometry study',
      audience: 'Learners aged 13+',
      durationMinutes: 30,
      instructions: '',
      sourceIds: [],
    },
    starterActivity('geometry')!,
  );
const label = {
  id: 'surface',
  label: 'Surface',
  explanation: 'The outside surface bounds this geometric solid.',
  sourceRefs: [],
};
describe('lesson annotation proposals', () => {
  it('adds explanations to the lesson while leaving other sections, timing and model intact', () => {
    const def = plan(),
      s = def.sections.find((s) => s.activity?.scene.kind === 'model')!;
    const out = composeAnnotationProposal(def, s.id, { labels: [label] }, []);
    expect(out.sections.find((x) => x.id === s.id)!.activity!.targets[0]).toMatchObject({
      ...label,
      position: [0, 0, 0],
      placement: 'unplaced',
    });
    expect(out.sections.filter((x) => x.id !== s.id)).toEqual(
      def.sections.filter((x) => x.id !== s.id),
    );
    expect(out.durationMinutes).toBe(def.durationMinutes);
  });
  it('uses only sampled surface positions and leaves unsupported pins unplaced', () => {
    const def = plan(),
      s = def.sections.find((s) => s.activity?.scene.kind === 'model')!;
    const out = composeAnnotationProposal(
      def,
      s.id,
      { labels: [{ ...label, viewIndex: 0, pixel: [0.5, 0.5] }] },
      [],
      [
        {
          name: 'front',
          image: '',
          anchors: [{ x: 0.5, y: 0.5, position: [0.1, 0.2, 0.3], meshKey: 'mesh-0' }],
        },
      ],
    );
    expect(out.sections.find((x) => x.id === s.id)!.activity!.targets[0]).toMatchObject({
      position: [0.1, 0.2, 0.3],
      meshKey: 'mesh-0',
      placement: 'suggested',
    });
    const bad = composeAnnotationProposal(
      def,
      s.id,
      { labels: [{ ...label, viewIndex: 4, pixel: [0, 0] }] },
      [],
    );
    expect(bad.sections.find((x) => x.id === s.id)!.activity!.targets[0]!.placement).toBe(
      'unplaced',
    );
  });
  it('rejects invented citations, duplicate IDs and unknown sections', () => {
    const def = plan(),
      s = def.sections.find((s) => s.activity?.scene.kind === 'model')!;
    expect(() =>
      composeAnnotationProposal(
        def,
        s.id,
        { labels: [{ ...label, sourceRefs: [{ sourceId: randomUUID(), passageId: 'fake' }] }] },
        [],
      ),
    ).toThrow('source');
    expect(() => composeAnnotationProposal(def, s.id, { labels: [label, label] }, [])).toThrow(
      'unique',
    );
    expect(() => composeAnnotationProposal(def, 'missing', { labels: [label] }, [])).toThrow(
      'exploration',
    );
  });
  it('keeps a confirmed placement when refining a component explanation', () => {
    const def = plan(),
      s = def.sections.find((s) => s.activity?.scene.kind === 'model')!;
    s.activity!.targets.unshift({
      ...label,
      position: [0.2, 0.3, 0.4],
      meshKey: 'mesh-0',
      placement: 'confirmed',
    });
    const out = composeAnnotationProposal(def, s.id, { labels: [label] }, []);
    expect(out.sections.find((x) => x.id === s.id)!.activity!.targets[0]).toMatchObject({
      position: [0.2, 0.3, 0.4],
      placement: 'confirmed',
    });
  });
});
