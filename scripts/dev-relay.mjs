#!/usr/bin/env node
/**
 * DEV-ONLY WebSocket relay for the web verification target (docs/ARCHITECTURE.md section 7).
 *
 * Two browser contexts play host and guest of one pairing: both connect here and the relay forwards opaque
 * binary messages between them, standing in for the LAN / Wi-Fi Direct byte pipe. It exists so Playwright can run
 * a real two-peer ride on one machine. It is never part of the app and never reaches the Android bundle.
 *
 *   ws://127.0.0.1:<RELAY_PORT>/?room=<pairId>&role=host|guest        (RELAY_PORT default 8787, 0 = any free port)
 *
 * - Rooms are keyed by the NON-secret pair id from the URL. A room holds exactly two peers: the host first, then one
 *   guest. The relay never sees the pairing secret (it travels nowhere) and never inspects, decodes or logs a payload.
 * - Control events are text frames sent by the relay only: `{"type":"paired"}` goes to both peers once the guest has
 *   joined (this is what makes `open()` resolve on both ends). Clients may only send binary frames.
 * - Refusals are WebSocket close codes (a browser cannot read an HTTP status from a failed upgrade):
 *     4400 bad request       4404 no host in the room (a guest arrived first)
 *     4409 role already taken (second host / second guest)         4410 the other peer left
 *     4413 slow consumer      1003 text frame from a client
 * - When one peer leaves, the other is closed with 4410 and the room disappears: each side calls open() again, exactly
 *   like a real transport after a dropped link, and the host registers before the guest finds it.
 * - Listens on 127.0.0.1 only and rejects browser origins that are not localhost.
 * - NOT AN AUTHENTICATED SERVICE. Room membership is first come, first served: anyone who can reach the port and
 *   knows (or guesses) a pair id can take the host or guest seat, and the relay cannot tell. That is acceptable only
 *   here, on loopback, because the secure-channel handshake proof (src/core/protocol) defeats impersonation and the
 *   relay never sees the secret. Do not reuse this file as a signaling or relay server on any reachable network:
 *   a real one needs authenticated rooms, TLS and rate limits (Stage 2, M5).
 *
 * Output: one startup line. Set RELAY_VERBOSE=1 for join/leave lines (first 6 characters of the room id only).
 */
import http from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const PING_INTERVAL_MS = 10_000;
const LOCAL_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const CLOSE = {
  unsupportedData: 1003,
  badRequest: 4400,
  noHost: 4404,
  roomFull: 4409,
  peerLeft: 4410,
  slowConsumer: 4413,
};

const verbose = process.env.RELAY_VERBOSE === '1';

function parsePort(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`dev-relay: invalid RELAY_PORT "${value}"`);
    process.exit(1);
  }
  return port;
}

function log(line) {
  if (verbose) console.log(`[relay] ${line}`);
}

/** Room ids are non-secret, but log only a prefix anyway. */
function short(roomId) {
  return `${roomId.slice(0, 6)}...`;
}

function originAllowed(origin) {
  if (origin === undefined) return true; // not a browser (tests, tools)
  try {
    return LOCAL_ORIGIN_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** @type {Map<string, { host: WebSocket | null, guest: WebSocket | null }>} */
const rooms = new Map();

const isOpen = (socket) => socket !== null && socket.readyState === WebSocket.OPEN;

function refuse(socket, code, reason) {
  socket.close(code, reason);
}

function handleConnection(socket, request) {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  // An error event without a listener would crash the relay (for example ECONNRESET from a killed browser).
  socket.on('error', () => undefined);

  const url = new URL(request.url ?? '/', 'http://localhost');
  const roomId = url.searchParams.get('room') ?? '';
  const role = url.searchParams.get('role');
  if (!ROOM_ID.test(roomId) || (role !== 'host' && role !== 'guest')) {
    refuse(socket, CLOSE.badRequest, 'bad request');
    return;
  }

  let room = rooms.get(roomId);
  if (role === 'host') {
    if (room && isOpen(room.host)) {
      refuse(socket, CLOSE.roomFull, 'host already present');
      return;
    }
    room = { host: socket, guest: null };
    rooms.set(roomId, room);
    log(`host joined ${short(roomId)}`);
  } else {
    if (!room || !isOpen(room.host)) {
      refuse(socket, CLOSE.noHost, 'no host in room');
      return;
    }
    if (isOpen(room.guest)) {
      refuse(socket, CLOSE.roomFull, 'room full');
      return;
    }
    room.guest = socket;
    log(`guest joined ${short(roomId)}`);
    // Text frames are relay control events; everything a client sends is binary.
    const paired = JSON.stringify({ type: 'paired' });
    room.host.send(paired);
    socket.send(paired);
  }

  const joined = room;
  socket.on('message', (data, isBinary) => {
    if (!isBinary) {
      socket.close(CLOSE.unsupportedData, 'binary frames only');
      return;
    }
    const peer = role === 'host' ? joined.guest : joined.host;
    if (!isOpen(peer)) return; // not paired yet (clients wait for the `paired` event before sending)
    if (peer.bufferedAmount > MAX_BUFFERED_BYTES) {
      peer.close(CLOSE.slowConsumer, 'slow consumer');
      return;
    }
    peer.send(data, { binary: true }); // opaque bytes: never inspected, never logged
  });

  socket.on('close', () => {
    const other = role === 'host' ? joined.guest : joined.host;
    if (role === 'host') joined.host = null;
    else joined.guest = null;
    if (rooms.get(roomId) === joined) rooms.delete(roomId);
    if (other && (other.readyState === WebSocket.OPEN || other.readyState === WebSocket.CONNECTING)) {
      other.close(CLOSE.peerLeft, 'peer left');
    }
    log(`${role} left ${short(roomId)}`);
  });
}

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok\n');
    return;
  }
  response.writeHead(426, { 'content-type': 'text/plain', upgrade: 'websocket' });
  response.end('dev relay: WebSocket clients only\n');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
wss.on('connection', handleConnection);

server.on('upgrade', (request, socket, head) => {
  if (!originAllowed(request.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

// Drop peers that vanished without a close frame (killed tab, suspended laptop) so their room frees up.
const pinger = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, PING_INTERVAL_MS);

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`dev-relay: port ${HOST}:${port} is already in use (set RELAY_PORT to use another)`);
  } else {
    console.error(`dev-relay: ${error && error.message ? error.message : error}`);
  }
  process.exit(1);
});

const port = parsePort(process.env.RELAY_PORT, DEFAULT_PORT);
server.listen(port, HOST, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`dev-relay listening on ws://${HOST}:${actualPort} (dev only, localhost, opaque relay)`);
});

function shutdown() {
  clearInterval(pinger);
  for (const socket of wss.clients) socket.close(1001, 'relay stopping');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
