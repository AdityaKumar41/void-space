#!/usr/bin/env node
/** Start Void Space's web, API, background worker and configured learning runtime. */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(rootDir, '.env');
const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
function setting(name, fallback = '') {
  return (
    process.env[name] ??
    envText.match(new RegExp(`^${name}=["']?([^\\s"']+)`, 'm'))?.[1] ??
    fallback
  );
}
function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: Number(port), host }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}
const ready = await Promise.all([
  checkPort(setting('POSTGRES_PORT', '5432')),
  checkPort(setting('REDIS_PORT', '6379')),
]);
if (ready.some((value) => !value)) {
  const up = spawnSync('bash', ['scripts/dev-up.sh'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (up.status !== 0)
    throw new Error('Void Space infrastructure could not start. Check Docker and run pnpm dev:up.');
}
const endpoint = setting('S3_ENDPOINT');
if (endpoint && fs.existsSync(path.join(rootDir, '.env.storage.local'))) {
  const url = new URL(endpoint);
  if (
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.port === '9000' &&
    !(await checkPort(9000))
  ) {
    const storage = spawnSync(
      'docker',
      ['compose', '-f', 'docker-compose.storage.yml', 'up', '-d', '--wait', '--wait-timeout', '60'],
      { cwd: rootDir, stdio: 'inherit', env: process.env },
    );
    if (storage.status !== 0)
      throw new Error('Private object storage could not start. Check Docker before uploading.');
  }
}
const children = [];
let stopping = false;
function launch(label, args) {
  const child = spawn('pnpm', args, {
    cwd: rootDir,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  });
  children.push(child);
  for (const [stream, output] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    readline
      .createInterface({ input: stream })
      .on('line', (line) => output.write(`[${label}] ${line}\n`));
  }
  child.on('error', (error) => {
    console.error(`[${label}] ${error.message}`);
    cleanup(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[${label}] exited (${code}).`);
      cleanup(code || 1);
    }
  });
}
function cleanup(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 1000);
}
process.on('SIGINT', () => cleanup());
process.on('SIGTERM', () => cleanup());
if (setting('LEARNING_AGENT_ENGINE') === 'inngest' && !(await checkPort(8288)))
  launch('learning', ['--filter', '@void-space/worker', 'learning:dev']);
for (const [name, port] of [
  ['web', 3000],
  ['api', Number(setting('API_PORT', '4000'))],
  ['worker', Number(setting('LEARNING_HARNESS_PORT', '4030'))],
]) {
  if (await checkPort(port, 'localhost')) console.log(`[dev] Reusing ${name} on :${port}.`);
  else launch(name, ['--filter', `@void-space/${name}`, 'dev']);
}
console.log('Void Space: http://localhost:3000 · API: http://localhost:4000');
