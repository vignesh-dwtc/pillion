#!/usr/bin/env node
/**
 * Static server for the web verification target: serves an existing `expo export --platform web` directory on
 * localhost with a single-page-app fallback (deep links such as /pair/host return index.html). It builds nothing.
 *
 *   WEB_DIST  directory to serve, relative to the repository root unless absolute (default: dist)
 *   WEB_PORT  port (default 8099; 0 = any free port)
 *
 * Listens on 127.0.0.1 only. A request for a missing path WITH a file extension (a broken asset URL) is a 404 instead of
 * silently returning HTML. Everything is sent with `Cache-Control: no-store` so a rebuilt export is picked up at once.
 *
 * Test support: `GET /__blank` is an empty HTML document on this (local) origin. e2e helpers that must run in a page
 * without loading the app use it; a document made up by the test (route.fulfill) is not treated as local by Chromium,
 * which then blocks its WebSocket to the localhost dev relay (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8099;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(repoRoot, process.env.WEB_DIST || 'dist');
const verbose = process.env.SERVE_VERBOSE === '1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function fail(message) {
  console.error(`serve-web: ${message}`);
  process.exit(1);
}

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`invalid WEB_PORT "${value}"`);
  return port;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  fail(
    `directory "${distDir}" does not exist. Build the web export first (npm run web:build, or ` +
      `npx expo export --platform web --output-dir <dir> and WEB_DIST=<dir>).`,
  );
}
const indexFile = path.join(distDir, 'index.html');
if (!isFile(indexFile)) {
  fail(`"${distDir}" has no index.html: it is not a web export. Run npm run web:build first.`);
}

/** Maps a URL path to a file inside distDir, or null when it escapes the directory. */
function resolveInsideDist(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = path.normalize(path.join(distDir, decoded));
  if (candidate !== distDir && !candidate.startsWith(distDir + path.sep)) return null;
  return candidate;
}

function send(request, response, status, file, contentType) {
  const headers = {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (file === null) {
    response.writeHead(status, headers);
    response.end(request.method === 'HEAD' ? undefined : `${status}\n`);
    return;
  }
  const size = fs.statSync(file).size;
  response.writeHead(status, { ...headers, 'content-length': size });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(file)
    .on('error', () => response.destroy())
    .pipe(response);
}

const BLANK_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>blank</title></head><body></body></html>\n';

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain' });
    response.end('405\n');
    return;
  }
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (pathname === '/__blank') {
    response.writeHead(200, { 'content-type': MIME_TYPES['.html'], 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : BLANK_PAGE);
    return;
  }
  const target = resolveInsideDist(pathname);
  if (target === null) {
    send(request, response, 403, null, 'text/plain');
    return;
  }
  let file = target;
  if (!isFile(file)) {
    const asDirectoryIndex = path.join(target, 'index.html');
    if (isFile(asDirectoryIndex)) file = asDirectoryIndex;
  }
  if (isFile(file)) {
    if (verbose) console.log(`200 ${pathname}`);
    send(
      request,
      response,
      200,
      file,
      MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    );
    return;
  }
  if (path.extname(pathname) !== '') {
    if (verbose) console.log(`404 ${pathname}`);
    send(request, response, 404, null, 'text/plain');
    return;
  }
  if (verbose) console.log(`200 ${pathname} (spa fallback)`);
  send(request, response, 200, indexFile, MIME_TYPES['.html']);
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    fail(`port ${HOST}:${port} is already in use (set WEB_PORT to use another)`);
  }
  fail(error && error.message ? error.message : String(error));
});

const port = parsePort(process.env.WEB_PORT);
server.listen(port, HOST, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`serve-web: serving ${distDir} on http://${HOST}:${actualPort} (localhost only, SPA fallback)`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
