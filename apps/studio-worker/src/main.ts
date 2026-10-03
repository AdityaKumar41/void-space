/**
 * Studio Worker runtime (VS2-SRS-1.0 §3.1, §7.5) — imported by server.ts.
 *
 * Runs BullMQ workers for all VOID·STUDIO background queues with retry policies,
 * tenant RLS isolation, and database job status tracking.
 */
import { withStudioTenant } from '@void-space/studio-db';
import { Worker, type Job as BullJob } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { createAutosaveProcessor } from './processors/autosave';
import { createCsgProcessor } from './processors/csg';
import { createExportProcessor } from './processors/export';
import { createGenerativeProcessor } from './processors/generative';
import { createPublishProcessor } from './processors/publish';
import {
  STUDIO_QUEUE_NAMES,
  type StudioQueueName,
  studioConcurrencyFor,
} from './queues';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
      : undefined,
});

export async function main(): Promise<void> {
  const redisUrl = process.env.STUDIO_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6380';
  logger.info({ redis: redisUrl.replace(/\/\/.*@/, '//') }, 'connecting studio-worker to Redis');

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (err) => logger.error({ err }, 'Redis connection error in studio-worker'));

  try {
    await connection.ping();
    logger.info('studio-worker connected to Redis');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Redis is not available; studio-worker will retry on reconnect');
  }

  // Instantiate processors
  const processors: Record<StudioQueueName, (job: BullJob) => Promise<unknown>> = {
    publish: createPublishProcessor(logger),
    generative: createGenerativeProcessor(logger),
    csg: createCsgProcessor(logger),
    export: createExportProcessor(logger),
    autosave: createAutosaveProcessor(logger),
    copilot: async (job) => {
      logger.info({ jobId: job.id }, 'executing copilot offload task');
      return { status: 'completed' };
    },
  };

  const workers: Worker[] = [];

  for (const queueName of STUDIO_QUEUE_NAMES) {
    const concurrency = studioConcurrencyFor(queueName);
    const processor = processors[queueName];

    const worker = new Worker(
      queueName,
      async (job: BullJob) => {
        // Mark job active in DB if tenantId is provided
        const tenantId = job.data?.tenantId;
        if (tenantId) {
          await withStudioTenant(tenantId, async (db) => {
            await db.job.updateMany({
              where: { bullJobId: job.id },
              data: { status: 'active', startedAt: new Date() },
            });
          }).catch(() => {});
        }

        return processor(job);
      },
      {
        connection,
        concurrency,
      },
    );

    worker.on('completed', async (job, result) => {
      logger.info({ queue: queueName, jobId: job.id }, 'job completed');
      const tenantId = job.data?.tenantId;
      if (tenantId) {
        await withStudioTenant(tenantId, async (db) => {
          await db.job.updateMany({
            where: { bullJobId: job.id },
            data: {
              status: 'completed',
              result: result as any,
              endedAt: new Date(),
            },
          });
        }).catch(() => {});
      }
    });

    worker.on('failed', async (job, err) => {
      logger.error({ queue: queueName, jobId: job?.id, err: err.message }, 'job failed');
      const tenantId = job?.data?.tenantId;
      if (tenantId && job) {
        await withStudioTenant(tenantId, async (db) => {
          await db.job.updateMany({
            where: { bullJobId: job.id },
            data: {
              status: 'failed',
              error: err.message.slice(0, 2000),
              endedAt: new Date(),
            },
          });
        }).catch(() => {});
      }
    });

    workers.push(worker);
    logger.info({ queue: queueName, concurrency }, 'registered studio worker queue');
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down studio-worker');
    await Promise.all(workers.map((w) => w.close()));
    connection.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
