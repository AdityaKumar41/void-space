import { learningToolProgress } from './progress';
import {
  composeLessonDraft,
  compactLessonPrompt,
  type CompositionContext,
} from './lesson-composition';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  withTenant,
  learningStorageRoot,
  isLearningStoragePath,
  type Prisma,
} from '@void-space/db';
import { lessonPlanSchema, lessonPlanRequestSchema, type LessonPlan } from '@void-space/types';
import {
  generateText,
  isTextAiConfigured,
  type TextAiConfig,
  type TextRequest,
} from '@void-space/studio-ai/text';
import { UnrecoverableError } from 'bullmq';
import PDFDocument from 'pdfkit';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import { z } from 'zod';
const json = (value: unknown) => value as Prisma.InputJsonValue;
const clean = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/→/g, 'to');

export function validateGeneratedPlan(
  text: string,
  sources: { id: string; passages: unknown }[],
  pinned?: LessonPlan,
) {
  const def = lessonPlanSchema.parse(JSON.parse(text));
  const refs = new Set(
    sources.flatMap((s) => (s.passages as { id: string }[]).map((p) => `${s.id}:${p.id}`)),
  );
  for (const s of def.sections)
    for (const n of [
      s,
      ...(s.activity ? [...s.activity.blocks, ...s.activity.targets, ...s.activity.steps] : []),
    ]) {
      if (n.sourceRefs.some((r) => !refs.has(`${r.sourceId}:${r.passageId}`)))
        throw new Error('Generated citation is not a supplied source passage');
    }
  if (def.sourceIds.some((id) => !sources.some((s) => s.id === id)))
    throw new Error('Generated source is not available');
  if (
    pinned &&
    (def.assetId !== pinned.assetId ||
      def.assetVersionId !== pinned.assetVersionId ||
      def.sketchfabUrl !== pinned.sketchfabUrl ||
      def.privateModelId !== pinned.privateModelId)
  )
    throw new Error('The proposal changed the selected asset or reference');
  return def;
}
export async function generateLessonPlanTask(
  tenantId: string,
  taskId: string,
  ownerId: string,
  input: unknown,
  textAi: TextAiConfig,
  draftOnly = false,
) {
  if (!isTextAiConfigured(textAi))
    throw new UnrecoverableError(
      'AI is unavailable. Your inputs are saved; use the editable lesson structure or retry after configuring a provider.',
    );
  const data = input as {
    request?: unknown;
    asset?: Record<string, unknown> | null;
    model?: { id: string; title: string; metadata: unknown } | null;
    definition?: unknown;
    planId?: string;
    baseRevision?: number;
    instruction?: string;
    sectionId?: string;
  };
  const original = data.definition ? lessonPlanSchema.parse(data.definition) : undefined;
  const request = data.request ? lessonPlanRequestSchema.parse(data.request) : undefined;
  const selectedPrivate = original?.privateModelId ?? request?.privateModelId;
  if (selectedPrivate && !data.model) {
    const model = await withTenant(tenantId, (db) =>
      db.learningSource.findFirst({
        where: { id: selectedPrivate, ownerId, mime: 'model/gltf-binary', status: 'ready' },
      }),
    );
    if (!model) throw new UnrecoverableError('The selected private model is unavailable.');
    data.model = { id: model.id, title: model.title, metadata: model.metadata };
  }
  const sourceIds = original?.sourceIds ?? request!.sourceIds;
  const sources = await withTenant(tenantId, (db) =>
    db.learningSource.findMany({
      where: { id: { in: sourceIds }, ownerId, status: 'ready' },
      select: { id: true, title: true, passages: true },
    }),
  );
  if (sources.length !== new Set(sourceIds).size)
    throw new UnrecoverableError(
      'Some private sources are unavailable. Select ready sources and try again.',
    );
  await learningToolProgress(
    tenantId,
    taskId,
    'write',
    'Writing your lesson',
    'working',
    'Building the sequence, explanations and knowledge checks',
  );
  const bounded = sources.map((s) => ({
    ...s,
    passages: (s.passages as { id: string; page: number; text: string }[]).slice(0, 4),
  }));
  const composition: CompositionContext = {
    sourceIds,
    durationMinutes: request?.durationMinutes,
    privateModelId: original?.privateModelId ?? request?.privateModelId,
    sketchfabUrl: original?.sketchfabUrl ?? request?.sketchfabUrl,
    model: data.model,
    asset: data.asset as CompositionContext['asset'],
    original,
  };
  const parseOutput = (text: string) => {
    const definition = composeLessonDraft(JSON.parse(text), composition);
    return validateGeneratedPlan(JSON.stringify(definition), bounded, original);
  };
  let proposal: LessonPlan | undefined;
  let lastInvalidText = '',
    validationError = '';
  const generationTimeout = z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .parse(process.env.LEARNING_GENERATION_TIMEOUT_MS ?? 90000);
  const generationRequest: TextRequest = {
    maxTokens: 2800,
    json: true,
    temperature: 0.2,
    messages: [
      { role: 'system', content: compactLessonPrompt },
      { role: 'user', content: JSON.stringify({ ...data, sources: bounded }) },
    ],
    validate: (text) => {
      lastInvalidText = text;
      try {
        proposal = parseOutput(text);
        if (request && proposal.durationMinutes !== request.durationMinutes)
          throw new Error('Lesson timing differs from requested duration');
        if (
          request &&
          (proposal.assetId !== (data.asset?.id ?? undefined) ||
            proposal.assetVersionId !== (data.asset?.versionId ?? undefined))
        )
          throw new Error('Use the approved selected model version');
        if (request && proposal.privateModelId !== request.privateModelId)
          throw new Error('Use the selected private model');
        const privateId = original?.privateModelId ?? request?.privateModelId;
        for (const section of proposal.sections)
          if (section.activity?.scene.kind === 'model') {
            const scene = section.activity.scene;
            if (scene.privateModelId && scene.privateModelId !== privateId)
              throw new Error('Unknown private model');
            if (scene.privateModelId && data.model) {
              const parts = (data.model.metadata as { parts: { key: string }[] }).parts;
              if (
                section.activity.targets.some(
                  (t) => t.meshKey && !parts.some((p) => p.key === t.meshKey),
                )
              )
                throw new Error('Unknown mesh mapping');
            }
          }
        const chosenAsset = original?.assetId ?? request?.assetId,
          chosenPrivate = original?.privateModelId ?? request?.privateModelId;
        if (
          chosenPrivate &&
          !proposal.sections.some(
            (s) =>
              s.activity?.scene.kind === 'model' &&
              s.activity.scene.privateModelId === chosenPrivate,
          )
        )
          throw new Error('Include an interactive visual using the selected private model');
        if (
          chosenAsset &&
          !proposal.sections.some(
            (s) => s.activity?.scene.kind === 'model' && s.activity.scene.assetId === chosenAsset,
          )
        )
          throw new Error('Include an interactive visual using the selected asset');
        if (data.sectionId && original) {
          if (proposal.sections.length !== original.sections.length)
            throw new Error('A section revision cannot add or remove other sections');
          for (const s of original.sections)
            if (
              s.id !== data.sectionId &&
              JSON.stringify(s) !== JSON.stringify(proposal.sections.find((n) => n.id === s.id))
            )
              throw new Error('The proposal changed an unrelated section');
        }
      } catch (error) {
        validationError = error instanceof Error ? error.message : 'Invalid lesson structure';
        throw error;
      }
    },
  };
  const deadline = Date.now() + generationTimeout;
  let output;
  let repaired = false;
  try {
    output = await generateText(
      {
        ...textAi,
        ...(process.env.LEARNING_GENERATION_MODEL?.trim()
          ? { AI_TEXT_MODEL: process.env.LEARNING_GENERATION_MODEL.trim() }
          : {}),
        AI_TEXT_TIMEOUT_MS: Math.min(generationTimeout, 60000),
      },
      generationRequest,
    );
  } catch (error) {
    const remaining = deadline - Date.now();
    if (!lastInvalidText || remaining < 1000) throw error;
    repaired = true;
    await learningToolProgress(
      tenantId,
      taskId,
      'repair',
      'Refining the draft',
      'working',
      'Correcting a draft that did not pass validation',
    );
    // One bounded repair of invalid output; answer keys and citations still pass the same validator.
    output = await generateText(
      {
        ...textAi,
        AI_TEXT_MODEL:
          process.env.LEARNING_GENERATION_MODEL?.trim() ||
          textAi.AI_TEXT_FALLBACK_MODEL ||
          textAi.AI_TEXT_MODEL,
        AI_TEXT_FALLBACK_MODEL: undefined,
        AI_TEXT_TIMEOUT_MS: remaining,
      },
      {
        ...generationRequest,
        messages: [
          ...generationRequest.messages,
          { role: 'assistant', content: lastInvalidText.slice(0, 40000) },
          {
            role: 'user',
            content: `The draft failed validation: ${validationError.slice(0, 3000)}. Correct the JSON structure using only the supplied source passages. Use sourceRefs:[] for unsupported or model-only sections; NEVER use null or nonexistent passage IDs. Every body needs at least 10 characters. Use kind "quiz" only when its quiz object has explicit valid choices and correctIds. Do not add facts or invent answer keys. Return only corrected lesson JSON.`,
          },
        ],
      },
    );
  }
  if (repaired)
    await learningToolProgress(tenantId, taskId, 'repair', 'Refining the draft', 'complete');
  await learningToolProgress(tenantId, taskId, 'write', 'Writing your lesson', 'complete');
  await learningToolProgress(
    tenantId,
    taskId,
    'check',
    'Checking answers and references',
    'working',
  );
  const definition = parseOutput(output.text);
  if (request && definition.privateModelId !== request.privateModelId)
    throw new Error('The generated lesson changed the selected private model');
  for (const s of definition.sections) if (s.activity) s.activity.reviewed = false;
  await learningToolProgress(
    tenantId,
    taskId,
    'check',
    'Checking answers and references',
    'complete',
    'Draft ready for your review',
  );
  if (draftOnly) return { definition, unverified: true };
  if (original)
    return { definition, planId: data.planId, baseRevision: data.baseRevision, proposal: true };
  return withTenant(tenantId, async (db) => {
    await db.$queryRaw`SELECT id FROM learning_tasks WHERE id=${taskId}::uuid FOR UPDATE`;
    const task = await db.learningTask.findUniqueOrThrow({ where: { id: taskId } });
    if (task.status === 'completed') return task.result as Record<string, unknown>;
    const plan = await db.lessonPlan.create({
      data: { tenantId, ownerId, title: definition.title, definition: json(definition) },
    });
    const result = { planId: plan.id, definition, unverified: true };
    await db.learningTask.update({
      where: { id: taskId },
      data: { status: 'completed', result: json(result) },
    });
    return result;
  });
}
interface ExportProgress {
  completed?: string[];
  activities?: Record<string, { mistakes: number; feedback: string; status: string }>;
}
function answerText(
  step: NonNullable<LessonPlan['sections'][number]['activity']>['steps'][number],
) {
  if (step.kind === 'choice')
    return step.choices
      .filter((c) => step.correctIds.includes(c.id))
      .map((c) => c.label)
      .join('; ');
  if (step.kind === 'order')
    return step.correctOrder.map((id) => step.items.find((x) => x.id === id)?.label).join(' → ');
  if (step.kind === 'match')
    return Object.entries(step.pairs)
      .map(
        ([a, b]) =>
          `${step.left.find((x) => x.id === a)?.label}: ${step.right.find((x) => x.id === b)?.label}`,
      )
      .join('; ');
  if (step.kind === 'identify') return step.targetId;
  if (step.kind === 'operate') return step.operation;
  return 'Formative reflection; no official grade.';
}
export async function renderLessonExport(
  def: LessonPlan,
  format: 'pdf' | 'pptx',
  teacher: boolean,
  progress: ExportProgress | null,
  lessonUrl: string,
  excerpts: { title: string; page: number; text: string }[] = [],
  images: Record<string, Buffer> = {},
) {
  const sections = def.sections.map((s) => ({
    s,
    feedback: progress?.activities?.[s.id],
    answers: teacher || progress?.completed?.includes(s.id),
  }));
  if (format === 'pdf') {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 48,
        info: { Title: def.title, Author: 'Void Space' },
      }),
      chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    const heading = (text: string) => {
      if (doc.y > 720) doc.addPage();
      doc.moveDown(0.6).font('Helvetica-Bold').fontSize(16).fillColor('#172832').text(clean(text));
      doc.font('Helvetica').fontSize(11).fillColor('#273d49');
    };
    const body = (text: string) => doc.text(clean(text), { lineGap: 4 }).moveDown(0.5);
    heading(def.title);
    body(
      `${def.durationMinutes} minutes | ${def.audience}\n${teacher ? 'Teacher lesson plan' : 'Personal learning recap'}`,
    );
    body(def.summary);
    body(def.objectives.map((x) => `- ${x}`).join('\n'));
    for (const { s, feedback, answers } of sections) {
      heading(`${s.title} (${s.minutes} min)`);
      body(s.body);
      if (teacher && s.notes) body(`Teaching notes: ${s.notes}`);
      if (
        s.activity?.scene.kind === 'diagram' &&
        s.activity.scene.imageSourceId &&
        images[s.activity.scene.imageSourceId]
      ) {
        if (doc.y > 480) doc.addPage();
        doc.image(images[s.activity.scene.imageSourceId]!, { fit: [480, 200] });
        doc.moveDown();
      }
      if (s.activity?.targets.length) {
        body(s.activity.targets.map((t) => `${t.label}: ${t.explanation}`).join('\n'));
      }
      for (const q of s.activity?.steps ?? []) {
        body(q.instruction);
        if (q.kind === 'choice') body(q.choices.map((c) => `- ${c.label}`).join('\n'));
        if (answers) body(`Reviewed answer: ${answerText(q)}\n${q.explanation}`);
      }
      if (feedback)
        body(
          `Your practice: ${feedback.status}; ${feedback.mistakes} incorrect interactions. ${feedback.feedback}`,
        );
    }
    heading('Sources and interactive material');
    body(lessonUrl);
    if (def.sketchfabUrl) body(def.sketchfabUrl);
    if (def.attribution) body(`Attribution: ${def.attribution}`);
    for (const e of excerpts) body(`${e.title}, page ${e.page}: ${e.text}`);
    body(
      'Educational material. Practice feedback is formative and does not certify competence. Models are referenced rather than redistributed in this document.',
    );
    doc.end();
    return done;
  }
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = def.title;
  pptx.author = 'Void Space';
  pptx.subject = def.summary;
  const add = (title: string, text: string, notes: string) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'F5F3EC' };
    slide.addText(title, {
      x: 0.6,
      y: 0.45,
      w: 12,
      h: 0.8,
      fontFace: 'Aptos Display',
      fontSize: 28,
      bold: true,
      color: '172832',
      breakLine: false,
    });
    slide.addText(text, {
      x: 0.7,
      y: 1.5,
      w: 11.8,
      h: 4.8,
      fontFace: 'Aptos',
      fontSize: 20,
      color: '273D49',
      fit: 'shrink',
      valign: 'top',
      margin: 0.1,
    });
    slide.addText('Open interactive lesson', {
      x: 0.7,
      y: 6.8,
      w: 8,
      h: 0.25,
      fontSize: 11,
      color: '315B71',
      hyperlink: { url: lessonUrl },
    });
    slide.addNotes(notes);
    return slide;
  };
  add(
    def.title,
    `${def.durationMinutes} minutes\n${def.audience}\n\n${def.objectives.join('\n')}`,
    def.summary,
  );
  for (const { s } of sections) {
    const parts = s.body.match(/[\s\S]{1,1300}/g) ?? [s.body];
    parts.forEach((part, i) =>
      add(
        `${s.title}${i ? ' (continued)' : ''} · ${s.minutes} min`,
        part,
        [
          s.notes,
          ...(s.activity?.steps.map(
            (q) => `${q.instruction}\nAnswer: ${answerText(q)}\n${q.explanation}`,
          ) ?? []),
        ].join('\n\n'),
      ),
    );
    if (s.activity && s.activity.scene.kind !== 'none' && s.activity.scene.kind !== 'model') {
      const a = s.activity,
        slide = add(`${s.title}: explore`, '', s.notes);
      if (a.scene.kind === 'diagram' && a.scene.imageSourceId && images[a.scene.imageSourceId])
        slide.addImage({
          data: `image/png;base64,${images[a.scene.imageSourceId]!.toString('base64')}`,
          x: 1,
          y: 1.5,
          w: 11,
          h: 4.5,
        });
      for (const t of a.targets) {
        const x = 6 + t.position[0] * 4.5,
          y = 3.5 - t.position[1] * 1.7;
        slide.addShape(pptx.ShapeType.roundRect, {
          x: x - 0.7,
          y: y - 0.3,
          w: 1.6,
          h: 0.7,
          fill: { color: 'DDE8E9' },
          line: { color: '557784' },
        });
        slide.addText(t.label, {
          x: x - 0.7,
          y: y - 0.3,
          w: 1.6,
          h: 0.7,
          fontSize: 13,
          color: '172832',
          align: 'center',
          fit: 'shrink',
        });
      }
    }
  }
  add(
    'Sources and next steps',
    [
      def.attribution,
      def.sketchfabUrl,
      ...excerpts.map((e) => `${e.title}, page ${e.page}`),
      'Models remain available through the interactive lesson link.',
    ]
      .filter(Boolean)
      .join('\n'),
    'Respect the original asset and source licences.',
  );
  return Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array);
}
export async function exportLessonPlanTask(
  tenantId: string,
  taskId: string,
  ownerId: string,
  input: unknown,
  stagingDir: string,
) {
  const data = z
    .object({
      releaseId: z.string().uuid(),
      releaseTenantId: z.string().uuid(),
      shareId: z.string().uuid().nullable().optional(),
      format: z.enum(['pdf', 'pptx']),
      audience: z.enum(['student', 'teacher']),
      progress: z.unknown().nullable(),
    })
    .parse(input);
  const release = await withTenant(data.releaseTenantId, async (db) => {
    const r = await db.lessonPlanRelease.findUniqueOrThrow({ where: { id: data.releaseId } });
    if (r.ownerId !== ownerId) {
      if (data.audience === 'teacher' || data.format === 'pptx')
        throw new UnrecoverableError('Instructor exports require lesson ownership.');
      const publicAccess =
        r.reviewed &&
        r.visibility === 'public' &&
        (await db.publicLessonEntry.findUnique({ where: { id: r.id } }));
      const institutionAccess =
        r.reviewed && r.visibility === 'institution' && tenantId === data.releaseTenantId;
      const linkAccess =
        r.visibility === 'private' &&
        data.shareId &&
        (await db.lessonShare.findFirst({
          where: { id: data.shareId, releaseId: r.id, revokedAt: null },
        }));
      if (!publicAccess && !institutionAccess && !linkAccess)
        throw new UnrecoverableError('This lesson export is no longer authorized.');
    }
    return r;
  });
  const def = lessonPlanSchema.parse(release.definition);
  const images: Record<string, Buffer> = {};
  for (const s of def.sections)
    if (s.activity?.scene.kind === 'diagram' && s.activity.scene.imageSourceId) {
      const source = await withTenant(data.releaseTenantId, (db) =>
        db.learningSource.findFirst({
          where: {
            id: s.activity!.scene.kind === 'diagram' ? s.activity!.scene.imageSourceId : undefined,
            ownerId: release.ownerId,
            status: 'ready',
          },
        }),
      );
      if (source?.storagePath && isLearningStoragePath(source.storagePath, stagingDir))
        images[source.id] = await sharp(await readFile(source.storagePath), {
          limitInputPixels: 16000000,
        })
          .rotate()
          .resize({ width: 1600, height: 1000, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
    }
  const origin = process.env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000';
  const buffer = await renderLessonExport(
    def,
    data.format,
    data.audience === 'teacher',
    data.progress as ExportProgress | null,
    `${origin}/console/learn/lessons/${release.id}?tenant=${release.tenantId}`,
    release.sourceExcerpts as { title: string; page: number; text: string }[],
    images,
  );
  const dir = join(learningStorageRoot(stagingDir), tenantId, 'exports');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${taskId}.${data.format}`);
  await writeFile(path, buffer, { mode: 0o600 });
  return { path, format: data.format, size: buffer.length };
}
