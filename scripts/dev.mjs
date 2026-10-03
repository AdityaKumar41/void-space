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
    console.log('\x1b[1;36m[dev:setup]\x1b[0m Building VOID·STUDIO Web bundle (build/entry_point.js)...');
    spawnSync('pnpm', ['--dir', 'apps/studio-web', 'build'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
  }

  // 2. Check if backing databases are accessible
  const [pgSpace, pgStudio] = await Promise.all([
    checkPort(5432),
    checkPort(5433),
  ]);

  if (!pgSpace || !pgStudio) {
    console.log('\x1b[1;33m[dev:info]\x1b[0m PostgreSQL services (port 5432 or 5433) are not currently responding.');
    console.log('\x1b[1;36m[dev:info]\x1b[0m Attempting to start containers via scripts/dev-up.sh...\n');
    try {
      const up = spawnSync('bash', ['scripts/dev-up.sh'], {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env,
      });
      if (up.status !== 0) {
        console.warn('\n\x1b[1;33m[dev:warn]\x1b[0m dev-up.sh encountered an issue (is Docker running?).');
        console.warn('\x1b[1;33m[dev:warn]\x1b[0m Ensure Docker Desktop is active and run `pnpm dev:up` if services fail to connect.\n');
      }
    } catch (err) {
      console.warn('\x1b[1;33m[dev:warn]\x1b[0m Could not invoke scripts/dev-up.sh automatically:', err.message);
    }
  }
}

function printBanner() {
  console.log('\x1b[1;36m╔════════════════════════════════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1;36m║\x1b[0m                      \x1b[1;37mVOID·SPACE & VOID·STUDIO UNIFIED PLATFORM\x1b[0m                         \x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;36m╠════════════════════════════════════════════════════════════════════════════════════════╣\x1b[0m');
  console.log('\x1b[1;36m║\x1b[0m  \x1b[1;32m[1] VOID·SPACE Web:\x1b[0m      \x1b[4;37mhttp://localhost:3000\x1b[0m   (Operations Console & Marketplace)    \x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;32m║\x1b[0m  \x1b[1;32m[2] VOID·SPACE API:\x1b[0m      \x1b[4;37mhttp://localhost:4000\x1b[0m   (Core REST API & Docs /docs)          \x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;34m║\x1b[0m  \x1b[1;34m[3] VOID·SPACE Worker:\x1b[0m   Running                 (BullMQ, IPFS, AI, Chain License)     \x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;33m║\x1b[0m  \x1b[1;33m[4] VOID·STUDIO Web:\x1b[0m     \x1b[4;37mhttp://localhost:5007\x1b[0m   (WebGPU 3D Studio Editor)             \x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;35m║\x1b[0m  \x1b[1;35m[5] VOID·STUDIO API:\x1b[0m     \x1b[4;37mhttp://localhost:4100\x1b[0m   (Studio API /studio/api/v1)           \x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;35m║\x1b[0m  \x1b[1;35m[6] VOID·STUDIO Worker:\x1b[0m  Running                 (BullMQ, Async Publish, CSG, Meshy)   \x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;36m╚════════════════════════════════════════════════════════════════════════════════════════╝\x1b[0m\n');
}

await prepareEnvironment();
printBanner();

// 1. Launch Turbo parallel pipeline in streaming mode so logs are visible
const turbo = spawn('pnpm', ['exec', 'turbo', 'run', 'dev', '--parallel', '--ui=stream'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
});

// 2. Launch VOID·STUDIO Web Editor dev server on port 5007
const studioWeb = spawn('node', ['tools/serv.js', '5007'], {
  cwd: studioWebDir,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '1' },
});

// Prefix VOID·STUDIO Web stdout & stderr to match Turbo stream tags
function attachPrefix(readableStream, prefix, writeTarget) {
  if (!readableStream) return;
  const rl = readline.createInterface({ input: readableStream });
  rl.on('line', (line) => {
    writeTarget.write(`${prefix} ${line}\n`);
  });
}

attachPrefix(studioWeb.stdout, '\x1b[1;33m@void-space/studio-web:dev:\x1b[0m', process.stdout);
attachPrefix(studioWeb.stderr, '\x1b[1;31m@void-space/studio-web:err:\x1b[0m', process.stderr);

let shuttingDown = false;
function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n\x1b[1;33m[dev]\x1b[0m Shutting down VOID·SPACE and VOID·STUDIO servers...');
  try {
    turbo.kill('SIGINT');
  } catch {}
  try {
    studioWeb.kill('SIGINT');
  } catch {}
  setTimeout(() => {
    try {
      turbo.kill('SIGKILL');
      studioWeb.kill('SIGKILL');
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

studioWeb.on('exit', (code) => {
  if (!shuttingDown) {
    if (code !== 0 && code !== null) {
      console.error(`\x1b[1;31m[dev]\x1b[0m Studio Web exited with code ${code}`);
    }
    cleanup();
  }
});
