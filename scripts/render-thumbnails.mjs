#!/usr/bin/env node
/**
 * Renders marketplace thumbnails with a real browser.
 *
 * Why: a card in a 3D marketplace has to show the object. Mounting a live canvas per card would pull
 * hundreds of megabytes (one bundled model is 13.6 MB) and tank the page, so the preview is rendered
 * once, ahead of time, and served as a small image. This is the same trade every asset marketplace
 * makes.
 *
 * How: each published asset is opened on the unauthenticated /render/<cid> surface — one model,
 * full-bleed, no chrome — and the canvas is screenshotted. Output lands in .thumbnails/ at the repo
 * root, keyed by CID, and is served by the /thumbnails/[cid] route handler.
 *
 * Deliberately not `public/`: Next enumerates that directory once at boot, so a render produced after
 * the server started is served as 404 until a restart — which silently blanks every marketplace card.
 * The route handler reads from disk per request, so regenerating never needs a restart.
 *
 * Output is JPEG at ~q80 rather than PNG: these are photographs of a shaded 3D surface, and the first
 * PNGs this script produced were 424 KB–1 MB each, so a five-card grid cost ~4 MB.
 *
 * Usage: node scripts/render-thumbnails.mjs [--force] [--only <name fragment>]
 * Needs: the stack up (`pnpm stack:up`), and `npx playwright install chromium` once.
 */
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const BASE = process.env.DEMO_WEB_URL ?? 'https://localhost';
const API = process.env.DEMO_API_URL ?? 'https://localhost/api/v1';
const ASSESSOR = { email: 'assessor@aurora.dev', password: 'VoidSpace!2026' };
// 16:10 to match the card well, and large enough to stay crisp at 2x on a 420px card.
const VIEWPORT = { width: 1200, height: 750 };
const RENDER_TIMEOUT_MS = 90_000;

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../.thumbnails');

// The edge serves a locally generated certificate; this process only ever talks to localhost.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let cookies = '';

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const [pair] = entry.split(';');
    cookies = cookies ? `${cookies}; ${pair}` : pair;
  }

  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

async function main() {
  const force = process.argv.includes('--force');
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

  await mkdir(OUT_DIR, { recursive: true });
  await api('/auth/login', { method: 'POST', body: ASSESSOR });

  const { items } = await api('/assets?publishedOnly=true&pageSize=100');
  const targets = items
    .filter((item) => item.currentVersion?.ipfsCid)
    .filter((item) => (only ? item.name.includes(only) : true))
    .filter((item) => !['.fbx', '.obj', '.stl', '.blend'].includes(item.currentVersion.format));

  console.log(`\n  Rendering ${targets.length} thumbnails into .thumbnails/ (served by /thumbnails/[cid])\n`);

  const browser = await chromium.launch();
  let rendered = 0;
  let skipped = 0;

  for (const item of targets) {
    const cid = item.currentVersion.ipfsCid;
    const target = join(OUT_DIR, `${cid}.jpg`);

    if (!force && existsSync(target)) {
      console.log(`  skip   ${item.name.padEnd(30)} (already rendered)`);
      skipped += 1;
      continue;
    }

    process.stdout.write(`  render ${item.name.padEnd(30)} `);

    // The edge serves a locally generated certificate, so the browser context must accept it:
    // `NODE_TLS_REJECT_UNAUTHORIZED` only affects Node's own sockets, never the browser's.
    const page = await browser.newPage({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
    });
    try {
      await page.goto(
        `${BASE}/render/${cid}?format=${encodeURIComponent(item.currentVersion.format)}`,
        { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS },
      );

      // Wait for the model to be on screen: three.js reports progress, and the hint overlay (which
      // the interactive viewer shows) is hidden in compact mode, so the canvas is the signal.
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector('canvas');
          return Boolean(canvas && canvas.width > 0);
        },
        { timeout: RENDER_TIMEOUT_MS },
      );

      // Camera fitting runs on the frame after the scene is ready; give it a beat to settle.
      await page.waitForTimeout(2_500);

      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('no canvas');
      // JPEG, not PNG: a shaded surface is photographic data, and PNG stored it at 6–14x the size.
      await canvas.screenshot({ path: target, type: 'jpeg', quality: 80 });

      const { size } = await import('node:fs').then((fs) => fs.promises.stat(target));
      console.log(`${(size / 1024).toFixed(0)} KB`);
      rendered += 1;
    } catch (error) {
      console.log(`FAILED — ${error.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // The card falls back to its placeholder when a render is missing, so there is no manifest to
  // publish: the presence of the file *is* the manifest.
  console.log(`\n  ${rendered} rendered · ${skipped} already present\n`);
}

main().catch((error) => {
  console.error(`\n  render-thumbnails failed — ${error.message}\n`);
  process.exitCode = 1;
});
