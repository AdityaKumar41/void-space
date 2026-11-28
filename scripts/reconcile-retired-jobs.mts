/** Retain job history while resolving orphaned or retired work. Dry-run unless --apply. */
import { loadRootEnv, REPO_ROOT } from '../packages/db/src/env';
import { PrismaClient } from '../packages/db/generated/client/index.js';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
loadRootEnv();
process.chdir(REPO_ROOT);
const require = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queues = new Map();
const apply = process.argv.includes('--apply');
let repaired = 0,
  skippedActive = 0;
try {
  const candidates = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT j.id FROM jobs j
    WHERE j.status IN ('queued','active','delayed') AND (
      j.queue IN ('blender_optimize','xr_publish','skill_credential') OR
      (j.queue='learning' AND j.entity_type='learning_task' AND NOT EXISTS (SELECT 1 FROM learning_tasks t WHERE t.id::text=j.entity_id)) OR
      (j.queue='ipfs_pin' AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id::text=j.entity_id)
       AND NOT EXISTS (SELECT 1 FROM asset_versions v WHERE v.id::text=j.entity_id)))`);
  const rows = await db.job.findMany({ where: { id: { in: candidates.map((c) => c.id) } } });
  if (apply && rows.length) {
    await mkdir('.audit/backups', { recursive: true, mode: 0o700 });
    await writeFile(
      `.audit/backups/jobs-before-reconcile-${Date.now()}.json`,
      JSON.stringify(rows, null, 2),
      { mode: 0o600, flag: 'wx' },
    );
  }
  for (const row of rows) {
    const name = row.queue.replace(/_/g, '-');
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection });
      queues.set(name, queue);
    }
    const job = await queue.getJob(row.id);
    if (job && (await job.getState()) === 'active') {
      skippedActive++;
      continue;
    }
    if (!apply) continue;
    // A retired/missing subject cannot produce a valid completion. Never delete the job history.
    if (job) await job.remove();
    await db.$transaction(async (tx) => {
      const changed = await tx.job.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error:
            'Maintenance: workflow retired or referenced subject no longer exists. Original history retained.',
        },
      });
      if (changed.count) {
        await tx.auditLog.create({
          data: {
            tenantId: row.tenantId,
            action: 'job.reconciled',
            entityType: 'job',
            entityId: row.id,
            actorLabel: 'maintenance:cleanup',
            beforeState: { status: row.status, queue: row.queue },
            afterState: { status: 'failed', reason: 'retired_or_missing_subject' },
          },
        });
        repaired++;
      }
    });
  }
  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      candidates: rows.length,
      repaired,
      skippedActive,
      historyDeleted: false,
    }),
  );
} finally {
  await Promise.all([...queues.values()].map((q) => q.close()));
  await connection.quit();
  await db.$disconnect();
}
