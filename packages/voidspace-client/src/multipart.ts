/**
 * A `multipart/form-data` encoder that guarantees **metadata fields precede the file part**.
 *
 * This is not a stylistic choice. `POST /api/v1/assets` reads the request as a stream and
 * expects the text fields to arrive before the file, so it can reject an invalid upload
 * *before* 200 MB has been streamed to disk (SDD §2.4, and the comment on `readUpload` in
 * `apps/api/src/modules/assets/routes.ts`). A body with the file first is not rejected with
 * a helpful error — the file is simply staged and the metadata then fails, having already
 * paid the upload cost.
 *
 * `FormData` is deliberately not used here. Append order does happen to be preserved by
 * current `undici` and browser implementations, but that is an implementation detail of each
 * runtime rather than a guarantee, and the failure mode if it ever changes is a silent
 * bandwidth regression rather than an error. Emitting the bytes directly makes the ordering
 * a property of this function, which the test suite asserts.
 */

/** The file part of an upload. `data` is resolved lazily so a `Blob` need not be buffered first. */
export interface MultipartFilePart {
  readonly fieldName?: string;
  readonly filename: string;
  readonly contentType?: string;
  readonly data: Uint8Array | ArrayBuffer | Blob;
}

export interface MultipartBody {
  /** The fully-encoded body, with the terminating boundary already appended. */
  readonly body: Uint8Array;
  /** Includes the generated `boundary` parameter, so it can be assigned to `Content-Type` verbatim. */
  readonly contentType: string;
}

const CRLF = '\r\n';
const DEFAULT_FILE_FIELD = 'file';
const DEFAULT_FILE_TYPE = 'application/octet-stream';

/**
 * A boundary must not appear inside the body. It is generated fresh per request from random
 * bytes, which makes a collision a practical impossibility; a caller-supplied boundary is not
 * accepted, because getting that wrong corrupts the body rather than failing loudly.
 */
function generateBoundary(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Only reachable on a runtime without WebCrypto. Randomness here guards against body
    // collision, not against an attacker, so a weaker source is acceptable but must not
    // silently produce a constant boundary across calls.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `----voidstudio${hex}`;
}

/**
 * A header value cannot contain a CR or LF, or it would inject a header. Node's multipart
 * parser lowercases and strips quotes from filenames, so a quote is escaped rather than
 * removed — the upload keeps the name the Creator chose.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/"/g, '\\"');
}

async function toBytes(data: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Encodes `fields`, then the file, then the closing boundary — in that order.
 *
 * Field values are written as received; callers must pass already-serialized strings
 * (the publishing path passes `JSON.stringify` for `tags` and `metadata`, matching how
 * `metadataFromFields` on the API side parses them back).
 */
export async function buildMultipartBody(
  fields: Readonly<Record<string, string>>,
  file: MultipartFilePart,
  options: { readonly boundary?: string } = {},
): Promise<MultipartBody> {
  const boundary = options.boundary ?? generateBoundary();
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  const delimiter = `--${boundary}${CRLF}`;

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      encoder.encode(
        `${delimiter}Content-Disposition: form-data; name="${sanitizeHeaderValue(name)}"${CRLF}${CRLF}${value}${CRLF}`,
      ),
    );
  }

  const fileField = file.fieldName ?? DEFAULT_FILE_FIELD;
  chunks.push(
    encoder.encode(
      `${delimiter}Content-Disposition: form-data; name="${sanitizeHeaderValue(fileField)}"; ` +
        `filename="${sanitizeHeaderValue(file.filename)}"${CRLF}` +
        `Content-Type: ${file.contentType ?? DEFAULT_FILE_TYPE}${CRLF}${CRLF}`,
    ),
  );
  chunks.push(await toBytes(file.data));
  chunks.push(encoder.encode(`${CRLF}--${boundary}--${CRLF}`));

  return {
    body: concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
