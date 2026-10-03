import { describe, expect, it } from 'vitest';
import pino from 'pino';

import {
  STUDIO_QUEUE_NAMES,
  STUDIO_QUEUE_POLICIES,
  studioConcurrencyFor,
  studioJobOptionsFor,
} from '../src/queues';
import { createCsgProcessor } from '../src/processors/csg';
import { createExportProcessor } from '../src/processors/export';
import { createPublishProcessor } from '../src/processors/publish';

const silentLogger = pino({ level: 'silent' });

describe('studio-worker queue definitions', () => {
  it('covers all six Studio job queues with defined policies', () => {
    expect(STUDIO_QUEUE_NAMES).toEqual([
      'publish',
      'generative',
      'csg',
      'export',
      'autosave',
      'copilot',
    ]);

    for (const name of STUDIO_QUEUE_NAMES) {
      const policy = STUDIO_QUEUE_POLICIES[name];
      expect(policy).toBeDefined();
      expect(policy.name).toBe(name);
      expect(policy.attempts).toBeGreaterThanOrEqual(1);
      expect(policy.defaultConcurrency).toBeGreaterThan(0);
    }
  });

  it('respects concurrency overrides from environment variables', () => {
    process.env.STUDIO_CONCURRENCY_PUBLISH = '8';
    expect(studioConcurrencyFor('publish')).toBe(8);
    delete process.env.STUDIO_CONCURRENCY_PUBLISH;
    expect(studioConcurrencyFor('publish')).toBe(2);
  });

  it('derives job options with proper retry settings', () => {
    const opts = studioJobOptionsFor('publish');
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delayMs: 2_000 });
  });
});

describe('studio-worker processors', () => {
  it('CSG processor returns valid result metadata', async () => {
    const processCsg = createCsgProcessor(silentLogger);
    const result = await processCsg({
      id: 'job-1',
      data: {
        tenantId: '11111111-1111-1111-1111-111111111111',
        projectId: '22222222-2222-2222-2222-222222222222',
        operation: 'union',
        targetMeshId: 'mesh-1',
        operandMeshId: 'mesh-2',
      },
    } as any);

    expect(result.status).toBe('success');
    expect(result.polycount).toBeGreaterThan(0);
    expect(result.manifold).toBe(true);
  });

  it('Export processor rejects non-GLB files', async () => {
    const processExport = createExportProcessor(silentLogger);
    const fakeBuffer = Buffer.from('not a gltf binary');
    const result = await processExport({
      id: 'job-2',
      data: {
        tenantId: '11111111-1111-1111-1111-111111111111',
        projectId: '22222222-2222-2222-2222-222222222222',
        format: 'glb',
        filename: 'test.glb',
        fileBase64: fakeBuffer.toString('base64'),
      },
    } as any);

    expect(result.valid).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('Publish processor rejects export when gate fails', async () => {
    const processPublish = createPublishProcessor(silentLogger);
    await expect(
      processPublish({
        id: 'job-3',
        data: {
          tenantId: '11111111-1111-1111-1111-111111111111',
          projectId: '22222222-2222-2222-2222-222222222222',
          metadata: { name: 'Test', category: 'weapons' },
          file: {
            base64: 'abc',
            filename: 'test.glb',
            mimeType: 'model/gltf-binary',
            sizeBytes: 100,
            sha256: 'hash',
          },
          exportValidation: {
            valid: false,
            reasons: ['corrupt-gltf-header'],
            messages: ['Corrupted GLB header'],
          },
          audit: {
            score: 40,
            threshold: 80,
            recommendation: 'blocked',
            issues: [],
          },
        },
      } as any),
    ).rejects.toThrow(/Publish gate failed/);
  });
});
