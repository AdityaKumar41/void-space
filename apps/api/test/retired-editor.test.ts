import { expect, it } from 'vitest';
import { createTestApp } from './helpers';

it('does not expose retired editor credential or model-transfer endpoints', async () => {
  const context = await createTestApp();
  try {
    for (const method of ['GET', 'POST', 'PATCH'] as const) {
      for (const path of [
        '/auth/studio-token',
        '/tools/sketchfab/transfer',
        '/tools/sketchfab/receive',
        '/tenant/ai-flags',
      ]) {
        const response = await context.app.inject({
          method,
          url: `/api/v1${path}`,
          ...(method === 'GET' ? {} : { payload: {} }),
        });
        expect(response.statusCode, `${method} ${path}`).toBe(404);
      }
    }
  } finally {
    await context.close();
  }
});
