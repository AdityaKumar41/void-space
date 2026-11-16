import { z } from 'zod';

/**
 * Documents & Notes (learning workspace).
 *
 * A document is either an uploaded file or an authored note. Both share the same
 * organisation fields — program (course), lesson and topic — so the learning
 * workspace can show the reading material beside the assessment it belongs to.
 *
 * File handling is deliberately narrow: a small extension allow-list, a declared
 * MIME check and a magic-byte check in the API. The browser is never trusted to
 * tell us what a file is.
 */
export const DOCUMENT_KINDS = ['file', 'note'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf'] as const;
export type DocumentExtension = (typeof DOCUMENT_EXTENSIONS)[number];

/** Accepted MIME types per extension. An absent/octet-stream type is still checked by magic bytes. */
export const DOCUMENT_MIME_TYPES: Readonly<Record<DocumentExtension, readonly string[]>> = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword', 'application/vnd.ms-word'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/plain', 'text/x-markdown'],
  '.rtf': ['application/rtf', 'text/rtf'],
};

/** The MIME type the API serves a stored file as. Never taken from the upload alone. */
export const DOCUMENT_CONTENT_TYPE: Readonly<Record<DocumentExtension, string>> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.rtf': 'application/rtf',
};

/** 25 MB: enough for a course pack, small enough that a stray video cannot fill the disk. */
export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;

export const DOCUMENT_CATEGORIES = [
  'General',
  'Reading',
  'Assignment',
  'Reference',
  'Study note',
  'Assessment',
  'Safety',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

const titleSchema = z.string().trim().min(1, 'Give the document a title').max(200);
const descriptionSchema = z.string().trim().max(4000).optional();
const categorySchema = z.string().trim().min(1).max(60).default('General');
const topicSchema = z.string().trim().max(120).optional();

const organisationShape = {
  title: titleSchema,
  description: descriptionSchema,
  category: categorySchema,
  topic: topicSchema,
  courseId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
};

export const documentMetadataSchema = z.object(organisationShape);
export type DocumentMetadataInput = z.infer<typeof documentMetadataSchema>;

export const createNoteSchema = z.object({
  ...organisationShape,
  content: z.string().trim().min(1, 'Write something in the note').max(200_000),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

/**
 * A patch may change any subset, but it must change something.
 *
 * Links and free text are nullable rather than merely optional: clearing a
 * programme or a lesson from the picker has to actually unlink it, and a
 * `null` is the only value that can say "none" on the wire.
 */
export const updateDocumentSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    category: z.string().trim().min(1).max(60).optional(),
    topic: z.string().trim().max(120).nullable().optional(),
    courseId: z.string().uuid().nullable().optional(),
    lessonId: z.string().uuid().nullable().optional(),
    content: z.string().trim().max(200_000).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: 'Provide at least one field to update' },
  );
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

/** `GET /documents/:id/content` — `download=1` forces an attachment. */
export const documentContentQuerySchema = z.object({
  download: z
    .union([z.literal('1'), z.literal('true'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === '1' || value === 'true'),
});
export type DocumentContentQuery = z.infer<typeof documentContentQuerySchema>;

export const documentListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  category: z.string().trim().max(60).optional(),
  courseId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
  topic: z.string().trim().max(120).optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export interface DocumentView {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly description: string | null;
  readonly category: string;
  readonly topic: string | null;
  readonly courseId: string | null;
  readonly lessonId: string | null;
  readonly course: { readonly id: string; readonly title: string } | null;
  readonly lesson: { readonly id: string; readonly title: string } | null;
  readonly createdBy: { readonly id: string; readonly fullName: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly extension: DocumentExtension | null;
  /** Notes only: the first lines, for a card that does not need the whole body. */
  readonly excerpt: string | null;
  /** Notes only, and only on the detail endpoint. */
  readonly content?: string;
}
