/** Offline deployment configuration check. Prints field names and findings, never values. */
import { readFileSync } from 'node:fs';
const index = process.argv.indexOf('--env-file');
const filename = index >= 0 ? process.argv[index + 1] : '.env.production';
if (!filename) throw new Error('--env-file requires a path');
let file;
try {
  file = readFileSync(filename, 'utf8');
} catch {
  console.error(`Missing ${filename}. Prepare it from .env.production.example.`);
  process.exit(1);
}
const env = {};
for (const line of file.split('\n')) {
  const match = line.trim().match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();
}
const issues = [],
  disabled = [];
const required = (key) => {
  if (!env[key] || /REPLACE|example\.com/i.test(env[key])) {
    issues.push(`${key}: supply a production value`);
    return false;
  }
  return true;
};
for (const key of [
  'DATABASE_URL',
  'PLATFORM_DATABASE_URL',
  'MIGRATE_DATABASE_URL',
  'REDIS_URL',
  'S3_BUCKET',
  'PUBLIC_WEB_ORIGIN',
  'CORS_ORIGINS',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
])
  required(key);
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])
  if ((env[key]?.length ?? 0) < 32 || /dev-only|change-me/i.test(env[key] ?? ''))
    issues.push(`${key}: use at least 32 random characters`);
if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET)
  issues.push('JWT secrets: use independent secrets');
if (env.COOKIE_SECURE !== 'true') issues.push('COOKIE_SECURE: must be true');
for (const key of ['PUBLIC_WEB_ORIGIN', 'SKETCHFAB_REDIRECT_URI', 'GOOGLE_REDIRECT_URI']) {
  if (!env[key]) continue;
  try {
    const u = new URL(env[key]);
    if (u.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname))
      throw new Error();
  } catch {
    issues.push(`${key}: requires a public HTTPS URL`);
  }
}
for (const origin of (env.CORS_ORIGINS ?? '').split(',')) {
  try {
    if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error();
  } catch {
    issues.push('CORS_ORIGINS: use explicit HTTPS origins');
  }
}
if (env.PUBLIC_WEB_ORIGIN && !(env.CORS_ORIGINS ?? '').split(',').includes(env.PUBLIC_WEB_ORIGIN))
  issues.push('CORS_ORIGINS: include PUBLIC_WEB_ORIGIN');
try {
  const users = ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'MIGRATE_DATABASE_URL'].map(
    (k) => new URL(env[k]).username,
  );
  if (users[0] !== 'void_app' || users[1] !== 'void_platform')
    issues.push('Database runtime roles must be void_app and void_platform');
  if (new Set(users).size !== 3)
    issues.push('Database roles: runtime, platform and migration users must be different');
} catch {
  issues.push('Database URLs: invalid or missing URL');
}
for (const [prefix, callback] of [
  ['SKETCHFAB', 'SKETCHFAB_REDIRECT_URI'],
  ['GOOGLE', 'GOOGLE_REDIRECT_URI'],
]) {
  const enabled = env[`${prefix}_CLIENT_ID`] || env[`${prefix}_CLIENT_SECRET`];
  if (enabled && (!env[`${prefix}_CLIENT_ID`] || !env[`${prefix}_CLIENT_SECRET`] || !env[callback]))
    issues.push(`${prefix}: configure the complete OAuth application and callback`);
  if (!enabled) disabled.push(`${prefix} OAuth`);
}
if (
  env.LEARNING_AGENT_ENGINE === 'inngest' &&
  (!env.INNGEST_EVENT_KEY || !env.INNGEST_SIGNING_KEY || !env.INNGEST_BASE_URL)
)
  issues.push('Inngest: configure production base URL, signing key and event key');
if (env.LEARNING_AGENT_ENGINE && !['bullmq', 'inngest'].includes(env.LEARNING_AGENT_ENGINE))
  issues.push('LEARNING_AGENT_ENGINE: use bullmq or inngest');
if (!env.AI_TEXT_BASE_URL && !env.AI_BASE_URL && !env.OPENROUTER_API_KEY)
  issues.push('Text AI: configure a provider before offering agent generation');
if (!env.CONTRACT_ADDRESS || !env.CHAIN_RPC_URL) disabled.push('On-chain publishing');
if (env.CONTRACT_ADDRESS && !env.CHAIN_RPC_URL)
  issues.push('Chain publishing: supply CHAIN_RPC_URL or leave CONTRACT_ADDRESS empty');
if (env.AI_IMAGE_ENABLED !== 'true') disabled.push('Image generation');
console.log(
  JSON.stringify(
    {
      ready: issues.length === 0,
      issues,
      disabled,
      checks:
        'Configuration only; verify service health, migrations, RLS, callbacks and browser journeys on the target host.',
    },
    null,
    2,
  ),
);
process.exitCode = issues.length ? 1 : 0;
