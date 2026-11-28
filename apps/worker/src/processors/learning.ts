import { textAiFailureMessage, type TextAiConfig } from '@void-space/ai/text';
import {
  isLearningStoragePath,
  learningStorageRoot,
  readLearningFile,
  withTenant,
  writeLearningFile,
  type Prisma,
} from '@void-space/db';
import { UnrecoverableError, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { z } from 'zod/v3';
import { processLearningAgent } from '../learning/agent';
import { generateLearningImage } from '../learning/images';
import { generateLessonAnnotationsTask } from '../learning/lesson-annotations';
import { exportLessonPlanTask, generateLessonPlanTask } from '../learning/lesson-plans';
import type { Checkpoint } from '../learning/network';
import { extractOffice, extractWebPage, textPassages } from '../learning/sources/documents';
import { downloadPublicSource } from '../learning/sources/download';
import { attemptOf, createJobContext, isTerminalFailure } from '../lib/job-tracking';

export async function extractLearningPdf(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl:
      join(
        dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
        'standard_fonts',
      ) + '/',
  });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 50)
      throw new UnrecoverableError(
        'Use a PDF with at most 50 pages. Split larger sources before uploading.',
      );
    const passages: { id: string; page: number; text: string }[] = [];
    let size = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      size += text.length;
      if (size > 100000)
        throw new UnrecoverableError(
          'Source exceeds 100,000 extracted characters. Upload a shorter section.',
        );
      for (const [i, chunk] of (text.match(/[\s\S]{1,2500}/g) ?? []).entries())
        passages.push({ id: `page${page}_${i + 1}`, page, text: chunk });
    }
    if (passages.reduce((n, p) => n + p.text.length, 0) < 20)
      throw new UnrecoverableError(
        'This PDF has no usable text layer. Upload a text PDF or paste notes; scanned PDFs need OCR, which is not available yet.',
      );
    return passages;
  } finally {
    await pdf.destroy();
  }
}
export function createLearningProcessor({
  textAi,
  stagingDir,
  checkpoint,
}: {
  textAi: TextAiConfig;
  stagingDir: string;
  checkpoint?: Checkpoint;
}) {
  return async (job: Job<{ tenantId: string; taskId: string }>) => {
    const { tenantId, taskId } = job.data;
    const ctx = createJobContext({
      jobId: String(job.id),
      tenantId,
      queue: 'learning',
      payload: job.data,
      attempt: attemptOf(job),
      maxAttempts: job.opts.attempts ?? 2,
    });
    let trackedTask: Prisma.LearningTaskGetPayload<Record<string, never>> | undefined;
    await ctx.markActive();
    try {
      const task = await withTenant(tenantId, (db) =>
        db.learningTask.findUniqueOrThrow({ where: { id: taskId } }),
      );
      trackedTask = task;
      if (task.status === 'cancelled') {
        await ctx.succeed({ cancelled: true });
        return { cancelled: true };
      }
      if (task.status === 'completed') {
        await ctx.succeed(task.result as Record<string, unknown>);
        return task.result;
      }
      await withTenant(tenantId, (db) =>
        db.learningTask.updateMany({
          where: { id: taskId, status: { not: 'cancelled' } },
          data: { status: 'active', error: null },
        }),
      );
      let result: Record<string, unknown>;
      if (task.kind === 'plan_annotate') {
        result = await generateLessonAnnotationsTask(
          tenantId,
          taskId,
          task.ownerId,
          task.input,
          textAi,
        );
      } else if (task.kind === 'agent_turn') {
        result = await processLearningAgent(
          tenantId,
          taskId,
          task.ownerId,
          task.input,
          textAi,
          checkpoint,
        );
      } else if (task.kind === 'image_generate') {
        const input = z
          .object({
            prompt: z.string().trim().min(5).max(2000),
            title: z.string().max(200).optional(),
          })
          .parse(task.input);
        result = await generateLearningImage(tenantId, taskId, task.ownerId, input, stagingDir);
      } else if (task.kind === 'plan_generate') {
        result = await generateLessonPlanTask(tenantId, taskId, task.ownerId, task.input, textAi);
      } else if (task.kind === 'plan_export') {
        result = await exportLessonPlanTask(tenantId, taskId, task.ownerId, task.input, stagingDir);
      } else if (task.kind === 'extract') {
        const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(task.input);
        const source = await withTenant(tenantId, (db) =>
          db.learningSource.findFirstOrThrow({ where: { id: sourceId, ownerId: task.ownerId } }),
        );
        const metadata = (source.metadata ?? {}) as Record<string, unknown>;
        let bytes: Buffer;
        let mime = source.mime;
        let storagePath = source.storagePath;
        if (typeof metadata.url === 'string') {
          const downloaded = await downloadPublicSource(metadata.url);
          bytes = downloaded.bytes;
          mime = downloaded.mime;
          metadata.resolvedUrl = downloaded.url;
          const directory = join(learningStorageRoot(stagingDir), tenantId);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          storagePath = join(directory, sourceId);
          storagePath = await writeLearningFile(storagePath, bytes, stagingDir, mime);
        } else {
          if (!storagePath || !isLearningStoragePath(storagePath, stagingDir))
            throw new UnrecoverableError('Private source is missing. Upload it again.');
          bytes = await readLearningFile(storagePath, stagingDir, 10 * 1024 * 1024);
        }
        if (bytes.length > 10 * 1024 * 1024) throw new UnrecoverableError('Source exceeds 10 MB');
        const passages =
          mime === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-'
            ? await extractLearningPdf(bytes)
            : mime.includes('openxmlformats-officedocument')
              ? extractOffice(bytes, mime)
              : mime === 'text/html'
                ? extractWebPage(bytes)
                : mime === 'text/plain'
                  ? textPassages(bytes.toString('utf8'))
                  : (() => {
                      throw new UnrecoverableError(
                        'Unsupported link content. Upload a PDF, DOCX, PPTX or text file instead. Videos can be used as reference links in your lesson.',
                      );
                    })();
        if (passages.reduce((n, p) => n + p.text.length, 0) < 20)
          throw new UnrecoverableError(
            'This source has too little readable text. Upload a text document or paste at least 20 characters of notes.',
          );
        await withTenant(tenantId, (db) =>
          db.learningSource.update({
            where: { id: sourceId },
            data: {
              passages: passages as unknown as Prisma.InputJsonValue,
              status: 'ready',
              error: null,
              mime,
              storagePath,
              metadata: {
                ...metadata,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                extractionVersion: 1,
              } as Prisma.InputJsonValue,
            },
          }),
        );
        result = { sourceId, passages: passages.length };
      } else {
        throw new UnrecoverableError(
          'This legacy activity task is retired. Create a lesson plan instead.',
        );
      }
      await withTenant(tenantId, (db) =>
        db.learningTask.updateMany({
          where: { id: taskId, status: { not: 'cancelled' } },
          data: { status: 'completed', result: result as Prisma.InputJsonValue },
        }),
      );
      await ctx.succeed(result);
      return result;
    } catch (error) {
      const terminal = isTerminalFailure(error, ctx);
      const message = textAiFailureMessage(error);
      let cancelled = false;
      await withTenant(tenantId, async (db) => {
        await db.$queryRaw`SELECT id FROM learning_tasks WHERE id=${taskId}::uuid FOR UPDATE`;
        const latest = await db.learningTask.findUnique({ where: { id: taskId } });
        if (latest?.status === 'cancelled') {
          cancelled = true;
          return;
        }
        if (latest?.status === 'completed') return;
        const steps = Array.isArray(latest?.progress)
          ? (latest.progress as unknown as { status: string }[])
          : [];
        await db.learningTask.update({
          where: { id: taskId },
          data: {
            status: terminal ? 'failed' : 'queued',
            error: message.slice(0, 2000),
            progress: steps.map((s) =>
              s.status === 'working' ? { ...s, status: terminal ? 'failed' : 'working' } : s,
            ) as Prisma.InputJsonValue,
          },
        });
        if (trackedTask?.kind === 'extract' && terminal) {
          const sourceId = (trackedTask.input as { sourceId: string }).sourceId;
          await db.learningSource.updateMany({
            where: { id: sourceId, ownerId: trackedTask.ownerId },
            data: { status: 'failed', error: message.slice(0, 2000) },
          });
        }
      });
      if (cancelled) {
        await ctx.succeed({ cancelled: true });
        return { cancelled: true };
      }
      await ctx.fail(new Error(message), terminal);
      throw error;
    }
  };
}
