#!/usr/bin/env node
/**
 * Guards the rule "web-only fakes never end up in the Android bundle" (docs/ARCHITECTURE.md section 7).
 *
 * Exports the Android JS bundle (`npx expo export --platform android --output-dir dist-android-check`: Hermes bytecode,
 * minified, exactly what the APK embeds) and fails when any file of the export contains a web-only marker:
 *   - the sentinel `@@web-only:` that every web-only module carries as a runtime string, plus
 *   - names and strings that only web-only code uses (WebLinkTransport, dev-relay, DevPanel.web, DevControls, ...).
 * Hermes keeps string literals in its string table, so a leaked module is found even though identifiers are minified.
 *
 *   node scripts/check-android-bundle.mjs                 export, then scan
 *   node scripts/check-android-bundle.mjs --skip-export   scan the existing output directory
 *   node scripts/check-android-bundle.mjs --dir <path>    scan another directory (implies --skip-export)
 *   node scripts/check-android-bundle.mjs --expect-found  inverse (self-test): fail unless markers ARE found, e.g.
 *                                                         against a web export, proving the scan can see them
 *
 * Exit codes: 0 clean, 1 markers found, 2 the export failed or produced nothing scannable.
 * Never prints surrounding bytes, only file names, marker names and counts.
 */
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = 'dist-android-check';

/** Strings that must never appear in the Android bundle. Keep in sync with the web-only modules. */
export const WEB_ONLY_MARKERS = [
  '@@web-only:',
  'WebLinkTransport',
  'WebMediaEngine',
  'WebFakeAudioRoute',
  'WebFakeRideService',
  'InsecureLocalStorageSecureStore',
  'insecure-dev-store',
  'dev relay', // with a space: the error messages of WebLinkTransport. Not 'dev-relay': package.json is embedded too.
  'DevPanel.web',
  'DevControls',
  '__devControls',
  'devControls.web',
  'createLinkTransport.web',
  'createMediaEngine.web',
  'createAudioRoute.web',
  'createRideService.web',
  'createPermissionService.web',
  'createSecureStore.web',
  'localhost:8787',
];

function parseArguments(argv) {
  const options = { dir: DEFAULT_DIR, exportFirst: true, expectFound: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skip-export') options.exportFirst = false;
    else if (argument === '--expect-found') options.expectFound = true;
    else if (argument === '--dir') {
      const value = argv[(index += 1)];
      if (!value) fail('--dir needs a path', 2);
      options.dir = value;
      options.exportFirst = false;
    } else fail(`unknown argument "${argument}"`, 2);
  }
  return options;
}

function fail(message, code) {
  console.error(`check-android-bundle: ${message}`);
  process.exit(code);
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function countOccurrences(buffer, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = buffer.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** Scans every file for every marker (UTF-8 and UTF-16LE, the two ways Hermes stores strings). */
export function scanDirectory(directory, markers = WEB_ONLY_MARKERS) {
  const findings = [];
  const scanned = [];
  for (const file of listFiles(directory)) {
    const buffer = fs.readFileSync(file);
    scanned.push({ file, bytes: buffer.length });
    for (const marker of markers) {
      const count =
        countOccurrences(buffer, Buffer.from(marker, 'utf8')) +
        countOccurrences(buffer, Buffer.from(marker, 'utf16le'));
      if (count > 0) findings.push({ file: path.relative(directory, file), marker, count });
    }
  }
  return { findings, scanned };
}

function productName() {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/identity.json'), 'utf8')).displayName;
  } catch {
    return null;
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const directory = path.resolve(repoRoot, options.dir);

  if (options.exportFirst) {
    fs.rmSync(directory, { recursive: true, force: true });
    console.log(
      `check-android-bundle: exporting the Android bundle into ${path.relative(repoRoot, directory)} ...`,
    );
    const result = spawnSync('npx', ['expo', 'export', '--platform', 'android', '--output-dir', directory], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status !== 0) fail(`"expo export --platform android" failed (exit ${result.status})`, 2);
  }

  if (!fs.existsSync(directory)) fail(`directory ${directory} does not exist (run without --skip-export)`, 2);
  const { findings, scanned } = scanDirectory(directory);
  const bundles = scanned.filter(({ file }) => /\.(hbc|js|bundle)$/.test(file));
  if (!options.expectFound && bundles.length === 0) fail(`no bundle (.hbc / .js) found in ${directory}`, 2);

  if (!options.expectFound) {
    // Guard against a vacuous pass: a real app bundle always contains the product name from config/identity.json.
    const name = productName();
    const hasApp = name === null || scanDirectory(directory, [name]).findings.length > 0;
    if (!hasApp) fail(`the bundle does not contain the product name "${name}": it looks empty or broken`, 2);
  }

  const totalBytes = scanned.reduce((sum, { bytes }) => sum + bytes, 0);
  console.log(
    `check-android-bundle: scanned ${scanned.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(2)} MiB, ` +
      `${WEB_ONLY_MARKERS.length} markers`,
  );

  if (options.expectFound) {
    if (findings.length === 0) fail('self-test failed: no web-only marker found where some were expected', 1);
    console.log(
      `check-android-bundle: self-test ok, markers found: ${[...new Set(findings.map((f) => f.marker))].join(', ')}`,
    );
    return;
  }

  if (findings.length > 0) {
    console.error('check-android-bundle: FAIL, web-only code reached the Android bundle:');
    for (const { file, marker, count } of findings) console.error(`  ${file}: "${marker}" x${count}`);
    process.exit(1);
  }
  console.log('check-android-bundle: OK, no web-only marker in the Android bundle');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
