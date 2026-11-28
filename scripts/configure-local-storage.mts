import { randomBytes } from 'node:crypto';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const filename = resolve(root, '.env.storage.local');
let values: Record<string, string>;
try {
  values = Object.fromEntries(
    (await readFile(filename, 'utf8'))
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  values = {
    MINIO_ROOT_USER: 'void-local-' + randomBytes(8).toString('hex'),
    MINIO_ROOT_PASSWORD: randomBytes(32).toString('hex'),
  };
  await writeFile(
    filename,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
    { mode: 0o600, flag: 'wx' },
  );
}
const envPath = resolve(root, '.env');
const current = await readFile(envPath, 'utf8');
if (/^S3_BUCKET=\S+/m.test(current))
  throw new Error('Existing S3 configuration found. It was not overwritten.');
const config = {
  S3_BUCKET: 'void-private',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: values.MINIO_ROOT_USER!,
  S3_SECRET_ACCESS_KEY: values.MINIO_ROOT_PASSWORD!,
  S3_FORCE_PATH_STYLE: 'true',
};
await appendFile(
  envPath,
  '\n# Local private object storage\n' +
    Object.entries(config)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n',
  { mode: 0o600 },
);
process.stdout.write(
  'Local storage credentials configured in ignored server files. Restart API and worker after the storage health check succeeds.\n',
);
