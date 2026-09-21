/**
 * Worker entry point (SRS §3.10).
 *
 * Phase 0 establishes the process, the Redis connection and the queue registry
 * with the documented retry policies. The individual processors are attached in
 * Phase 5 (ai-enrichment, ipfs-pin, blender-optimize, chain-license, xr-publish,
 * notify) — see `src/queues.ts` for the contracts they must honour.
 */
import { loadRootEnv } from '@void-space/db/env';
import { QUEUE_NAMES } from '@void-space/types';
import IORedis from 'ioredis';
import pino from 'pino';

import { concurrencyFor, createQueueRegistry, jobOptionsFor } from './queues';

loadRootEnv();

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
      : undefined,
});

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('[worker] REDIS_URL is not set — copy .env.example to .env (SRS §9.4)');
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (error) => logger.error({ err: error }, 'redis connection error'));

  await connection.ping();
  logger.info({ redis: redisUrl.replace(/\/\/.*@/, '//') }, 'redis connected');

  const registry = createQueueRegistry(connection);

  logger.info(
    {
      queues: QUEUE_NAMES.map((name) => ({
        name,
        attempts: jobOptionsFor(name).attempts,
        policy: concurrencyFor(name),
      })),
    },
    'queue registry ready — processors are attached in Phase 5',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down`);
    await registry.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'worker failed to start');
  process.exit(1);
});
