'use client';

/**
 * Documents & Notes.
 *
 * Reading material for the learning workspace: uploaded PDF / Word / text files
 * and notes written here. Both are filed under an optional program (course), a
 * lesson and a free-form topic, so a learner can find the handout beside the
 * lesson it belongs to instead of in a downloads folder.
 *
 * The list is tenant-scoped by the API. The page never links to storage
 * directly: previews and downloads go through the authenticated content route,
 * which resolves the row before it opens the file.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FileText,
  FileType2,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_SIZE_BYTES,
  type DocumentKind,
  type DocumentView,
} from '@void-space/types';

import { API_PUBLIC_BASE, apiFetch, apiUpload, refreshSession } from '../../../lib/api';
import { formatBytes, formatRelative } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { LANGUAGES, useLanguage } from '../../../lib/language';
import type { LanguageCode } from '@void-space/types';
import { Button, buttonVariants } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Chip, FilterChip } from '../../../components/ui/chip';
import { Field, Input, SearchField, Select, Textarea } from '../../../components/ui/field';
import { EmptyState, ErrorNote, LoadingBlock } from '../../../components/ui/feedback';

interface LessonOption {
  id: string;
  title: string;
}

interface CourseOption {
  id: string;
  title: string;
  lessons: LessonOption[];
}

type KindFilter = 'all' | DocumentKind;

interface EditorState {
  kind: DocumentKind;
  document: DocumentView | null;
}

const PREVIEWABLE = new Set(['.pdf', '.txt', '.md']);

const fieldClass =
  'mt-2 w-full rounded-control border border-hairline bg-surface p-3 text-sm text-ink';

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function formatExtension(extension: string | null): string {
  return extension ? extension.replace('.', '').toUpperCase() : 'FILE';
}

function fileIcon(kind: DocumentKind) {
  return kind === 'note' ? NotebookPen : FileText;
}

function DocumentCard({
  document,
  canManage,
  busy,
  onOpen,
  onEdit,
  onDelete,
  onDownload,
}: {
  document: DocumentView;
  canManage: boolean;
  busy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const Icon = fileIcon(document.kind);
  const summary = document.description ?? document.excerpt;

  return (
    <article className="group flex flex-col overflow-hidden rounded-card border border-hairline bg-surface transition-all duration-200 ease-standard hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-float">
      <button type="button" onClick={onOpen} className="block w-full p-5 text-left">
        <div className="flex items-start gap-3">
          <span className="learning-stat-icon shrink-0">
            <Icon size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={document.kind === 'note' ? 'brand' : 'neutral'}>
                {document.kind === 'note' ? 'Note' : formatExtension(document.extension)}
              </Chip>
              <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-ink-faint">
                {document.category}
              </span>
            </div>
            <h2 className="mt-2 text-[15px] font-semibold leading-[1.35] tracking-[-0.008em] text-ink">
              {document.title}
            </h2>
            {summary ? (
              <p className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-ink-dim">{summary}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-faint">
          <span>{document.course?.title ?? 'No program'}</span>
          {document.lesson ? <span>· {document.lesson.title}</span> : null}
          {document.topic ? <span>· {document.topic}</span> : null}
          <span className="ml-auto font-mono text-[11px]">
            {formatRelative(document.updatedAt)}
          </span>
        </div>
      </button>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {document.kind === 'note' ? 'Read note' : 'Preview'}
        </Button>
        {document.kind === 'file' ? (
          <Button size="sm" variant="ghost" onClick={onDownload}>
            <Download size={13} />
            Download
          </Button>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {canManage ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Edit ${document.title}`}
                title="Edit details"
                onClick={onEdit}
              >
                <Pencil size={13} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${document.title}`}
                title="Delete"
                disabled={busy}
                onClick={onDelete}
              >
                <Trash2 size={13} />
              </Button>
            </>
          ) : null}
        </span>
      </div>
    </article>
  );
}

function DocumentPreview({ document }: { document: DocumentView }) {
  if (document.kind === 'note') {
    return (
      <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-7 text-ink">
        {document.content ?? document.excerpt ?? ''}
      </pre>
    );
  }

  if (document.extension === '.docx') {
    return <DocxPreview id={document.id} title={document.title} />;
  }

  if (document.extension && PREVIEWABLE.has(document.extension)) {
    return (
      <iframe
        src={`${API_PUBLIC_BASE}/documents/${document.id}/content`}
        title={`Preview of ${document.title}`}
        className="h-[70vh] min-h-[420px] w-full rounded-control border border-hairline bg-deeper"
      />
    );
  }

  return (
    <div className="rounded-control border border-dashed border-hairline-strong px-6 py-12 text-center">
      <FileType2 size={30} className="mx-auto text-ink-faint" />
      <p className="mt-4 text-[14px] font-semibold text-ink">
        This format cannot be previewed in the browser
      </p>
      <p className="mx-auto mt-2 max-w-[46ch] text-[13px] leading-6 text-ink-faint">
        Legacy Word and RTF files are stored intact. Download the file to read it in an editor that
        understands the format.
      </p>
      <a
        href={`${API_PUBLIC_BASE}/documents/${document.id}/content?download=1`}
        className={buttonVariants({ variant: 'primary', size: 'sm', className: 'mt-5' })}
      >
        <Download size={14} />
        Download {formatExtension(document.extension)}
      </a>
    </div>
  );
}

function DocxPreview({ id, title }: { id: string; title: string }) {
  const [preview, setPreview] = useState<
    | { status: 'loading' }
    | { status: 'ready'; text: string }
    | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPreview({ status: 'loading' });

    async function load() {
      const url = `${API_PUBLIC_BASE}/documents/${id}/content`;
      const request = () =>
        fetch(url, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });

      let response = await request();
      if (response.status === 401 && (await refreshSession())) {
        response = await request();
      }

      if (!response.ok) {
        const body = await response.text();
        let message = `Could not load the document preview (${response.status}).`;
        try {
          const payload = JSON.parse(body) as { message?: unknown };
          if (typeof payload.message === 'string') message = payload.message;
        } catch {
          // Keep the status message when the API response is not JSON.
        }
        throw new Error(message);
      }

      const { default: mammoth } = await import('mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer: await response.arrayBuffer() });
      if (active) setPreview({ status: 'ready', text: result.value });
    }

    void load().catch((caught: unknown) => {
      if (active && !controller.signal.aborted) {
        setPreview({
          status: 'error',
          message: caught instanceof Error ? caught.message : 'Could not preview this document.',
        });
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [id]);

  if (preview.status === 'loading') {
    return <LoadingBlock label={`Preparing ${title} preview`} />;
  }

  if (preview.status === 'error') {
    return <ErrorNote message={preview.message} />;
  }

  if (!preview.text.trim()) {
    return (
      <p className="text-sm leading-7 text-ink-faint">
        This Word document does not contain text that can be previewed.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
        Text preview
      </p>
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-sans text-[14px] leading-7 text-ink">
        {preview.text}
      </pre>
    </div>
  );
}

function DocumentDetail({
  id,
  canManage,
  busy,
  onBack,
  onEdit,
  onDelete,
}: {
  id: string;
  canManage: boolean;
  busy: boolean;
  onBack: () => void;
  onEdit: (document: DocumentView) => void;
  onDelete: (document: DocumentView) => void;
}) {
  const { language, t } = useLanguage();
  const [translation, setTranslation] = useState<{
    language: LanguageCode;
    content: { title: string; description: string | null; text: string };
  } | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['document', id],
    queryFn: () => apiFetch<{ document: DocumentView }>(`/documents/${id}`),
  });

  if (detail.isLoading) return <LoadingBlock label="Opening document" />;
  if (detail.error) return <ErrorNote message={(detail.error as Error).message} />;

  const document = detail.data?.document;
  if (!document) return <ErrorNote message="The document could not be read." />;
  const documentId = document.id;

  const isTranslationVisible = showTranslation && translation?.language === language;

  async function translateDocument() {
    if (translation?.language === language) {
      setShowTranslation((visible) => !visible);
      return;
    }

    setTranslating(true);
    setTranslationError(null);
    try {
      const result = await apiFetch<{
        translation: { title: string; description: string | null; text: string };
      }>(`/translations/documents/${documentId}`, {
        method: 'POST',
        body: { targetLanguage: language },
      });
      setTranslation({ language, content: result.translation });
      setShowTranslation(true);
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      setTranslationError(
        code === 'AI_TRANSLATION_UNAVAILABLE'
          ? t('AI translation is unavailable. Configure a text AI provider and try again.')
          : (caught as Error).message || t('Could not translate this content. Try again.'),
      );
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" onClick={onBack}>
          ← All documents
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={document.kind === 'note' ? 'brand' : 'neutral'}>
              {document.kind === 'note' ? 'Note' : formatExtension(document.extension)}
            </Chip>
            <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-ink-faint">
              {document.category}
            </span>
          </div>
          <h1 className="mt-3">{document.title}</h1>
          {document.description ? (
            <p className="mt-3 max-w-[70ch] text-sm leading-7 text-ink-dim">
              {document.description}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-ink-faint">
            <span>{document.course?.title ?? 'No program'}</span>
            {document.lesson ? <span>· {document.lesson.title}</span> : null}
            {document.topic ? <span>· {document.topic}</span> : null}
            {document.sizeBytes !== null ? <span>· {formatBytes(document.sizeBytes)}</span> : null}
            <span>· {formatRelative(document.updatedAt)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {language === 'en' ? null : (
            <Button
              variant="secondary"
              disabled={translating}
              onClick={() => void translateDocument()}
            >
              {translating
                ? t('Translating…')
                : isTranslationVisible
                  ? t('Show original')
                  : t('Translate to {language}', {
                      language:
                        LANGUAGES.find((option) => option.code === language)?.label ?? language,
                    })}
            </Button>
          )}
          {document.kind === 'file' ? (
            <a
              href={`${API_PUBLIC_BASE}/documents/${document.id}/content?download=1`}
              className={buttonVariants({ variant: 'secondary', size: 'md' })}
            >
              <Download size={15} />
              Download
            </a>
          ) : null}
          {canManage ? (
            <>
              <Button onClick={() => onEdit(document)}>
                <Pencil size={14} />
                Edit
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => onDelete(document)}
              >
                <Trash2 size={14} />
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {translationError ? <ErrorNote message={translationError} code="TRANSLATION_FAILED" /> : null}
      {isTranslationVisible && translation ? (
        <Card className="space-y-4 border-brand/30 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{t('Translated copy')}</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">
                {translation.content.title}
              </h2>
              {translation.content.description ? (
                <p className="mt-2 text-sm leading-6 text-ink-dim">
                  {translation.content.description}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" onClick={() => setShowTranslation(false)}>
              {t('Show original')}
            </Button>
          </div>
          <p className="text-xs text-ink-faint">
            {t('Translation is shown temporarily and does not change the original.')}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-7 text-ink">
            {translation.content.text}
          </p>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-7">
        <DocumentPreview document={document} />
      </Card>

      <p className="text-[12px] leading-6 text-ink-faint">
        Filed in this workspace by {document.createdBy?.fullName ?? 'a team member'}. This document
        is private to the workspace; the API checks your membership on every read.
      </p>
    </div>
  );
}

function DocumentEditor({
  state,
  courses,
  lessons,
  onCancel,
  onSaved,
}: {
  state: EditorState;
  courses: readonly CourseOption[];
  lessons: readonly LessonOption[];
  onCancel: () => void;
  onSaved: (document: DocumentView) => void;
}) {
  const existing = state.document;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [category, setCategory] = useState(existing?.category ?? 'General');
  const [topic, setTopic] = useState(existing?.topic ?? '');
  const [courseId, setCourseId] = useState(existing?.courseId ?? '');
  const [lessonId, setLessonId] = useState(existing?.lessonId ?? '');
  const [content, setContent] = useState(existing?.content ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopedLessons = useMemo(() => {
    if (!courseId) return lessons;
    return courses.find((course) => course.id === courseId)?.lessons ?? [];
  }, [courseId, courses, lessons]);

  function chooseCourse(next: string) {
    setCourseId(next);
    if (next && lessonId && !(courses.find((c) => c.id === next)?.lessons ?? []).some((l) => l.id === lessonId)) {
      setLessonId('');
    }
  }

  function chooseFile(next: File | null) {
    setFile(next);
    if (next && title.trim().length === 0) {
      setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 200));
    }
  }

  const needsFile = state.kind === 'file' && !existing;
  const canSave =
    !busy &&
    title.trim().length > 0 &&
    (!needsFile || file !== null) &&
    (state.kind !== 'note' || content.trim().length > 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        const payload: Record<string, unknown> = {
          title: title.trim(),
          description: description.trim() ? description.trim() : null,
          category,
          topic: topic.trim() ? topic.trim() : null,
          courseId: courseId || null,
          lessonId: lessonId || null,
        };
        if (existing.kind === 'note') payload['content'] = content;
        const result = await apiFetch<{ document: DocumentView }>(`/documents/${existing.id}`, {
          method: 'PATCH',
          body: payload,
        });
        onSaved(result.document);
        return;
      }

      if (state.kind === 'note') {
        const result = await apiFetch<{ document: DocumentView }>('/documents/notes', {
          method: 'POST',
          body: {
            title: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            category,
            ...(topic.trim() ? { topic: topic.trim() } : {}),
            ...(courseId ? { courseId } : {}),
            ...(lessonId ? { lessonId } : {}),
            content,
          },
        });
        onSaved(result.document);
        return;
      }

      if (!file) return;
      if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
        setError(
          `${file.name} is larger than the ${Math.round(
            MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024),
          )} MB limit.`,
        );
        return;
      }

      const form = new FormData();
      form.set('title', title.trim());
      if (description.trim()) form.set('description', description.trim());
      form.set('category', category);
      if (topic.trim()) form.set('topic', topic.trim());
      if (courseId) form.set('courseId', courseId);
      if (lessonId) form.set('lessonId', lessonId);
      form.set('file', file);

      const result = await apiUpload<{ document: DocumentView }>('/documents', form, setProgress);
      onSaved(result.document);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            {existing ? 'Edit document' : state.kind === 'note' ? 'New note' : 'Upload a document'}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.015em] text-ink">
            {existing ? existing.title : state.kind === 'note' ? 'Write a note' : 'Add reading material'}
          </h2>
        </div>
        <Button variant="ghost" onClick={onCancel} aria-label="Close editor">
          <X size={16} />
          Close
        </Button>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title">
          <Input
            value={title}
            maxLength={200}
            placeholder="e.g. Hydraulic safety handout"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            {DOCUMENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Program (optional)">
          <Select value={courseId} onChange={(event) => chooseCourse(event.target.value)}>
            <option value="">Not filed under a program</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Lesson (optional)"
          hint={courseId && scopedLessons.length === 0 ? 'This program has no released lessons yet.' : undefined}
        >
          <Select
            value={lessonId}
            disabled={Boolean(courseId) && scopedLessons.length === 0}
            onChange={(event) => setLessonId(event.target.value)}
          >
            <option value="">Not tied to a lesson</option>
            {scopedLessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Topic (optional)" className="md:col-span-2">
          <Input
            value={topic}
            maxLength={120}
            placeholder="e.g. Week 3 — pressure checks"
            onChange={(event) => setTopic(event.target.value)}
          />
        </Field>
      </div>

      <Field label="Description (optional)">
        <Textarea
          value={description}
          rows={2}
          maxLength={4000}
          placeholder="What is this document for, and when should someone read it?"
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      {state.kind === 'note' ? (
        <Field label="Note" hint={`${content.length.toLocaleString()} of 200,000 characters`}>
          <Textarea
            value={content}
            rows={14}
            maxLength={200_000}
            className="font-mono text-[13px] leading-6"
            placeholder="Write the note. Line breaks are preserved."
            onChange={(event) => setContent(event.target.value)}
          />
        </Field>
      ) : null}

      {needsFile ? (
        <Field
          label="File"
          hint={`PDF, Word, plain text, Markdown or RTF — up to ${Math.round(
            MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024),
          )} MB.`}
        >
          <input
            type="file"
            accept={DOCUMENT_EXTENSIONS.join(',')}
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            className={fieldClass}
          />
          {file ? (
            <span className="mt-2 block font-mono text-[11.5px] text-ink-faint">
              {file.name} · {formatBytes(file.size)}
            </span>
          ) : null}
        </Field>
      ) : null}

      {existing && existing.kind === 'file' ? (
        <p className="rounded-control border border-hairline bg-deeper px-4 py-3 text-[12.5px] leading-6 text-ink-faint">
          The stored file cannot be replaced from this form. Upload the revised file as a new
          document and delete this one when the replacement is in place.
        </p>
      ) : null}

      {progress !== null ? (
        <div className="space-y-2" role="status">
          <div className="learn-progress" aria-hidden>
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="font-mono text-[11.5px] text-ink-faint">Uploading… {progress}%</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={save}>
          {busy
            ? needsFile
              ? 'Uploading…'
              : 'Saving…'
            : existing
              ? 'Save changes'
              : state.kind === 'note'
                ? 'Save note'
                : 'Upload document'}
        </Button>
      </div>
    </Card>
  );
}

export default function DocumentsPage() {
  const { can } = useSession();
  const canManage = can('learning:manage');
  const cache = useQueryClient();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query);
  const [kind, setKind] = useState<KindFilter>('all');
  const [category, setCategory] = useState('all');
  const [courseId, setCourseId] = useState('all');
  const [lessonId, setLessonId] = useState('all');

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const courses = useQuery({
    queryKey: ['document-courses'],
    queryFn: () => apiFetch<{ courses: CourseOption[] }>('/courses'),
  });
  const lessons = useQuery({
    queryKey: ['document-lessons', canManage],
    queryFn: () =>
      apiFetch<{ lessons: LessonOption[] }>(
        `/lessons${canManage ? '?includeDrafts=true' : ''}`,
      ),
  });

  const documents = useQuery({
    queryKey: [
      'documents',
      debouncedQuery,
      kind,
      category,
      courseId,
      lessonId,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
      if (kind !== 'all') params.set('kind', kind);
      if (category !== 'all') params.set('category', category);
      if (courseId !== 'all') params.set('courseId', courseId);
      if (lessonId !== 'all') params.set('lessonId', lessonId);
      const suffix = params.toString();
      return apiFetch<{ documents: DocumentView[] }>(
        `/documents${suffix ? `?${suffix}` : ''}`,
      );
    },
  });

  const scopedFilterLessons = useMemo(() => {
    if (courseId === 'all') return lessons.data?.lessons ?? [];
    return (
      courses.data?.courses.find((course) => course.id === courseId)?.lessons ?? []
    );
  }, [courseId, courses.data, lessons.data]);

  const availableCategories = useMemo(() => {
    const seen = new Set<string>(DOCUMENT_CATEGORIES);
    for (const document of documents.data?.documents ?? []) seen.add(document.category);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [documents.data]);

  const filtered = documents.data?.documents ?? [];
  const fileCount = filtered.filter((document) => document.kind === 'file').length;
  const noteCount = filtered.length - fileCount;
  const filtersActive =
    query.trim().length > 0 ||
    kind !== 'all' ||
    category !== 'all' ||
    courseId !== 'all' ||
    lessonId !== 'all';

  async function refresh() {
    await cache.invalidateQueries({ queryKey: ['documents'] });
    if (activeId) await cache.invalidateQueries({ queryKey: ['document', activeId] });
  }

  function download(document: DocumentView) {
    window.location.assign(`${API_PUBLIC_BASE}/documents/${document.id}/content?download=1`);
  }

  async function remove(document: DocumentView) {
    const confirmed = window.confirm(
      `Delete “${document.title}”? ${
        document.kind === 'file' ? 'The stored file will also be removed. ' : ''
      }This cannot be undone.`,
    );
    if (!confirmed) return;

    setBusyId(document.id);
    setError(null);
    try {
      await apiFetch(`/documents/${document.id}`, { method: 'DELETE' });
      if (activeId === document.id) setActiveId(null);
      if (editor?.document?.id === document.id) setEditor(null);
      setNotice('Document deleted.');
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function beginEdit(document: DocumentView) {
    setError(null);
    setNotice('');
    if (document.kind === 'note' && document.content === undefined) {
      // The card summary does not carry the body; fetch the detail first so the
      // editor opens with the real note instead of the excerpt.
      try {
        const result = await apiFetch<{ document: DocumentView }>(`/documents/${document.id}`);
        setEditor({ kind: 'note', document: result.document });
      } catch (caught) {
        setError((caught as Error).message);
      }
      return;
    }
    setEditor({ kind: document.kind, document });
  }

  function openEditor(next: EditorState) {
    setError(null);
    setNotice('');
    setEditor(next);
  }

  if (documents.isLoading) return <LoadingBlock label="Loading documents" />;
  if (documents.error) return <ErrorNote message={(documents.error as Error).message} />;

  if (activeId) {
    return (
      <div className="space-y-6">
        {error ? <ErrorNote message={error} /> : null}
        {notice ? (
          <p role="status" className="text-sm text-brand">
            {notice}
          </p>
        ) : null}
        <DocumentDetail
          id={activeId}
          canManage={canManage}
          busy={busyId === activeId}
          onBack={() => setActiveId(null)}
          onEdit={beginEdit}
          onDelete={remove}
        />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Documents &amp; notes</p>
          <h1 className="mt-2">Reading, filed where it belongs</h1>
          <p className="mt-3 max-w-[68ch] text-sm leading-7 text-ink-dim">
            Upload handouts, references and assignments, or write a note. File each item under a
            program, a lesson and a topic, then search the whole collection in one place.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => openEditor({ kind: 'file', document: null })}>
              <Upload size={16} />
              Upload a document
            </Button>
            <Button onClick={() => openEditor({ kind: 'note', document: null })}>
              <Plus size={16} />
              New note
            </Button>
          </div>
        ) : null}
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <p role="status" className="text-sm text-brand">
          {notice}
        </p>
      ) : null}

      {editor ? (
        <DocumentEditor
          key={editor.document?.id ?? `new-${editor.kind}`}
          state={editor}
          courses={courses.data?.courses ?? []}
          lessons={lessons.data?.lessons ?? []}
          onCancel={() => setEditor(null)}
          onSaved={async (document) => {
            setEditor(null);
            setNotice(
              editor.document ? 'Document updated.' : 'Document added to the workspace.',
            );
            await cache.invalidateQueries({ queryKey: ['documents'] });
            await cache.invalidateQueries({ queryKey: ['document', document.id] });
          }}
        />
      ) : null}

      <Card className="space-y-4 p-5">
        <SearchField
          label="Search titles, topics, categories and note bodies"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', 'Everything'],
              ['file', 'Files'],
              ['note', 'Notes'],
            ] as const
          ).map(([value, label]) => (
            <FilterChip
              key={value}
              selected={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </FilterChip>
          ))}

          <span aria-hidden className="mx-1 hidden h-5 w-px bg-hairline sm:block" />

          <Select
            aria-label="Filter by category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="w-auto min-w-[150px]"
          >
            <option value="all">All categories</option>
            {availableCategories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by program"
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setLessonId('all');
            }}
            className="w-auto min-w-[170px]"
          >
            <option value="all">All programs</option>
            {(courses.data?.courses ?? []).map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by lesson"
            value={lessonId}
            onChange={(event) => setLessonId(event.target.value)}
            className="w-auto min-w-[170px]"
          >
            <option value="all">All lessons</option>
            {scopedFilterLessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </Select>

          {filtersActive ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery('');
                setKind('all');
                setCategory('all');
                setCourseId('all');
                setLessonId('all');
              }}
            >
              Clear filters
            </Button>
          ) : null}

          <span className="ml-auto font-mono text-[12.5px] text-ink-faint" aria-live="polite">
            {filtered.length} document{filtered.length === 1 ? '' : 's'} · {fileCount} file
            {fileCount === 1 ? '' : 's'} · {noteCount} note{noteCount === 1 ? '' : 's'}
          </span>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No documents match those filters' : 'No reading material yet'}
          hint={
            filtersActive
              ? 'Try a broader search, or clear the program and lesson filters.'
              : canManage
                ? 'Upload a handout or write a note, then file it under a program so it appears beside the lesson.'
                : 'Your team’s documents and notes will appear here once they are added.'
          }
          action={
            filtersActive ? (
              <Button
                onClick={() => {
                  setQuery('');
                  setKind('all');
                  setCategory('all');
                  setCourseId('all');
                  setLessonId('all');
                }}
              >
                Clear filters
              </Button>
            ) : canManage ? (
              <Button
                variant="primary"
                onClick={() => openEditor({ kind: 'file', document: null })}
              >
                <Upload size={16} />
                Upload a document
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              canManage={canManage}
              busy={busyId === document.id}
              onOpen={() => setActiveId(document.id)}
              onEdit={() => void beginEdit(document)}
              onDelete={() => void remove(document)}
              onDownload={() => download(document)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
