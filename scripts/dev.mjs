#!/usr/bin/env node

/**
 * Unified Development Platform Runner (SRS §9.1, §9.2).
 *
 * Concurrently orchestrates and streams all 5 platform services:
 * 1. VOID·SPACE Web Console:       http://localhost:3000
 * 2. VOID·SPACE Core API:          http://localhost:4000
 * 3. VOID·SPACE Background Worker: BullMQ + AI + IPFS + Smart Contract
 * 4. VOID·STUDIO Control API:      http://localhost:4100
 * 5. VOID·STUDIO WebGPU 3D Editor: http://localhost:5007
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const studioWebDir = path.resolve(rootDir, 'apps/studio-web');

function configuredPort(name, fallback) {
  if (process.env[name]) return Number(process.env[name]);
  try {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = fs
      .readFileSync(path.join(rootDir, '.env'), 'utf8')
      .match(new RegExp(`^${escapedName}=(?:['\"])?(\\d+)`, 'm'));
    return match ? Number(match[1]) : fallback;
  } catch {
    return fallback;
  }
}

function checkPort(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function prepareEnvironment() {
  // 1. Check if studio-web needs build
  const studioEntryPoint = path.resolve(studioWebDir, 'build/entry_point.js');
  if (!fs.existsSync(studioEntryPoint)) {
    const sculptcoreBrowserJs = path.resolve(
      studioWebDir,
      'sculptcore/typescript/build/sculptcore-browser.js',
    );
    const sculptcoreBrowserWasm = path.resolve(
      studioWebDir,
      'sculptcore/typescript/build/sculptcore-browser.wasm',
    );

    if (!fs.existsSync(sculptcoreBrowserJs) || !fs.existsSync(sculptcoreBrowserWasm)) {
      console.warn(
        '\x1b[1;33m[dev:warn]\x1b[0m VOID·STUDIO Web build skipped: SculptCore browser artifacts are missing. ' +
          'Run `pnpm studio:fork:setup` once, then `pnpm studio:fork:build`.',
      );
    } else {
      console.log(
        '\x1b[1;36m[dev:setup]\x1b[0m Building VOID·STUDIO Web bundle (build/entry_point.js)...',
      );
      const studioBuild = spawnSync('pnpm', ['--dir', 'apps/studio-web', 'build'], {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env,
      });
      if (studioBuild.status !== 0) {
        console.warn(
          '\x1b[1;33m[dev:warn]\x1b[0m VOID·STUDIO Web build failed; the terminal dashboard and backend services will continue.',
        );
      }
    }
  }

  // 2. Check if backing data services are accessible. The workers depend on Redis too;
  // checking only PostgreSQL lets `pnpm dev` start successfully while both workers
  // repeatedly report ECONNREFUSED when Redis is the service that is down.
  const [pgSpace, pgStudio, redisSpace, redisStudio] = await Promise.all([
    checkPort(configuredPort('POSTGRES_PORT', 5432)),
    checkPort(5433),
    checkPort(configuredPort('REDIS_PORT', 6379)),
    checkPort(6380),
  ]);

  if (!pgSpace || !pgStudio || !redisSpace || !redisStudio) {
    const unavailable = [
      !pgSpace && 'PostgreSQL 5432',
      !pgStudio && 'Studio PostgreSQL 5433',
      !redisSpace && 'Redis 6379',
      !redisStudio && 'Studio Redis 6380',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(
      `\x1b[1;33m[dev:info]\x1b[0m Required data services are not responding: ${unavailable}.`,
    );
    console.log(
      '\x1b[1;36m[dev:info]\x1b[0m Attempting to start containers via scripts/dev-up.sh...\n',
    );
    try {
      const up = spawnSync('bash', ['scripts/dev-up.sh'], {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env,
      });
      if (up.status !== 0) {
        console.warn(
          '\n\x1b[1;33m[dev:warn]\x1b[0m dev-up.sh encountered an issue (is Docker running?).',
        );
        console.warn(
          '\x1b[1;33m[dev:warn]\x1b[0m Ensure Docker Desktop is active and run `pnpm dev:up` if services fail to connect.\n',
        );
      }
    } catch (err) {
      console.warn(
        '\x1b[1;33m[dev:warn]\x1b[0m Could not invoke scripts/dev-up.sh automatically:',
        err.message,
      );
    }
  }

  // This runner serves web/API natively. The same .env is also used by `stack:up`, where those
  // upstreams are Compose service names, so always reconcile only the edge proxy with host routes.
  const edge = spawnSync(
    'docker',
    ['compose', '--profile', 'infra', '--profile', 'edge', 'up', '-d', 'nginx'],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        EDGE_WEB_UPSTREAM: 'host.docker.internal:3000',
        EDGE_API_UPSTREAM: 'host.docker.internal:4000',
      },
    },
  );
  if (edge.status !== 0) {
    console.warn(
      '\x1b[1;33m[dev:warn]\x1b[0m Could not reconcile nginx for native app servers; direct localhost ports remain available.',
    );
  }

  const studioEdge = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.studio.yml', 'up', '-d', '--force-recreate', 'studio-nginx'],
    { cwd: rootDir, stdio: 'inherit', env: process.env },
  );
  if (studioEdge.status !== 0) {
    console.warn('\x1b[1;33m[dev:warn]\x1b[0m Could not refresh the VOID·STUDIO edge proxy.');
  }
}

function printBanner() {
  console.log(
    '\x1b[1;36m╔════════════════════════════════════════════════════════════════════════════════════════╗\x1b[0m',
  );
  console.log(
    '\x1b[1;36m║\x1b[0m                      \x1b[1;37mVOID·SPACE & VOID·STUDIO UNIFIED PLATFORM\x1b[0m                         \x1b[1;36m║\x1b[0m',
  );
  console.log(
    '\x1b[1;36m╠════════════════════════════════════════════════════════════════════════════════════════╣\x1b[0m',
  );
  console.log(
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m[1] VOID·SPACE Web:\x1b[0m      \x1b[4;37mhttp://localhost:3000\x1b[0m   (Operations Console & Marketplace)    \x1b[1;36m║\x1b[0m',
  );
  console.log(
    '\x1b[1;32m║\x1b[0m  \x1b[1;32m[2] VOID·SPACE API:\x1b[0m      \x1b[4;37mhttp://localhost:4000\x1b[0m   (Core REST API & Docs /docs)          \x1b[1;36m║\x1b[0m',
  );
  console.log(
    '\x1b[1;34m║\x1b[0m  \x1b[1;34m[3] VOID·SPACE Worker:\x1b[0m   Running                 (BullMQ, IPFS, AI, Chain License)     \x1b[1;36m║\x1b[0m',
  );
  console.log(
    '\x1b[1;33m║\x1b[0m  \x1b[1;33m[4] VOID·STUDIO Web:\x1b[0m     \x1b[4;37mhttp://localhost:5007\x1b[0m   (WebGPU 3D Studio Editor)             \x1b[1;36m║\x1b[0m',
  );
  console.log(
    '\x1b[1;35m║\x1b[0m  \x1b[1;35m[5] VOID·STUDIO API:\x1b[0m     \x1b[4;37mhttp://localhost:4100\x1b[0m   (Studio API /studio/api/v1)           \x1b[1;36m║\x1b[0m',
  );
  console.log(
    '\x1b[1;35m║\x1b[0m  \x1b[1;35m[6] VOID·STUDIO Worker:\x1b[0m  Running                 (BullMQ, Async Publish, CSG, Meshy)   \x1b[1;36m║\x1b[0m',
  );
  console.log(
    '\x1b[1;36m╚════════════════════════════════════════════════════════════════════════════════════════╝\x1b[0m\n',
  );
}

// Turbo's TUI owns the whole terminal in an interactive session. The legacy banner would be
// rendered behind it and, together with unstructured child-process output, would tear the layout.
const interactiveTerminal = Boolean(process.stdout.isTTY && process.stdin.isTTY);
if (!interactiveTerminal) {
  printBanner();
}
await prepareEnvironment();

// 1. Launch only the network services that are not already running. This makes repeated
// `pnpm dev` invocations safe when an earlier terminal still owns a port.
const turboFilters = [];
for (const [packageName, port] of [
  ['@void-space/web', 3000],
  ['@void-space/api', 4000],
  ['@void-space/studio-api', 4100],
]) {
  const alreadyRunning = await checkPort(port, 'localhost');

  // The interactive dashboard is also a process overview. Always give Turbo these tasks so the
  // frontend and API remain visible in the TUI; otherwise a reused port silently removes them from
  // the task list. A clean `pnpm dev` session is expected for TUI mode.
  if (interactiveTerminal) {
    turboFilters.push(`--filter=${packageName}`);
  } else if (alreadyRunning) {
    console.log(`\x1b[1;36m[dev]\x1b[0m Reusing ${packageName} on :${port}.`);
  } else {
    turboFilters.push(`--filter=${packageName}`);
  }
}

turboFilters.push('--filter=@void-space/worker', '--filter=@void-space/studio-worker');

const turbo = spawn(
  'pnpm',
  [
    'exec',
    'turbo',
    'run',
    'dev',
    '--parallel',
    `--ui=${interactiveTerminal ? 'tui' : 'stream'}`,
    ...turboFilters,
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  },
);

// 2. Launch VOID·STUDIO Web Editor dev server on port 5007, unless one is already running.
// Reusing it avoids EADDRINUSE taking down the entire terminal dashboard after a restart.
const studioWebAlreadyRunning = await checkPort(5007, 'localhost');
const studioWeb = studioWebAlreadyRunning
  ? null
  : spawn('node', ['tools/serv.js', '5007'], {
      cwd: studioWebDir,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });

if (studioWebAlreadyRunning) {
  console.log('\x1b[1;36m[dev]\x1b[0m Reusing the existing VOID·STUDIO Web server on :5007.');
}

// Prefix VOID·STUDIO Web stdout & stderr to match Turbo stream tags
function attachPrefix(readableStream, prefix, writeTarget) {
  if (!readableStream) return;
  const rl = readline.createInterface({ input: readableStream });
  rl.on('line', (line) => {
    writeTarget.write(`${prefix} ${line}\n`);
  });
}

// Raw output from the separately managed Studio fork would overlap Turbo's full-screen TUI. Keep
// it visible in the traditional stream fallback, while the server itself continues running in TUI
// mode. Its logs remain available through `pnpm studio:fork:dev` when debugging the editor server.
if (!interactiveTerminal) {
  attachPrefix(studioWeb?.stdout, '\x1b[1;33m@void-space/studio-web:dev:\x1b[0m', process.stdout);
  attachPrefix(studioWeb?.stderr, '\x1b[1;31m@void-space/studio-web:err:\x1b[0m', process.stderr);
}

let shuttingDown = false;
function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n\x1b[1;33m[dev]\x1b[0m Shutting down VOID·SPACE and VOID·STUDIO servers...');
  try {
    turbo.kill('SIGINT');
  } catch {}
  try {
    studioWeb?.kill('SIGINT');
  } catch {}
  setTimeout(() => {
    try {
      turbo.kill('SIGKILL');
      studioWeb?.kill('SIGKILL');
    } catch {}
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

turbo.on('exit', (code) => {
  if (!shuttingDown) {
    if (code !== 0 && code !== null) {
      console.error(`\x1b[1;31m[dev]\x1b[0m Turbo exited with code ${code}`);
    }
    cleanup();
  }
});

studioWeb?.on('exit', (code) => {
  if (!shuttingDown) {
    if (code !== 0 && code !== null) {
      console.error(`\x1b[1;31m[dev]\x1b[0m Studio Web exited with code ${code}`);
    }
    cleanup();
  }
});
