import { textAiEnvSchema } from '@void-space/ai/text';
/** Active workers: asset storage, metadata enrichment, learning, licensing and notifications.
 * Durable agent turns use Inngest; file and asset jobs use BullMQ.
 */
import { QUEUE_NAMES, type QueueName } from '@void-space/types';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { withTenant } from '@void-space/db';
import { dispatchLearningRun, startLearningDurableRuntime } from './learning/durable';
import { createWorkerProducer } from './lib/producer';
import { createAiEnrichmentProcessor } from './processors/ai-enrichment';
import { createAssetStoreProcessor } from './processors/asset-store';
import { createChainLicenseProcessor } from './processors/chain-license';
import { createLearningProcessor } from './processors/learning';
import { createNotifyProcessor } from './processors/notify';
import { concurrencyFor, createQueueRegistry, jobOptionsFor } from './queues';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
      : undefined,
});

type Processor = (job: never) => Promise<unknown>;

/** Queues whose processors are implemented; the rest log and complete. */
const PROCESSORS: Partial<Record<QueueName, Processor>> = {};

export async function main(): Promise<void> {
  const configuredRpcUrl = process.env.CHAIN_RPC_URL?.trim();
  const chainRpcUrl = configuredRpcUrl || 'http://localhost:8545';
  const chainId = configuredRpcUrl ? Number(process.env.CHAIN_ID || 43113) : 31337;
  const chainEnabled = Boolean(
    configuredRpcUrl &&
    chainId === 43113 &&
    process.env.CONTRACT_ADDRESS?.trim() &&
    process.env.PLATFORM_SIGNER_SEED?.trim(),
  );
  if (![31337, 43113].includes(chainId)) {
    throw new Error(
      `[worker] CHAIN_ID must be 31337 (local Anvil) or 43113 (Avalanche Fuji), received ${chainId}`,
    );
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('[worker] REDIS_URL is not set — copy .env.example to .env (SRS §9.4)');
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (error) => logger.error({ err: error }, 'redis connection error'));

  await connection.ping();
  logger.info({ redis: redisUrl.replace(/\/\/.*@/, '//') }, 'redis connected');

  const registry = createQueueRegistry(connection);

  // The worker also produces a little: a completed mint queues the EoN push and the
  // Creator's notification. One producer per process, sharing the Redis connection.
  const producer = createWorkerProducer(connection);

  PROCESSORS['asset-store'] = createAssetStoreProcessor({
    logger,
  }) as Processor;

  PROCESSORS['ai-enrichment'] = createAiEnrichmentProcessor({
    textAi: textAiEnvSchema.parse(process.env),
    logger,
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929',
    timeoutMs: Number.parseInt(process.env.ANTHROPIC_TIMEOUT_MS ?? '30000', 10),
  }) as Processor;

  const learningProcessor = createLearningProcessor({
    textAi: textAiEnvSchema.parse(process.env),
    stagingDir: process.env.STAGING_DIR ?? '.staging',
  });
  const harness =
    process.env.LEARNING_AGENT_ENGINE === 'inngest'
      ? startLearningDurableRuntime(
          textAiEnvSchema.parse(process.env),
          process.env.STAGING_DIR ?? '.staging',
        )
      : undefined;
  PROCESSORS.learning = (async (
    job: import('bullmq').Job<{ tenantId: string; taskId: string }>,
  ) => {
    const run = await withTenant(job.data.tenantId, (db) =>
      db.learningAgentRun.findUnique({ where: { id: job.data.taskId } }),
    );
    if (run?.engine === 'inngest') {
      if (run.cancelledAt) return { cancelled: true };
      try {
        if (!harness) throw new Error('Enable LEARNING_AGENT_ENGINE=inngest to serve this run.');
        return await dispatchLearningRun({ ...job.data, ownerId: run.ownerId });
      } catch (error) {
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 2)) {
          const message =
            'The local learning agent is unavailable. Start pnpm learning:dev and retry from your saved conversation.';
          await withTenant(job.data.tenantId, async (db) => {
            const changed = await db.learningTask.updateMany({
              where: { id: run.id, status: { in: ['queued', 'active'] } },
              data: { status: 'failed', error: message },
            });
            if (changed.count)
              await db.job.updateMany({
                where: { id: run.id },
                data: { status: 'failed', error: message, finishedAt: new Date() },
              });
          });
        }
        throw error;
      }
    }
    return learningProcessor(job);
  }) as Processor;

  PROCESSORS['notify'] = createNotifyProcessor({ logger }) as Processor;

  if (chainEnabled) {
    PROCESSORS['chain-license'] = createChainLicenseProcessor({
      logger,
      rpcUrl: chainRpcUrl,
      chainId,
      contractAddress: process.env.CONTRACT_ADDRESS!,
      privateKey: process.env.PLATFORM_SIGNER_SEED!,
      producer,
    }) as Processor;
  } else {
    logger.warn(
      'chain-license processor is disabled: configure an Avalanche Fuji RPC, contract address and publisher key; queued licensing jobs will remain pending',
    );
  }

  // FR-6.3 — the headless Blender queue. `runnerUrl` unset is a supported state, not a
  // misconfiguration: the processor records a labelled simulation so the pipeline stays visible
  // without the ~1 GB image. See the processor's header for why that is preferable to failing.

  const workers: Worker[] = [];

  for (const name of QUEUE_NAMES) {
    // Do not consume licensing jobs as no-ops without a deployed contract and signer. Keeping them
    // queued makes local app functionality available while preserving work for later activation.
    if (name === 'chain-license' && !chainEnabled) continue;

    const processor = PROCESSORS[name];
    const worker = new Worker(
      name,
      processor
        ? (job) => processor(job as never)
        : async (job) => {
            logger.warn(
              { queue: name, jobId: job.id },
              'no processor is attached to this queue yet — the job is completed as a no-op',
            );
            return { skipped: true };
          },
      {
        connection,
        concurrency: concurrencyFor(name),
        ...(processor ? {} : {}),
      },
    );

    worker.on('failed', (job, error) => {
      logger.error(
        { queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: error },
        'job failed',
      );
    });
    worker.on('completed', (job) => {
      logger.debug({ queue: name, jobId: job.id }, 'job completed');
    });

    workers.push(worker);
  }

  logger.info(
    {
      queues: QUEUE_NAMES.map((name) => ({
        name,
        attempts: jobOptionsFor(name).attempts,
        concurrency: concurrencyFor(name),
        implemented: name in PROCESSORS,
      })),
    },
    'worker ready',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down`);
    await Promise.all(workers.map((worker) => worker.close()));
    if (harness)
      await new Promise<void>((resolve, reject) =>
        harness.close((error) => (error ? reject(error) : resolve())),
      );
    await producer.close();
    await registry.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
