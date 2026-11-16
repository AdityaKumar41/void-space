import { withTenant } from '@void-space/db';
import {
  idParamsSchema,
  languageCodeSchema,
  lessonContentSchema,
} from '@void-space/types';
import { isTextAiConfigured, TextAiError } from '@void-space/studio-ai/text';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';

import type { ApiEnv } from '../../env';
import {
  extractDocumentText,
  validateDocumentTranslationText,
} from '../../lib/document-text';
import { DocumentStorage, isDocumentExtension } from '../../lib/document-storage';
import { NotFoundError, ServiceUnavailableError } from '../../lib/errors';
import { parseBody, parseParams } from '../../lib/http';
import { translateDocumentContent, translateLessonContent } from './service';

const targetLanguageSchema = z.object({ targetLanguage: languageCodeSchema });
const TRANSLATION_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

export interface TranslationRoutesOptions {
  readonly env: ApiEnv;
}

function requireAi(env: ApiEnv): void {
  if (!isTextAiConfigured(env)) {
    throw new ServiceUnavailableError(
      'AI translation is not configured on this server.',
      'AI_TRANSLATION_UNAVAILABLE',
    );
  }
}

function mapAiFailure(
  error: unknown,
  request: FastifyRequest,
): never {
  if (!(error instanceof TextAiError)) throw error;
  request.log.warn({ providers: error.failures }, 'AI translation provider unavailable');
  throw new ServiceUnavailableError(
    'AI translation is temporarily unavailable.',
    'AI_TRANSLATION_UNAVAILABLE',
  );
}

export async function translationRoutes(
  app: FastifyInstance,
  options: TranslationRoutesOptions,
): Promise<void> {
  const storage = new DocumentStorage({ rootDir: options.env.DOCUMENTS_DIR });

  app.post(
    '/translations/lessons/:id',
    { preHandler: app.authenticate, config: { rateLimit: TRANSLATION_LIMIT } },
    async (request) => {
      const principal = request.principal!;
      const { id } = parseParams(idParamsSchema, request.params);
      const { targetLanguage } = parseBody(targetLanguageSchema, request.body);
      requireAi(options.env);

      const lesson = await withTenant(principal.tenantId, (db) =>
        db.lesson.findFirst({
          where: {
            id,
            tenantId: principal.tenantId,
            ...(principal.permissions.includes('learning:manage') ? {} : { isPublished: true }),
          },
          select: {
            title: true,
            summary: true,
            narration: true,
            outline: true,
            questions: true,
            passingScore: true,
          },
        }),
      );
      if (!lesson) throw new NotFoundError('Lesson');

      const content = lessonContentSchema.parse({
        ...lesson,
        outline: lesson.outline,
        questions: lesson.questions,
      });
      const source = {
        title: content.title,
        summary: content.summary,
        narration: content.narration,
        outline: content.outline,
        questions: content.questions.map(({ id: questionId, prompt, options: choices }) => ({
          id: questionId,
          prompt,
          options: choices,
        })),
      };

      try {
        return {
          translation: await translateLessonContent(source, targetLanguage, options.env),
          targetLanguage,
          passingScore: content.passingScore,
        };
      } catch (error) {
        mapAiFailure(error, request);
      }
    },
  );

  app.post(
    '/translations/documents/:id',
    { preHandler: app.authenticate, config: { rateLimit: TRANSLATION_LIMIT } },
    async (request) => {
      const principal = request.principal!;
      const { id } = parseParams(idParamsSchema, request.params);
      const { targetLanguage } = parseBody(targetLanguageSchema, request.body);
      requireAi(options.env);

      const document = await withTenant(principal.tenantId, (db) =>
        db.document.findFirst({
          where: { id, tenantId: principal.tenantId },
          select: {
            kind: true,
            title: true,
            description: true,
            content: true,
            fileName: true,
            storageKey: true,
          },
        }),
      );
      if (!document) throw new NotFoundError('Document');

      let text: string;
      if (document.kind === 'note') {
        text = validateDocumentTranslationText(document.content ?? '');
      } else {
        if (!document.storageKey || !document.fileName) throw new NotFoundError('Document');
        const extension = extname(document.fileName).toLowerCase();
        if (!isDocumentExtension(extension)) throw new NotFoundError('Document');
        const bytes = await readFile(storage.pathFor(document.storageKey));
        text = await extractDocumentText(bytes, extension);
      }

      try {
        return {
          translation: await translateDocumentContent(
            { title: document.title, description: document.description, text },
            targetLanguage,
            options.env,
          ),
          targetLanguage,
        };
      } catch (error) {
        mapAiFailure(error, request);
      }
    },
  );
}
