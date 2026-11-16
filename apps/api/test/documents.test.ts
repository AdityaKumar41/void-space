/**
 * Documents & Notes acceptance tests.
 *
 * The suite drives the shipping multipart path with a real file body, then reads
 * the stored bytes back through the authenticated content route. It also checks
 * the two properties that are easy to lose in a feature like this: a caller
 * outside the tenant cannot resolve a document at all, and the filename /
 * content-type checks reject a file whose bytes do not match its extension.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenant } from '@void-space/db';

import {
  cookieHeader,
  createTestApp,
  DEMO,
  DEMO_TENANT_IDS,
  login,
  type TestApp,
} from './helpers';

let context: TestApp;
let creatorCookie: string;
let viewerCookie: string;
let otherTenantCookie: string;
let documentsRoot: string;
let lessonId: string;
let courseId: string;

const documentIds: string[] = [];

interface MultipartFile {
  readonly field: string;
  readonly filename: string;
  readonly mime: string;
  readonly content: Buffer;
}

/** Builds a multipart body with the text fields first, matching the route contract. */
function multipartBody(
  fields: Record<string, string>,
  file?: MultipartFile,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----voidspaceDocs${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }

  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.mime}\r\n\r\n`,
        'utf8',
      ),
    );
    chunks.push(file.content);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(
  cookie: string,
  fields: Record<string, string>,
  file: MultipartFile,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const { payload, headers } = multipartBody(fields, file);
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/v1/documents',
    headers: { cookie, ...headers },
    payload,
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  // Keep uploads out of the repository's real `.documents` store.
  documentsRoot = await mkdtemp(join(tmpdir(), 'void-documents-'));
  process.env['DOCUMENTS_DIR'] = documentsRoot;

  context = await createTestApp();

  const creator = await login(context.app, DEMO.users.auroraCreator);
  creatorCookie = cookieHeader(creator.cookies, 'vs_access');
  const viewer = await login(context.app, DEMO.users.auroraViewer);
  viewerCookie = cookieHeader(viewer.cookies, 'vs_access');
  const other = await login(context.app, DEMO.users.northwindAdmin);
  otherTenantCookie = cookieHeader(other.cookies, 'vs_access');

  // A published lesson and programme to file documents under.
  const asset = await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
    db.asset.findFirst({
      where: { tenantId: DEMO_TENANT_IDS.aurora, status: { in: ['approved', 'published'] } },
      select: { id: true },
    }),
  );
  if (!asset) throw new Error('Expected a seeded approved asset');

  const lesson = await context.app.inject({
    method: 'POST',
    url: '/api/v1/lessons',
    headers: { cookie: creatorCookie },
    payload: { assetId: asset.id, title: `Documents fixture lesson ${randomUUID().slice(0, 6)}` },
  });
  lessonId = (lesson.json() as { lesson: { id: string } }).lesson.id;

  const publishedLesson = await context.app.inject({
    method: 'POST',
    url: `/api/v1/lessons/${lessonId}/publish`,
    headers: { cookie: creatorCookie },
  });
  if (publishedLesson.statusCode !== 200) {
    throw new Error(`Could not publish fixture lesson: ${publishedLesson.body}`);
  }

  const course = await context.app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    headers: { cookie: creatorCookie },
    payload: {
      title: 'Documents fixture programme',
      slug: `documents-fixture-${randomUUID().slice(0, 8)}`,
      description: 'A programme created by the documents acceptance suite for filing tests.',
      lessonIds: [lessonId],
    },
  });
  courseId = (course.json() as { course: { id: string } }).course.id;
  await context.app.inject({
    method: 'POST',
    url: `/api/v1/courses/${courseId}/publish`,
    headers: { cookie: creatorCookie },
  });
});

afterAll(async () => {
  await withTenant(DEMO_TENANT_IDS.aurora, async (db) => {
    if (documentIds.length > 0) {
      await db.document.deleteMany({ where: { id: { in: documentIds } } });
    }
    if (courseId) await db.course.deleteMany({ where: { id: courseId } });
    if (lessonId) await db.lesson.deleteMany({ where: { id: lessonId } });
  });
  await context?.close();
  await rm(documentsRoot, { recursive: true, force: true });
});

describe('Documents & Notes', () => {
  it('uploads, filters, previews and downloads a text file, then edits and deletes it', async () => {
    const title = `Hydraulics reading ${randomUUID().slice(0, 6)}`;
    const body = 'Pressure checks\nAlways isolate the line before opening the housing.\n';

    const created = await upload(
      creatorCookie,
      {
        title,
        description: 'Pre-shift reading for the pump bay.',
        category: 'Reading',
        topic: 'Week 3',
        courseId,
        lessonId,
      },
      {
        field: 'file',
        filename: 'hydraulics.txt',
        mime: 'text/plain',
        content: Buffer.from(body, 'utf8'),
      },
    );

    expect(created.statusCode).toBe(201);
    const document = created.body['document'] as Record<string, unknown>;
    const id = document['id'] as string;
    documentIds.push(id);

    expect(document['kind']).toBe('file');
    expect(document['extension']).toBe('.txt');
    expect(document['sizeBytes']).toBe(Buffer.byteLength(body));
    expect((document['course'] as { id: string }).id).toBe(courseId);
    expect((document['lesson'] as { id: string }).id).toBe(lessonId);

    // Search reaches the title and the topic, and the filters narrow to the programme.
    const list = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents?q=${encodeURIComponent('hydraulics')}&kind=file&courseId=${courseId}`,
      headers: { cookie: creatorCookie },
    });
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { documents: { id: string }[] }).documents;
    expect(listed.map((row) => row.id)).toContain(id);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}`,
      headers: { cookie: viewerCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { document: { title: string } }).document.title).toBe(title);

    const preview = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}/content`,
      headers: { cookie: viewerCookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('text/plain');
    expect(preview.headers['content-disposition']).toContain('inline');
    expect(preview.body).toBe(body);

    const download = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}/content?download=1`,
      headers: { cookie: viewerCookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['content-disposition']).toContain('hydraulics.txt');

    const patched = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${id}`,
      headers: { cookie: creatorCookie },
      payload: {
        title: `${title} (revised)`,
        category: 'Reference',
        topic: 'Week 4',
        courseId: null,
        lessonId: null,
      },
    });
    expect(patched.statusCode).toBe(200);
    const updated = (patched.json() as { document: Record<string, unknown> }).document;
    expect(updated['title']).toBe(`${title} (revised)`);
    expect(updated['category']).toBe('Reference');
    expect(updated['topic']).toBe('Week 4');
    expect(updated['courseId']).toBeNull();
    expect(updated['lessonId']).toBeNull();

    const deleted = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${id}`,
      headers: { cookie: creatorCookie },
    });
    expect(deleted.statusCode).toBe(204);
    documentIds.splice(documentIds.indexOf(id), 1);

    const gone = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}`,
      headers: { cookie: creatorCookie },
    });
    expect(gone.statusCode).toBe(404);
  });

  it('creates a note, finds it by its body and edits the body', async () => {
    const title = `Torque settings ${randomUUID().slice(0, 6)}`;

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/v1/documents/notes',
      headers: { cookie: creatorCookie },
      payload: {
        title,
        description: 'Bench note from the maintenance bay.',
        category: 'Study note',
        topic: 'Fasteners',
        courseId,
        lessonId,
        content: 'Torque the flange bolts to 42 Nm in a crossing pattern.',
      },
    });
    expect(created.statusCode).toBe(201);
    const note = (created.json() as { document: Record<string, unknown> }).document;
    const id = note['id'] as string;
    documentIds.push(id);
    expect(note['kind']).toBe('note');
    expect(note['content']).toContain('42 Nm');
    expect(note['excerpt']).toContain('crossing pattern');

    const search = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents?q=${encodeURIComponent('crossing pattern')}&kind=note`,
      headers: { cookie: viewerCookie },
    });
    expect(search.statusCode).toBe(200);
    expect(
      (search.json() as { documents: { id: string }[] }).documents.map((row) => row.id),
    ).toContain(id);

    const patched = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${id}`,
      headers: { cookie: creatorCookie },
      payload: { content: 'Torque the flange bolts to 45 Nm in a crossing pattern.' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { document: { content: string } }).document.content).toContain(
      '45 Nm',
    );

    // A note has no stored file; the content route must say so rather than guess.
    const content = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}/content`,
      headers: { cookie: creatorCookie },
    });
    expect(content.statusCode).toBe(400);
  });

  it('rejects unsupported types, mismatched bytes and note bodies on a file', async () => {
    const unsupported = await upload(
      creatorCookie,
      { title: 'Executable', category: 'General' },
      {
        field: 'file',
        filename: 'payload.exe',
        mime: 'application/octet-stream',
        content: Buffer.from('MZ', 'ascii'),
      },
    );
    expect(unsupported.statusCode).toBe(400);

    const mismatched = await upload(
      creatorCookie,
      { title: 'Fake PDF', category: 'General' },
      {
        field: 'file',
        filename: 'handout.pdf',
        mime: 'application/pdf',
        content: Buffer.from('This is not a PDF at all.', 'utf8'),
      },
    );
    expect(mismatched.statusCode).toBe(400);

    const missing = await context.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        cookie: creatorCookie,
        'content-type': 'multipart/form-data; boundary=----voidspaceEmpty',
      },
      payload: '------voidspaceEmpty--\r\n',
    });
    expect(missing.statusCode).toBe(400);

    const file = await upload(
      creatorCookie,
      { title: 'Reading for editing', category: 'Reading' },
      {
        field: 'file',
        filename: 'reading.txt',
        mime: 'text/plain',
        content: Buffer.from('A plain reading.', 'utf8'),
      },
    );
    const fileId = (file.body['document'] as { id: string }).id;
    documentIds.push(fileId);

    const wrongBody = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${fileId}`,
      headers: { cookie: creatorCookie },
      payload: { content: 'A file cannot acquire a note body.' },
    });
    expect(wrongBody.statusCode).toBe(400);
  });

  it('keeps documents inside the tenant and requires learning:manage to write', async () => {
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/v1/documents/notes',
      headers: { cookie: creatorCookie },
      payload: {
        title: `Tenant boundary ${randomUUID().slice(0, 6)}`,
        content: 'Visible only to Aurora.',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { document: { id: string } }).document.id;
    documentIds.push(id);

    const sameTenant = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}`,
      headers: { cookie: viewerCookie },
    });
    expect(sameTenant.statusCode).toBe(200);

    const otherTenant = await context.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}`,
      headers: { cookie: otherTenantCookie },
    });
    expect(otherTenant.statusCode).toBe(404);

    const viewerWrite = await context.app.inject({
      method: 'POST',
      url: '/api/v1/documents/notes',
      headers: { cookie: viewerCookie },
      payload: { title: 'Viewer note', content: 'Should be refused.' },
    });
    expect(viewerWrite.statusCode).toBe(403);
  });
});
