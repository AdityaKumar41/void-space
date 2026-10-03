/**
 * Studio Job Producer (VS2-SRS-1.0 §3.1, §5.1).
 *
 * Exposes a typed helper to enqueue jobs into Studio BullMQ queues and create
 * matching rows in the `Job` database table.
 */
import { withStudioTenant } from '@void-space/studio-db';
import type { ConnectionOptions } from 'bullmq';

import {
  type StudioQueueName,
  createStudioQueueRegistry,
  studioJobOptionsFor,
} from '../queues';

export interface StudioProducer {
  enqueue<T extends Record<string, unknown>>(
    queueName: StudioQueueName,
    jobName: string,
    payload: T & { tenantId: string; projectId?: string; userId?: string },
  ): Promise<{ jobId: string; bullJobId: string }>;
  close(): Promise<void>;
}

export function createStudioProducer(connection: ConnectionOptions): StudioProducer {
  const registry = createStudioQueueRegistry(connection);

  return {
    async enqueue<T extends Record<string, unknown>>(
      queueName: StudioQueueName,
      jobName: string,
      payload: T & { tenantId: string; projectId?: string; userId?: string },
    ): Promise<{ jobId: string; bullJobId: string }> {
      const queue = registry[queueName];
      if (!queue) {
        throw new Error(`Queue ${queueName} is not registered`);
      }

      // 1. Add to BullMQ
      const bullJob = await queue.add(jobName, payload, studioJobOptionsFor(queueName));

      // 2. Persist in studio-db
      const dbJob = await withStudioTenant(payload.tenantId, async (db) => {
        return db.job.create({
          data: {
            tenantId: payload.tenantId,
            projectId: payload.projectId ?? null,
            userId: payload.userId ?? null,
            queue: queueName,
            status: 'queued',
            bullJobId: bullJob.id ?? null,
            payload: payload as any,
          },
        });
      });

      return {
        jobId: dbJob.id,
        bullJobId: bullJob.id ?? '',
      };
    },

    async close(): Promise<void> {
      for (const q of Object.values(registry)) {
        await q.close();
      }
    },
  };
}
