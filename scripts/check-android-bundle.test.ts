/**
 * Tests for the scanning half of scripts/check-android-bundle.mjs (the export half needs Metro and runs as
 * `node scripts/check-android-bundle.mjs`). The script is spawned against throwaway directories.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import IDENTITY from '../config/identity.json';

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-android-bundle.mjs');

const directories: string[] = [];

function fixture(files: Record<string, Buffer | string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'android-bundle-check-'));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), content);
  }
  return directory;
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const appBundle = (extra = '') => `__d(function(){ var name = "${IDENTITY.displayName}"; ${extra} });`;

afterAll(() => {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
});

describe('check-android-bundle', () => {
  it('passes for a bundle without web-only markers', () => {
    // `createLinkTransport` (the shared factory name) and `scripts/dev-relay.mjs` (package.json is embedded in the app
    // bundle through version.ts) are legitimate in the Android bundle.
    const dir = fixture({
      'index.hbc': appBundle('var tag = "createLinkTransport"; var script = "node scripts/dev-relay.mjs";'),
    });
    const { status, out } = run('--dir', dir);
    expect(out).toContain('OK');
    expect(status).toBe(0);
  });

  it.each([
    ['@@web-only:SomethingNew@@', '@@web-only:'],
    ['WebLinkTransport', 'WebLinkTransport'],
    ['dev relay not reachable', 'dev relay'],
    ['DevPanel.web', 'DevPanel.web'],
    ['DevControls', 'DevControls'],
    ['createSecureStore.web', 'createSecureStore.web'],
    ['insecure-dev-store', 'insecure-dev-store'],
  ])('fails when the bundle contains %s, naming the file and marker but no context', (leaked, marker) => {
    const dir = fixture({
      'metadata.json': '{}',
      '_expo/static/js/android/index.hbc': appBundle(`var leak = "SECRET-CONTEXT-${leaked}-AFTER";`),
    });
    const { status, out } = run('--dir', dir);
    expect(status).toBe(1);
    expect(out).toContain('FAIL');
    expect(out).toContain(path.join('_expo', 'static', 'js', 'android', 'index.hbc'));
    expect(out).toContain(`"${marker}"`);
    expect(out).not.toContain('SECRET-CONTEXT');
  });

  it('finds markers stored as UTF-16 strings (how Hermes stores non-ASCII string tables)', () => {
    const dir = fixture({
      'index.hbc': Buffer.concat([Buffer.from(appBundle()), Buffer.from('WebLinkTransport', 'utf16le')]),
    });
    expect(run('--dir', dir).status).toBe(1);
  });

  it('refuses a vacuous pass: a bundle without the product name, or no bundle at all, is exit 2', () => {
    expect(run('--dir', fixture({ 'index.hbc': 'nothing of the app in here' })).status).toBe(2);
    expect(run('--dir', fixture({ 'metadata.json': '{}' })).status).toBe(2);
    expect(run('--dir', path.join(os.tmpdir(), 'android-bundle-check-missing')).status).toBe(2);
  });

  it('--expect-found is the inverse self-test for a web export', () => {
    const webExport = fixture({ 'bundle.js': 'class WebLinkTransport {}' });
    expect(run('--dir', webExport, '--expect-found').status).toBe(0);
    const androidExport = fixture({ 'index.hbc': appBundle() });
    expect(run('--dir', androidExport, '--expect-found').status).toBe(1);
  });

  it('rejects unknown arguments', () => {
    expect(run('--bogus').status).toBe(2);
  });
});
