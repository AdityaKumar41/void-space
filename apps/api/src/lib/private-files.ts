import type { FastifyReply, FastifyRequest } from 'fastify';
import { streamLearningFile } from '@void-space/db';
import { ServiceUnavailableError } from './errors';
/** Call only after the owning source or authorized immutable release was resolved. */
export async function sendPrivateFile(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  mime: string,
  stagingDir: string,
) {
  try {
    const file = await streamLearningFile(path, stagingDir, request.headers.range);
    if (file.contentRange) reply.code(206).header('Content-Range', file.contentRange);
    return reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', file.sizeBytes)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type(mime)
      .send(file.body);
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 416
    )
      return reply
        .code(416)
        .send({ code: 'INVALID_RANGE', message: 'Requested bytes are outside this file.' });
    throw new ServiceUnavailableError(
      'Private file storage unavailable',
      'PRIVATE_STORAGE_UNAVAILABLE',
      {
        retryable: true,
        recovery:
          'Retry shortly. If the file remains unavailable, contact the workspace administrator.',
      },
    );
  }
}
