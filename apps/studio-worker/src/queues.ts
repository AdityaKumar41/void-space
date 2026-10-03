/**
 * VOID·STUDIO asynchronous job contracts (VS2-SRS-1.0 §3.1, §7.5).
 *
 * All non-trivial or slow operations run through BullMQ workers so the API stays
 * fast and non-blocking:
 * - publish: Handoff to VOID·SPACE API with gate validation and status tracking
 * - generative: Meshy AI 3D mesh / texture generation
 * - csg: Boolean geometry offload (union, subtract, intersect)
 * - export: GLB / USDZ / OBJ conversion and packing
 * - autosave: Cloud project snapshots with 50-version retention pruning
 * - copilot: Extended multi-turn AI reasoning offload
 */
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';

export const STUDIO_QUEUE_NAMES = [
  'publish',
  'generative',
  'csg',
  'export',
  'autosave',
  'copilot',
] as const;

export type StudioQueueName = (typeof STUDIO_QUEUE_NAMES)[number];

export interface StudioQueuePolicy {
  readonly name: StudioQueueName;
  readonly attempts: number;
  readonly backoff: { readonly type: 'exponential' | 'fixed'; readonly delayMs: number };
  readonly defaultConcurrency: number;
  readonly description: string;
}

export const STUDIO_QUEUE_POLICIES: Readonly<Record<StudioQueueName, StudioQueuePolicy>> = {
  publish: {
    name: 'publish',
    attempts: 3,
    backoff: { type: 'exponential', delayMs: 2_000 },
    defaultConcurrency: 2,
    description: 'Async VOID·SPACE asset publish handoff with gate validation',
  },
  generative: {
    name: 'generative',
    attempts: 2,
    backoff: { type: 'fixed', delayMs: 3_000 },
    defaultConcurrency: 2,
    description: 'Meshy AI text-to-3D mesh and texture generation',
  },
  csg: {
    name: 'csg',
    attempts: 2,
    backoff: { type: 'fixed', delayMs: 1_000 },
    defaultConcurrency: 4,
    description: 'Constructive Solid Geometry boolean mesh operations',
  },
  export: {
    name: 'export',
    attempts: 2,
    backoff: { type: 'exponential', delayMs: 2_000 },
    defaultConcurrency: 2,
    description: 'Format conversion and GLB export packing',
  },
  autosave: {
    name: 'autosave',
    attempts: 2,
    backoff: { type: 'fixed', delayMs: 1_000 },
    defaultConcurrency: 5,
    description: 'Project version snapshots and retention pruning (max 50)',
  },
  copilot: {
    name: 'copilot',
    attempts: 1,
    backoff: { type: 'fixed', delayMs: 1_000 },
    defaultConcurrency: 2,
    description: 'Extended AI Copilot reasoning and multi-step plan execution',
  },
};

export function studioConcurrencyFor(queue: StudioQueueName): number {
  const envVar = `STUDIO_CONCURRENCY_${queue.toUpperCase()}`;
  const raw = process.env[envVar];
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return STUDIO_QUEUE_POLICIES[queue].defaultConcurrency;
}

export function studioJobOptionsFor(queue: StudioQueueName) {
  const policy = STUDIO_QUEUE_POLICIES[queue];
  return {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: 100,
    removeOnFail: 200,
  };
}

export type StudioQueueRegistry = Readonly<Record<StudioQueueName, Queue>>;

export function createStudioQueueRegistry(connection: ConnectionOptions): StudioQueueRegistry {
  const queues = {} as Record<StudioQueueName, Queue>;
  for (const name of STUDIO_QUEUE_NAMES) {
    queues[name] = new Queue(name, {
      connection,
      defaultJobOptions: studioJobOptionsFor(name),
    });
  }
  return Object.freeze(queues);
}
