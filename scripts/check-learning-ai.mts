/** Live end-to-end AI check using only an identified demo fixture and public source text. */
import { loadRootEnv } from '../packages/db/src/env';
loadRootEnv({ override: false });
const { loadEnv } = await import('../apps/api/src/env');
const { buildApp } = await import('../apps/api/src/app');
const { withTenant } = await import('../packages/db/src/index');
const app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'error' }));
let lessonId: string | undefined;
let tenantId: string | undefined;
try {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'creator@aurora.dev', password: 'VoidSpace!2026' },
  });
  if (login.statusCode !== 200) throw new Error('Local demo login failed');
  const rawCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(rawCookie) ? rawCookie : [rawCookie ?? ''])
    .map((value) => value.split(';')[0])
    .join('; ');
  const assetResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/lessons/assets',
    headers: { cookie },
  });
  const asset = assetResponse
    .json()
    .assets.find((a: { name: string }) => a.name === 'Cordless Impact Drill');
  if (!asset) throw new Error('Seeded reviewed drill asset is required');
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/lessons',
    headers: { cookie },
    payload: {
      assetId: asset.id,
      title: 'AI integration smoke fixture',
      generateWithAi: true,
      sourceText:
        'This cordless drill has a battery pack that supplies power, a trigger that controls operation, and a keyless chuck that holds the bit. Identify these three components on the model. This lesson is about component identification only.',
    },
  });
  if (created.statusCode !== 201)
    throw new Error(`Lesson generation returned HTTP ${created.statusCode}`);
  const body = created.json();
  lessonId = body.lesson.id;
  const { demoId } = await import('../packages/db/src/demo-ids');
  tenantId = demoId('tenant:aurora');
  if (body.generation.mode !== 'ai')
    throw new Error('Provider did not return a valid lesson; a labelled template was created');
  console.log(
    JSON.stringify({
      ok: true,
      generation: body.generation,
      questions: body.lesson.questions.length,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Learning AI check failed');
  process.exitCode = 1;
} finally {
  if (lessonId) {
    const { demoId } = await import('../packages/db/src/demo-ids');
    await withTenant(tenantId ?? demoId('tenant:aurora'), (db) =>
      db.lesson.deleteMany({ where: { id: lessonId } }),
    );
  }
  await app.close();
  const { disconnectAll } = await import('../packages/db/src/client');
  await disconnectAll();
}
