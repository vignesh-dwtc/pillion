#!/usr/bin/env node
/**
 * Explicit, skippable build step of the e2e run (playwright.config.ts runs it before scripts/serve-web.mjs).
 *
 *   E2E_SKIP_BUILD=1   never build (fast reruns when the export in WEB_DIST is known to be fresh)
 *   E2E_REBUILD=1      always build
 *   (default)          build when WEB_DIST has no index.html or any app source is newer than it, so a run never
 *                      silently tests a stale export. `npm run web:build && npm run e2e` therefore builds once.
 *
 * WEB_DIST is relative to the repository root unless absolute (default: dist).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = path.resolve(repoRoot, process.env.WEB_DIST || 'dist');
const indexFile = path.join(distDir, 'index.html');

/** Everything that can change the web bundle. Test and type-check-only files are skipped. */
const SOURCE_ROOTS = ['src', 'assets', 'config'];
const SOURCE_FILES = [
  'app.config.ts',
  'babel.config.js',
  'metro.config.js',
  'package.json',
  'index.ts',
  'tsconfig.json',
];
const IGNORED = /(\.test\.[tj]sx?|\.check\.ts|\.spec\.[tj]sx?)$/;

function newestSourceMtimeMs() {
  let newest = 0;
  const visit = (entry) => {
    let stat;
    try {
      stat = fs.statSync(entry);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
    } else if (!IGNORED.test(entry)) {
      newest = Math.max(newest, stat.mtimeMs);
    }
  };
  for (const root of SOURCE_ROOTS) visit(path.join(repoRoot, root));
  for (const file of SOURCE_FILES) visit(path.join(repoRoot, file));
  return newest;
}

function decide() {
  if (process.env.E2E_SKIP_BUILD === '1') return { build: false, why: 'E2E_SKIP_BUILD=1' };
  if (process.env.E2E_REBUILD === '1') return { build: true, why: 'E2E_REBUILD=1' };
  if (!fs.existsSync(indexFile)) return { build: true, why: `${distDir} has no index.html` };
  if (newestSourceMtimeMs() > fs.statSync(indexFile).mtimeMs)
    return { build: true, why: 'sources are newer than the export' };
  return { build: false, why: 'the export is up to date' };
}

const { build, why } = decide();
if (!build) {
  process.stdout.write(`e2e: web build skipped (${why}); serving ${distDir}\n`);
  process.exit(0);
}

process.stdout.write(`e2e: building the web export into ${distDir} (${why})\n`);
const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', distDir], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});
if (result.status !== 0) {
  console.error(
    'e2e: the web export failed (see above). Fix the build, or set E2E_SKIP_BUILD=1 to test an existing export.',
  );
  process.exit(result.status ?? 1);
}
