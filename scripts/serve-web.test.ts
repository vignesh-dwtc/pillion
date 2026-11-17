/**
 * Tests for scripts/serve-web.mjs: the real script is spawned against a throwaway export directory.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/serve-web.mjs');

let server: ChildProcess;
let baseUrl = '';
let distDir = '';

function startServer(dist: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, WEB_DIST: dist, WEB_PORT: '0' },
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 10_000);
    server.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match && baseUrl === '') {
        baseUrl = `http://127.0.0.1:${match[1]}`;
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('exit', (code) => {
      if (baseUrl === '') reject(new Error(`server exited early with ${code}: ${output}`));
    });
  });
}

/** Raw request so path traversal strings reach the server unnormalised (fetch would resolve `..` itself). */
function rawRequest(method: string, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const request = http.request(
      { host: url.hostname, port: url.port, method, path: rawPath },
      (response) => {
        let body = '';
        response.on('data', (chunk: Buffer) => (body += chunk.toString()));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

beforeAll(async () => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-test-'));
  fs.mkdirSync(path.join(distDir, '_expo/static/js/web'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'nested'));
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>root-index</title>');
  fs.writeFileSync(path.join(distDir, 'nested/index.html'), '<!doctype html><title>nested-index</title>');
  fs.writeFileSync(path.join(distDir, '_expo/static/js/web/app.js'), 'console.log("app");');
  fs.writeFileSync(path.join(distDir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  fs.writeFileSync(path.join(os.tmpdir(), 'serve-web-test-outside.txt'), 'outside the export');
  await startServer(distDir);
});

afterAll(async () => {
  const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()));
  server.kill('SIGTERM');
  await exited;
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.rmSync(path.join(os.tmpdir(), 'serve-web-test-outside.txt'), { force: true });
});

describe('serve-web', () => {
  it('serves index.html at the root and files with their content type', async () => {
    const root = await fetch(`${baseUrl}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toContain('text/html');
    expect(await root.text()).toContain('root-index');

    const script = await fetch(`${baseUrl}/_expo/static/js/web/app.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(await script.text()).toBe('console.log("app");');

    const icon = await fetch(`${baseUrl}/favicon.ico`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/x-icon');
  });

  it('falls back to index.html for deep links without a file extension', async () => {
    for (const route of ['/home', '/pair/host', '/pair/guest', '/ride?x=1', '/does/not/exist']) {
      const response = await fetch(`${baseUrl}${route}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('root-index');
    }
  });

  it('serves a directory index when the directory has one', async () => {
    const response = await fetch(`${baseUrl}/nested`);
    expect(await response.text()).toContain('nested-index');
  });

  it('answers 404 for a missing path with a file extension instead of returning HTML', async () => {
    const response = await fetch(`${baseUrl}/missing.js`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('refuses path traversal outside the export directory', async () => {
    const outsideName = 'serve-web-test-outside.txt';
    const relative = path.relative(distDir, path.join(os.tmpdir(), outsideName)).split(path.sep).join('/');
    for (const attempt of [
      `/${relative}`,
      `/${relative.replace(/\.\./g, '%2e%2e')}`,
      '/..%2f..%2fetc/passwd',
    ]) {
      const response = await rawRequest('GET', attempt);
      expect(response.body).not.toContain('outside the export');
      expect([403, 404]).toContain(response.status);
    }
  });

  it('supports HEAD and rejects other methods', async () => {
    const head = await rawRequest('HEAD', '/');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    const post = await rawRequest('POST', '/');
    expect(post.status).toBe(405);
  });

  it('serves an empty page at /__blank for e2e helpers that must not load the app', async () => {
    const response = await fetch(`${baseUrl}/__blank`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<body></body>');
    expect(body).not.toContain('root-index');
  });

  it('disables caching so a rebuilt export is picked up', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails with a clear message when the directory is missing', () => {
    const missing = path.join(os.tmpdir(), 'serve-web-test-does-not-exist');
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, WEB_DIST: missing, WEB_PORT: '0' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('serve-web:');
    expect(result.stderr).toContain(missing);
    expect(result.stderr).toContain('web:build');
  });

  it('fails when the directory is not a web export (no index.html)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-empty-'));
    try {
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: REPO_ROOT,
        env: { ...process.env, WEB_DIST: empty, WEB_PORT: '0' },
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('index.html');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
