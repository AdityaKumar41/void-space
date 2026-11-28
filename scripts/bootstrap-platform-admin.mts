import { loadRootEnv } from '../packages/db/src/env';
loadRootEnv();
const { withPlatform, disconnectAll } = await import('../packages/db/src/index');
const userId = process.argv[process.argv.indexOf('--user-id') + 1];
const email = process.argv[process.argv.indexOf('--confirm-email') + 1];
if (
  !process.argv.includes('--user-id') ||
  !process.argv.includes('--confirm-email') ||
  !/^[a-f0-9-]{36}$/i.test(userId ?? '') ||
  !email?.includes('@')
) {
  throw new Error(
    'Usage: tsx scripts/bootstrap-platform-admin.mts --user-id <existing UUID> --confirm-email <exact account email>',
  );
}
try {
  await withPlatform((db) =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(78261342)::text`;
      if (await tx.platformAccess.count({ where: { role: 'PlatformAdmin', revokedAt: null } }))
        throw new Error(
          'An administrator already exists. Use the MFA-protected console to grant access.',
        );
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.status !== 'active' || user.email !== email)
        throw new Error(
          'The exact active account and confirmation email must match. No grants were changed.',
        );
      await tx.platformAccess.upsert({
        where: { userId },
        create: { userId, role: 'PlatformAdmin' },
        update: { role: 'PlatformAdmin', revokedAt: null },
      });
      await tx.platformEvent.create({
        data: { actorId: userId, action: 'platform.bootstrap', targetId: userId },
      });
    }),
  );
  process.stdout.write(
    'Platform access granted. Sign in as that account and enroll an authenticator in Platform administration.\n',
  );
} finally {
  await disconnectAll();
}
