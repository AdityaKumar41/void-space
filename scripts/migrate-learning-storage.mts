import { loadRootEnv } from '../packages/db/src/env';
loadRootEnv();
const { withPlatform, withTenant, readLearningFile, writeLearningFile, disconnectAll } =
  await import('../packages/db/src/index');
const { checksum } = await import('../packages/storage/src/index');
const apply = process.argv.includes('--apply');
if (!process.env.S3_BUCKET)
  throw new Error('Configure and test S3_BUCKET before migration. Existing files are unchanged.');
let migrated = 0,
  skipped = 0,
  failed = 0;
try {
  const tenants = await withPlatform((db) => db.tenant.findMany({ select: { id: true } }));
  for (const tenant of tenants) {
    let cursor: string | undefined;
    for (;;) {
      const sources = await withTenant(tenant.id, (db) =>
        db.learningSource.findMany({
          where: { storagePath: { not: null } },
          orderBy: { id: 'asc' },
          take: 100,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, storagePath: true, mime: true },
        }),
      );
      if (!sources.length) break;
      for (const source of sources) {
        cursor = source.id;
        if (!source.storagePath || source.storagePath.startsWith('s3://')) {
          skipped++;
          continue;
        }
        if (!apply) {
          process.stdout.write(
            JSON.stringify({ id: source.id, tenantId: tenant.id, action: 'would-copy' }) + '\n',
          );
          continue;
        }
        try {
          const bytes = await readLearningFile(source.storagePath);
          const path = await writeLearningFile(source.storagePath, bytes, undefined, source.mime);
          const copied = await readLearningFile(path);
          if (checksum(copied) !== checksum(bytes) || copied.length !== bytes.length)
            throw new Error('Copied bytes failed integrity verification');
          const result = await withTenant(tenant.id, (db) =>
            db.learningSource.updateMany({
              where: { id: source.id, storagePath: source.storagePath },
              data: { storagePath: path },
            }),
          );
          if (result.count) migrated++;
          else skipped++;
        } catch (error) {
          failed++;
          process.stderr.write(
            JSON.stringify({ id: source.id, error: (error as Error).message }) + '\n',
          );
        }
      }
    }
  }
  process.stdout.write(
    JSON.stringify({ applied: apply, migrated, skipped, failed, originalsRetained: true }) + '\n',
  );
  if (failed) process.exitCode = 1;
} finally {
  await disconnectAll();
}
