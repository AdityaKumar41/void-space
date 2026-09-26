/**
 * Tests for the multipart encoder.
 *
 * The ordering assertion is the whole point of this file. `POST /api/v1/assets` validates metadata
 * *before* the file so it can reject a bad upload before 200 MB is streamed to disk, and a body with
 * the file first still succeeds — it just wastes the upload and then fails. Nothing about that
 * failure is visible in a passing happy-path test, which is why the ordering is asserted directly
 * on the encoded bytes rather than inferred from a successful parse.
 */
import { describe, expect, it } from 'vitest';

import { buildMultipartBody } from '../src/multipart';

const FILE_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46]); // 'glTF'

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('buildMultipartBody', () => {
  it('writes every metadata field before the file part', async () => {
    const body = await buildMultipartBody(
      { name: 'Crate', category: 'Prop', submitForReview: 'true' },
      { filename: 'crate.glb', contentType: 'model/gltf-binary', data: FILE_BYTES },
      { boundary: 'X' },
    );

    const text = decode(body.body);
    const fileHeader = text.indexOf('filename="crate.glb"');

    expect(fileHeader).toBeGreaterThan(-1);
    for (const field of ['name="name"', 'name="category"', 'name="submitForReview"']) {
      const at = text.indexOf(field);
      expect(at, `${field} should be present`).toBeGreaterThan(-1);
      expect(at, `${field} must precede the file part`).toBeLessThan(fileHeader);
    }
  });

  it('places the file bytes between the file header and the closing boundary', async () => {
    const body = await buildMultipartBody({}, { filename: 'a.glb', data: FILE_BYTES }, { boundary: 'X' });
    const text = decode(body.body);

    const headerEnd = text.indexOf('\r\n\r\n', text.indexOf('filename="a.glb"')) + 4;
    const closing = text.indexOf('\r\n--X--');

    expect(headerEnd).toBeGreaterThan(3);
    expect(closing).toBeGreaterThan(headerEnd);
    // The four magic bytes must survive verbatim; an encoder that ran the payload through a text
    // codec would corrupt any byte above 0x7f here without failing.
    expect(body.body.slice(headerEnd, closing)).toEqual(FILE_BYTES);
  });

  it('reports the boundary it actually used, so the header and the body cannot disagree', async () => {
    const body = await buildMultipartBody({}, { filename: 'a.glb', data: FILE_BYTES }, { boundary: 'abc123' });
    expect(body.contentType).toBe('multipart/form-data; boundary=abc123');
    expect(decode(body.body)).toContain('--abc123\r\n');
    expect(decode(body.body).endsWith('--abc123--\r\n')).toBe(true);
  });

  it('generates a different boundary per call when none is supplied', async () => {
    const first = await buildMultipartBody({}, { filename: 'a.glb', data: FILE_BYTES });
    const second = await buildMultipartBody({}, { filename: 'a.glb', data: FILE_BYTES });
    expect(first.contentType).not.toBe(second.contentType);
  });

  it('refuses to let a filename inject a header', async () => {
    const body = await buildMultipartBody(
      {},
      { filename: 'evil";\r\nX-Injected: 1\r\n\r\ngarbage', data: FILE_BYTES },
      { boundary: 'X' },
    );
    const text = decode(body.body);

    // The CR and LF must be neutralised, so what would have been a new header stays inside the
    // quoted filename on the original line rather than beginning a header of its own. Asserting the
    // single-line property rather than the exact spacing keeps this from breaking on a whitespace
    // tweak while still failing if the injection ever becomes possible again.
    expect(text).not.toContain('\r\nX-Injected: 1');
    const filenameLine = text.split('\r\n').find((line) => line.includes('filename=')) ?? '';
    expect(filenameLine).toContain('X-Injected: 1');
    expect(filenameLine.endsWith('garbage"')).toBe(true);
    // The quote is escaped rather than stripped, so the surrounding quoting cannot be closed early.
    expect(filenameLine).toContain('\\"');
  });

  it('accepts an ArrayBuffer and a Blob as well as a Uint8Array', async () => {
    const fromArrayBuffer = await buildMultipartBody(
      {},
      { filename: 'a.glb', data: FILE_BYTES.buffer as ArrayBuffer },
      { boundary: 'X' },
    );
    expect(decode(fromArrayBuffer.body)).toContain('glTF');

    const fromBlob = await buildMultipartBody(
      {},
      { filename: 'a.glb', data: new Blob([FILE_BYTES]) },
      { boundary: 'X' },
    );
    expect(decode(fromBlob.body)).toContain('glTF');
  });

  it('defaults the file field name to `file`, which is what the API looks for', async () => {
    const body = await buildMultipartBody({}, { filename: 'a.glb', data: FILE_BYTES }, { boundary: 'X' });
    expect(decode(body.body)).toContain('name="file"; filename="a.glb"');
  });
});
