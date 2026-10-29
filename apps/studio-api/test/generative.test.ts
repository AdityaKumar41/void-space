import { describe, expect, it } from 'vitest';

import { meshyAssetUrlAllowed } from '../src/modules/meshy-assets';
import { buildTestApp } from './harness';

describe('Meshy asset downloads', () => {
  it('allows only Meshy HTTPS hosts', () => {
    expect(meshyAssetUrlAllowed('https://assets.meshy.ai/tasks/mesh.glb')).toBe(
      'https://assets.meshy.ai/tasks/mesh.glb',
    );
    expect(meshyAssetUrlAllowed('http://assets.meshy.ai/mesh.glb')).toBeNull();
    expect(meshyAssetUrlAllowed('https://evil.example/mesh.glb')).toBeNull();
    expect(meshyAssetUrlAllowed('https://169.254.169.254/latest/meta-data')).toBeNull();
    expect(meshyAssetUrlAllowed('https://user:pass@assets.meshy.ai/mesh.glb')).toBeNull();
  });

  it('refuses an unauthenticated generation request', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/studio/api/v1/generative/tasks',
      payload: { kind: 'text-to-3d', prompt: 'a ceramic teapot' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
