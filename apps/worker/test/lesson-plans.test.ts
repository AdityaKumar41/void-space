import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, demoId } from '@void-space/db';
import { lessonTemplate, type LessonPlan } from '@void-space/types';
import {
  generateLessonPlanTask,
  renderLessonExport,
  validateGeneratedPlan,
} from '../src/learning/lesson-plans';
import { extractLearningPdf } from '../src/processors/learning';
import { unzipSync, strFromU8 } from 'fflate';
const tenantId = demoId('tenant:aurora');
let ownerId = '',
  url = '',
  response = '';
const responses: string[] = [];
const tasks: string[] = [],
  plans: string[] = [];
const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: responses.shift() ?? response }, finish_reason: 'stop' }],
        model: 'test-local',
      }),
    );
  });
});
const example = () =>
  lessonTemplate({
    topic: 'Evidence and learning',
    audience: 'Learners aged 13+',
    durationMinutes: 30,
    instructions: '',
    sourceIds: [],
  });
beforeAll(async () => {
  ownerId = await withTenant(
    tenantId,
    async (db) => (await db.user.findFirstOrThrow({ where: { email: 'creator@aurora.dev' } })).id,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await withTenant(tenantId, async (db) => {
    await db.lessonPlan.deleteMany({ where: { id: { in: plans } } });
    await db.learningTask.deleteMany({ where: { id: { in: tasks } } });
  });
});
async function task() {
  const id = randomUUID();
  tasks.push(id);
  await withTenant(tenantId, (db) =>
    db.learningTask.create({ data: { id, tenantId, ownerId, kind: 'plan_generate', input: {} } }),
  );
  return id;
}
describe('lesson generation and real export files', () => {
  it('rejects invalid timing, unknown citations and invalid answer keys', () => {
    const def = example();
    def.sections[0]!.minutes++;
    expect(() => validateGeneratedPlan(JSON.stringify(def), [])).toThrow();
    const refs = example();
    refs.sections[0]!.sourceRefs = [{ sourceId: randomUUID(), passageId: 'invented' }];
    expect(() => validateGeneratedPlan(JSON.stringify(refs), [])).toThrow('citation');
    const invalid = example();
    const q = invalid.sections.find((s) => s.kind === 'quiz')!.activity!.steps[0]!;
    if (q.kind === 'choice') q.correctIds = ['invented'];
    expect(() => validateGeneratedPlan(JSON.stringify(invalid), [])).toThrow();
  });
  it('uses the existing AI abstraction, saves an unverified draft once, and handles unavailable AI', async () => {
    const id = await task();
    response = JSON.stringify(example());
    const input = {
      request: {
        topic: 'Evidence and learning',
        audience: 'Learners aged 13+',
        durationMinutes: 30,
        instructions: '',
        sourceIds: [],
      },
    };
    const result = await generateLessonPlanTask(tenantId, id, ownerId, input, {
      AI_TEXT_BASE_URL: url,
      AI_TEXT_PROTOCOL: 'openai',
      AI_TEXT_MODEL: 'test-local',
    });
    plans.push(result.planId as string);
    expect(result.unverified).toBe(true);
    const repeat = await generateLessonPlanTask(tenantId, id, ownerId, input, {
      AI_TEXT_BASE_URL: url,
      AI_TEXT_PROTOCOL: 'openai',
      AI_TEXT_MODEL: 'test-local',
    });
    expect(repeat.planId).toBe(result.planId);
    await expect(
      generateLessonPlanTask(tenantId, await task(), ownerId, input, {}),
    ).rejects.toThrow('editable lesson structure');
  });
  it('rejects a section proposal that changes unrelated material', async () => {
    const def = example();
    response = JSON.stringify({
      ...def,
      sections: def.sections.map((s, i) =>
        i === 1 ? { ...s, body: 'This unrelated section was changed.' } : s,
      ),
    });
    await expect(
      generateLessonPlanTask(
        tenantId,
        await task(),
        ownerId,
        {
          planId: randomUUID(),
          baseRevision: 0,
          definition: def,
          sectionId: def.sections[0]!.id,
          instruction: 'Simplify the selected section',
        },
        { AI_TEXT_BASE_URL: url, AI_TEXT_PROTOCOL: 'openai', AI_TEXT_MODEL: 'test-local' },
      ),
    ).rejects.toThrow('valid response');
  });
  it('repairs one invalid generated answer key through AI and validates the repaired draft', async () => {
    const invalid = example();
    const q = invalid.sections[3]!.activity!.steps[0]!;
    if (q.kind === 'choice') q.correctIds = ['missing'];
    responses.push(JSON.stringify(invalid), JSON.stringify(example()));
    const result = await generateLessonPlanTask(
      tenantId,
      await task(),
      ownerId,
      {
        request: {
          topic: 'Evidence and learning',
          audience: 'Learners aged 13+',
          durationMinutes: 30,
          instructions: '',
          sourceIds: [],
        },
      },
      { AI_TEXT_BASE_URL: url, AI_TEXT_PROTOCOL: 'openai', AI_TEXT_MODEL: 'test-local' },
      true,
    );
    expect(result.definition).toMatchObject({ durationMinutes: 30 });
    expect(responses).toHaveLength(0);
  });
  it('exports a readable PDF without hidden answers or instructor notes', async () => {
    const def = example();
    def.sections[0]!.notes = 'INSTRUCTOR_SECRET';
    const q = def.sections.find((s) => s.kind === 'quiz')!.activity!.steps[0]!;
    q.explanation = 'ANSWER_EXPLANATION_SECRET';
    const student = await renderLessonExport(
      def,
      'pdf',
      false,
      null,
      'https://example.test/lesson',
    );
    expect(student.subarray(0, 5).toString()).toBe('%PDF-');
    const text = (await extractLearningPdf(student)).map((p) => p.text).join(' ');
    expect(text).toContain(def.title);
    expect(text).not.toContain('INSTRUCTOR_SECRET');
    expect(text).not.toContain('ANSWER_EXPLANATION_SECRET');
    const teacher = await renderLessonExport(def, 'pdf', true, null, 'https://example.test/lesson');
    const teacherText = (await extractLearningPdf(teacher)).map((p) => p.text).join(' ');
    expect(teacherText).toContain('INSTRUCTOR_SECRET');
    expect(teacherText).toContain('ANSWER_EXPLANATION_SECRET');
  });
  it('exports an editable PPTX with speaker notes and interactive links', async () => {
    const def = example();
    def.sections[0]!.notes = 'INSTRUCTOR_SPEAKER_NOTES';
    const pptx = await renderLessonExport(def, 'pptx', true, null, 'https://example.test/lesson');
    const files = unzipSync(pptx);
    expect(files['[Content_Types].xml']).toBeTruthy();
    expect(strFromU8(files['ppt/slides/slide1.xml']!)).toContain('Evidence and learning');
    const notes = Object.entries(files)
      .filter(([k]) => k.startsWith('ppt/notesSlides/') && k.endsWith('.xml'))
      .map(([, v]) => strFromU8(v))
      .join('');
    expect(notes).toContain('INSTRUCTOR_SPEAKER_NOTES');
    expect(strFromU8(files['ppt/slides/_rels/slide1.xml.rels']!)).toContain(
      'https://example.test/lesson',
    );
  });
});
