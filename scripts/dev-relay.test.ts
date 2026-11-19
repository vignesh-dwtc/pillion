/**
 * Tests for scripts/dev-relay.mjs: the real script is spawned (as Playwright does) and driven by `ws` clients.
 * The relay is a dev-only tool; what matters is the room rules and that payloads stay opaque and unlogged.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import WebSocket from 'ws';

const REPO_ROOT = path.resolve(__dirname, '..');

let relay: ChildProcess;
let baseUrl = '';
let output = '';

function startRelay(): Promise<void> {
  return new Promise((resolve, reject) => {
    relay = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts/dev-relay.mjs')], {
      cwd: REPO_ROOT,
      env: { ...process.env, RELAY_PORT: '0', RELAY_VERBOSE: '1' },
    });
    const timer = setTimeout(() => reject(new Error('relay did not start')), 10_000);
    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match && baseUrl === '') {
        baseUrl = `ws://127.0.0.1:${match[1]}`;
        clearTimeout(timer);
        resolve();
      }
    };
    relay.stdout?.on('data', onChunk);
    relay.stderr?.on('data', onChunk);
    relay.on('exit', (code) => {
      if (baseUrl === '') reject(new Error(`relay exited early with ${code}: ${output}`));
    });
  });
}

class Peer {
  readonly ws: WebSocket;
  readonly inbox: { data: Buffer; isBinary: boolean }[] = [];
  closeInfo: { code: number; reason: string } | null = null;
  upgradeStatus: number | null = null;
  private waiters: (() => void)[] = [];

  constructor(room: string, role: string, headers?: Record<string, string>) {
    this.ws = new WebSocket(`${baseUrl}/?room=${room}&role=${role}`, { headers });
    this.ws.on('open', () => this.wake());
    this.ws.on('message', (data, isBinary) => {
      this.inbox.push({ data: data as Buffer, isBinary });
      this.wake();
    });
    this.ws.on('close', (code, reason) => {
      this.closeInfo = { code, reason: reason.toString() };
      this.wake();
    });
    this.ws.on('unexpected-response', (_request, response) => {
      this.upgradeStatus = response.statusCode ?? null;
      response.resume();
      this.wake();
    });
    this.ws.on('error', () => this.wake());
  }

  private wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  async until(predicate: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${what}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async next(): Promise<{ data: Buffer; isBinary: boolean }> {
    await this.until(() => this.inbox.length > 0, 'a message');
    return this.inbox.shift() as { data: Buffer; isBinary: boolean };
  }

  async nextControl(): Promise<unknown> {
    const message = await this.next();
    expect(message.isBinary).toBe(false);
    return JSON.parse(message.data.toString());
  }

  async closed(): Promise<{ code: number; reason: string }> {
    await this.until(() => this.closeInfo !== null, 'close');
    return this.closeInfo as { code: number; reason: string };
  }

  async opened(): Promise<void> {
    await this.until(() => this.ws.readyState === WebSocket.OPEN || this.closeInfo !== null, 'open');
  }

  send(data: Uint8Array | string) {
    this.ws.send(data);
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }
}

let roomCounter = 0;
const nextRoom = () => `room${Date.now().toString(36)}${roomCounter++}`;
const peers: Peer[] = [];
function peer(room: string, role: string, headers?: Record<string, string>): Peer {
  const created = new Peer(room, role, headers);
  peers.push(created);
  return created;
}

async function pair(room: string): Promise<{ host: Peer; guest: Peer }> {
  const host = peer(room, 'host');
  await host.opened();
  const guest = peer(room, 'guest');
  await guest.opened();
  expect(await host.nextControl()).toEqual({ type: 'paired' });
  expect(await guest.nextControl()).toEqual({ type: 'paired' });
  return { host, guest };
}

beforeAll(async () => {
  await startRelay();
});

afterEach(() => {
  for (const created of peers.splice(0)) created.close();
});

afterAll(async () => {
  const exited = new Promise<void>((resolve) => relay.once('exit', () => resolve()));
  relay.kill('SIGTERM');
  await exited;
});

describe('dev relay rooms', () => {
  it('pairs a host with a guest and announces it to both', async () => {
    const room = nextRoom();
    const host = peer(room, 'host');
    await host.opened();
    expect(host.inbox).toHaveLength(0); // the host waits until a guest arrives
    const guest = peer(room, 'guest');
    expect(await host.nextControl()).toEqual({ type: 'paired' });
    expect(await guest.nextControl()).toEqual({ type: 'paired' });
  });

  it('relays binary messages both ways byte for byte, preserving order', async () => {
    const { host, guest } = await pair(nextRoom());
    const big = new Uint8Array(200_000).map((_, index) => index % 251);
    host.send(Uint8Array.of(1, 2, 3));
    host.send(big);
    host.send(new Uint8Array(0));
    guest.send(Uint8Array.of(9, 8, 7));

    const first = await guest.next();
    expect(first.isBinary).toBe(true);
    expect([...first.data]).toEqual([1, 2, 3]);
    const second = await guest.next();
    expect(second.data.equals(Buffer.from(big))).toBe(true);
    const third = await guest.next();
    expect(third.data.length).toBe(0);
    const back = await host.next();
    expect([...back.data]).toEqual([9, 8, 7]);
  });

  it('refuses a guest when no host is in the room (host first)', async () => {
    const guest = peer(nextRoom(), 'guest');
    expect((await guest.closed()).code).toBe(4404);
  });

  it('refuses a second guest and keeps the first pair working', async () => {
    const room = nextRoom();
    const { host, guest } = await pair(room);
    const intruder = peer(room, 'guest');
    expect((await intruder.closed()).code).toBe(4409);
    host.send(Uint8Array.of(42));
    expect([...(await guest.next()).data]).toEqual([42]);
    expect(intruder.inbox).toHaveLength(0);
  });

  it('refuses a second host', async () => {
    const room = nextRoom();
    const host = peer(room, 'host');
    await host.opened();
    const second = peer(room, 'host');
    expect((await second.closed()).code).toBe(4409);
    expect(host.closeInfo).toBeNull();
  });

  it('closes the other side with 4410 when one peer leaves, then frees the room', async () => {
    const room = nextRoom();
    const { host, guest } = await pair(room);
    guest.close();
    expect((await host.closed()).code).toBe(4410);

    // The same room can be used again straight away: host first, then guest.
    const again = await pair(room);
    again.host.close();
    expect((await again.guest.closed()).code).toBe(4410);
  });

  it('closes the guest when the host leaves', async () => {
    const { host, guest } = await pair(nextRoom());
    host.close();
    expect((await guest.closed()).code).toBe(4410);
  });

  it('keeps rooms isolated from each other', async () => {
    const one = await pair(nextRoom());
    const two = await pair(nextRoom());
    one.host.send(Uint8Array.of(1));
    two.host.send(Uint8Array.of(2));
    expect([...(await one.guest.next()).data]).toEqual([1]);
    expect([...(await two.guest.next()).data]).toEqual([2]);
    expect(one.guest.inbox).toHaveLength(0);
    expect(two.guest.inbox).toHaveLength(0);
  });

  it('rejects text frames from clients (binary only)', async () => {
    const { host, guest } = await pair(nextRoom());
    host.send('hello');
    expect((await host.closed()).code).toBe(1003);
    expect((await guest.closed()).code).toBe(4410);
  });

  it('rejects bad room ids and roles', async () => {
    expect((await peer('bad%20room', 'host').closed()).code).toBe(4400);
    expect((await peer(nextRoom(), 'spectator').closed()).code).toBe(4400);
    expect((await peer('', 'host').closed()).code).toBe(4400);
  });

  it('refuses browser origins that are not localhost', async () => {
    const hostile = peer(nextRoom(), 'host', { Origin: 'https://evil.example' });
    await hostile.until(() => hostile.upgradeStatus !== null || hostile.closeInfo !== null, 'a refusal');
    expect(hostile.upgradeStatus).toBe(403);

    const local = peer(nextRoom(), 'host', { Origin: 'http://localhost:8099' });
    await local.opened();
    expect(local.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('answers /health over plain HTTP for readiness checks', async () => {
    const response = await fetch(`${baseUrl.replace('ws://', 'http://')}/health`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok\n');
  });
});

describe('dev relay privacy', () => {
  it('never writes payload bytes to its output', async () => {
    const { host, guest } = await pair(nextRoom());
    const secret = 'PAYLOAD-MARKER-3f9a1c7e-do-not-log';
    host.send(Buffer.from(secret));
    host.send(Buffer.from(Buffer.from(secret).toString('base64')));
    await guest.next();
    await guest.next();
    host.close();
    await guest.closed();

    expect(output).not.toContain(secret);
    expect(output).not.toContain(Buffer.from(secret).toString('base64'));
    expect(output).not.toContain(Buffer.from(secret).toString('hex'));
    // Verbose mode logs joins and leaves with a truncated room id only.
    expect(output).toMatch(/\[relay\] host joined \w{6}\.\.\./);
  });
});
