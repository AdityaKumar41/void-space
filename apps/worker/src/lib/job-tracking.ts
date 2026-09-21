/**
 * Job bookkeeping (SRS FR-11.2, FR-11.3, §3.10).
 *
 * The API mirrors every job into the `jobs` table; the worker owns its lifecycle from
 * there. Wrapping a processor in `trackJob` gives one place where `status`, `attempts`,
 * `startedAt`, `finishedAt`, `error` and `result` are kept truthful — and where a
 * terminal failure is distinguished from a retry (which is what the UI needs to say
 * "failed, will retry" versus "failed, needs attention").
 */
import { withTenant, type Prisma } from '@void-space/db';
import type { QueueName } from '@void-space/types';

export interface JobPayload {
  readonly assetId?: string;
  readonly versionId?: string;
  readonly [key: string]: unknown;
}

export interface JobContext {
  readonly jobId: string;
  readonly tenantId: string;
  /** The queue this job came from, kept for structured logging. */
  readonly queue: QueueName;
  readonly payload: JobPayload;
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Marks this attempt as active and bumps the attempt counter. */
  markActive(): Promise<void>;
  /** Records a successful outcome. */
  succeed(result: Record<string, unknown>): Promise<void>;
  /**
   * Records a failed attempt. `terminal` is true on the last attempt, which is when the
   * DB row stops saying "retrying" and the domain state is marked failed.
   */
  fail(error: unknown, terminal: boolean): Promise<void>;
}

/** The `jobs.queue` enum value for a queue name. */
export function jobQueueEnum(queue: QueueName): Prisma.JobCreateInput['queue'] {
  return queue.replace(/-/g, '_') as Prisma.JobCreateInput['queue'];
}

export interface TrackJobParams {
  readonly jobId: string;
  readonly tenantId: string;
  readonly queue: QueueName;
  readonly payload: JobPayload;
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * Builds a tracking context for one job attempt. Every write is tenant-scoped, so a job
 * cannot touch another tenant's rows even if its payload were tampered with.
 */
export function createJobContext(params: TrackJobParams): JobContext {
  const { jobId, tenantId } = params;

  async function update(data: Prisma.JobUpdateInput): Promise<void> {
    await withTenant(tenantId, (db) => db.job.update({ where: { id: jobId }, data }));
  }

  return {
    ...params,
    async markActive() {
      await update({
        status: 'active',
        attempts: params.attempt,
        startedAt: new Date(),
        error: null,
      });
    },
    async succeed(result) {
      await update({
        status: 'completed',
        result: result as Prisma.InputJsonValue,
        finishedAt: new Date(),
        error: null,
        attempts: params.attempt,
      });
    },
    async fail(error, terminal) {
      await update({
        status: terminal ? 'failed' : 'delayed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
        attempts: params.attempt,
        finishedAt: terminal ? new Date() : null,
      });
    },
  };
}

/** Attempt number for a BullMQ job (1-based, matching the §3.10 "1 initial run" wording). */
export function attemptOf(job: { attemptsMade: number }): number {
  return job.attemptsMade + 1;
}
