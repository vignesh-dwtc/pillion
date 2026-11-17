/**
 * WebLinkTransport against the REAL dev relay (scripts/dev-relay.mjs, spawned on a free port), using Node's global
 * WebSocket. Covers the LinkTransport contract: host/guest pairing, byte pipe, close reasons, errors, timeout, abort.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { devControls } from '../devtools/devControls.web';

import { createLinkTransport } from './createLinkTransport.web';
import { LinkError, type LinkChannel, type LinkTransport } from './LinkTransport';

// babel-preset-expo rewrites `process.env.EXPO_PUBLIC_*` to a read of the `expo/virtual/env` module, which Metro
// provides but Jest cannot load (ESM inside node_modules). Serve the live process.env instead.
jest.mock('expo/virtual/env', () => ({ env: process.env }), { virtual: true });

const REPO_ROOT = path.resolve(__dirname, '../../..');
const bytes = (...values: number[]) => Uint8Array.from(values);

let relay: ChildProcess;
let relayUrl = '';
const transports: LinkTransport[] = [];

function startRelay(): Promise<string> {
  return new Promise((resolve, reject) => {
    relay = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts/dev-relay.mjs')], {
      cwd: REPO_ROOT,
      env: { ...process.env, RELAY_PORT: '0' },
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error(`relay did not start: ${output}`)), 10_000);
    relay.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(`ws://127.0.0.1:${match[1]}`);
      }
    });
  });
}

function transport(): LinkTransport {
  const created = createLinkTransport();
  transports.push(created);
  return created;
}

let roomCounter = 0;
const room = () => `weblink${Date.now().toString(36)}${roomCounter++}`;

async function connectPair(
  pairId: string,
): Promise<{ host: LinkChannel; guest: LinkChannel; hostSide: LinkTransport; guestSide: LinkTransport }> {
  const hostSide = transport();
  const guestSide = transport();
  const hostOpen = hostSide.open({ role: 'host', pairId, timeoutMs: 5_000 });
  // The guest must find the host, so give the host's registration a moment (the session layer retries instead).
  await new Promise((resolve) => setTimeout(resolve, 100));
  const guestOpen = guestSide.open({ role: 'guest', pairId, timeoutMs: 5_000 });
  const [host, guest] = await Promise.all([hostOpen, guestOpen]);
  return { host, guest, hostSide, guestSide };
}

function nextData(channel: LinkChannel): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const off = channel.onData((data) => {
      off();
      resolve(data);
    });
  });
}

function closed(channel: LinkChannel): Promise<{ reason: string; detail?: string }> {
  return new Promise((resolve) => {
    channel.onClose((reason, detail) => resolve({ reason, detail }));
  });
}

beforeAll(async () => {
  relayUrl = await startRelay();
  process.env.EXPO_PUBLIC_RELAY_URL = relayUrl;
});

beforeEach(() => {
  devControls.reset();
});

afterEach(async () => {
  await Promise.all(transports.splice(0).map((created) => created.dispose()));
});

afterAll(async () => {
  delete process.env.EXPO_PUBLIC_RELAY_URL;
  const exited = new Promise<void>((resolve) => relay.once('exit', () => resolve()));
  relay.kill('SIGTERM');
  await exited;
});

describe('WebLinkTransport', () => {
  it('describes itself as the web relay transport and lists a loopback interface', async () => {
    const link = transport();
    expect(link.kind).toBe('web-relay');
    expect(await link.isAvailable()).toBe(true);
    expect(await link.listInterfaces()).toEqual([
      { name: 'dev-relay', kind: 'loopback', addresses: ['127.0.0.1'], up: true, multicast: false },
    ]);
  });

  it('pairs a host with a guest and moves bytes both ways in order', async () => {
    const { host, guest } = await connectPair(room());
    expect(host.endpoint).toMatchObject({ kind: 'web-relay', interfaceName: 'dev-relay' });

    const received: number[][] = [];
    guest.onData((data) => received.push([...data]));
    await host.send(bytes(1, 2, 3));
    await host.send(bytes(4));
    const reply = nextData(host);
    await guest.send(bytes(9, 9));

    expect([...(await reply)]).toEqual([9, 9]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual([[1, 2, 3], [4]]);
  });

  it('buffers bytes that arrive before the first onData subscriber', async () => {
    const { host, guest } = await connectPair(room());
    await host.send(bytes(7, 7));
    await host.send(bytes(8));
    await new Promise((resolve) => setTimeout(resolve, 100)); // delivered while nobody listens
    const seen: number[][] = [];
    guest.onData((data) => seen.push([...data]));
    expect(seen).toEqual([[7, 7], [8]]);
  });

  it('tells the other side `remote-close` when one side closes, and `local-close` to the closer', async () => {
    const { host, guest } = await connectPair(room());
    const hostClosed = closed(host);
    const guestClosed = closed(guest);
    await guest.close();
    expect((await guestClosed).reason).toBe('local-close');
    expect((await hostClosed).reason).toBe('remote-close');
    await expect(host.send(bytes(1))).rejects.toThrow();
  });

  it('delivers a close that already happened to a late onClose subscriber', async () => {
    const { host } = await connectPair(room());
    await host.close();
    const late = await new Promise<string>((resolve) => host.onClose((reason) => resolve(reason)));
    expect(late).toBe('local-close');
  });

  it('dev panel "drop link" ends every link of the page as `network-lost`', async () => {
    // Host and guest share one page-wide registry here (one process); in the browser each context has its own, and
    // the partner of the dropped side sees `remote-close` (covered by the close test above).
    const { host, guest } = await connectPair(room());
    expect(devControls.getState().linkUp).toBe(true);
    const hostClosed = closed(host);
    const guestClosed = closed(guest);
    devControls.dropLink();
    expect((await hostClosed).reason).toBe('network-lost');
    expect((await guestClosed).reason).toBe('network-lost');
    expect(devControls.getState().linkUp).toBe(false);
    await expect(host.send(bytes(1))).rejects.toThrow();
  });

  it('can reconnect on the same pair id after a drop (host first, then guest)', async () => {
    const pairId = room();
    const first = await connectPair(pairId);
    const firstClosed = closed(first.guest);
    first.host.close();
    await firstClosed;
    await first.hostSide.dispose();
    await first.guestSide.dispose();
    const second = await connectPair(pairId);
    await second.host.send(bytes(5));
    expect([...(await nextData(second.guest))]).toEqual([5]);
  });

  it('refuses a guest when there is no host: discovery-failed', async () => {
    const error = await transport()
      .open({ role: 'guest', pairId: room(), timeoutMs: 2_000 })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(LinkError);
    expect((error as LinkError).code).toBe('discovery-failed');
  });

  it('refuses a second guest: connect-failed', async () => {
    const pairId = room();
    await connectPair(pairId);
    const error = await transport()
      .open({ role: 'guest', pairId, timeoutMs: 2_000 })
      .catch((reason: unknown) => reason);
    expect((error as LinkError).code).toBe('connect-failed');
  });

  it('times out a host that nobody joins: timeout', async () => {
    const error = await transport()
      .open({ role: 'host', pairId: room(), timeoutMs: 150 })
      .catch((reason: unknown) => reason);
    expect((error as LinkError).code).toBe('timeout');
  });

  it('aborts an in-flight open(): aborted, and an already aborted signal rejects at once', async () => {
    const controller = new AbortController();
    const pending = transport().open({
      role: 'host',
      pairId: room(),
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    expect(((await pending.catch((reason: unknown) => reason)) as LinkError).code).toBe('aborted');

    const aborted = await transport()
      .open({ role: 'host', pairId: room(), timeoutMs: 5_000, signal: AbortSignal.abort() })
      .catch((reason: unknown) => reason);
    expect((aborted as LinkError).code).toBe('aborted');
  });

  it('frees the relay room when an open() is aborted', async () => {
    const pairId = room();
    const controller = new AbortController();
    const pending = transport().open({ role: 'host', pairId, timeoutMs: 5_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await pending.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { host, guest } = await connectPair(pairId); // would be refused (4409) if the aborted host still held the room
    expect(host).toBeDefined();
    expect(guest).toBeDefined();
  });

  it('link blocked by the dev panel: open() fails with unavailable until unblocked', async () => {
    devControls.setLinkBlocked(true);
    const link = transport();
    const error = await link
      .open({ role: 'host', pairId: room(), timeoutMs: 1_000 })
      .catch((reason: unknown) => reason);
    expect((error as LinkError).code).toBe('unavailable');
    devControls.setLinkBlocked(false);
    const pending = link
      .open({ role: 'host', pairId: room(), timeoutMs: 100 })
      .catch((reason: unknown) => reason);
    expect(((await pending) as LinkError).code).toBe('timeout');
  });

  it('dispose() aborts pending opens, closes the channel and makes the transport unusable', async () => {
    const { host, hostSide } = await connectPair(room());
    const hostClosed = closed(host);
    const pending = transport().open({ role: 'host', pairId: room(), timeoutMs: 5_000 });
    const other = transports[transports.length - 1] as LinkTransport;
    await other.dispose();
    expect(((await pending.catch((reason: unknown) => reason)) as LinkError).code).toBe('aborted');

    await hostSide.dispose();
    expect((await hostClosed).reason).toBe('local-close');
    expect(await hostSide.isAvailable()).toBe(false);
    const error = await hostSide
      .open({ role: 'host', pairId: room(), timeoutMs: 1_000 })
      .catch((reason: unknown) => reason);
    expect((error as LinkError).code).toBe('unavailable');
  });

  it('rejects a malformed pair id without touching the network', async () => {
    const error = await transport()
      .open({ role: 'host', pairId: 'not a valid id!', timeoutMs: 1_000 })
      .catch((reason: unknown) => reason);
    expect((error as LinkError).code).toBe('connect-failed');
  });

  it('reports `unavailable` when the relay is not running', async () => {
    process.env.EXPO_PUBLIC_RELAY_URL = 'ws://127.0.0.1:9'; // discard port: nothing listens
    try {
      const error = await transport()
        .open({ role: 'host', pairId: room(), timeoutMs: 3_000 })
        .catch((reason: unknown) => reason);
      expect((error as LinkError).code).toBe('unavailable');
    } finally {
      process.env.EXPO_PUBLIC_RELAY_URL = relayUrl;
    }
  });

  it('only ever talks to localhost: any other relay URL is refused before connecting', async () => {
    process.env.EXPO_PUBLIC_RELAY_URL = 'ws://relay.example.com:8787';
    try {
      const link = transport();
      expect(await link.isAvailable()).toBe(false);
      const error = await link
        .open({ role: 'host', pairId: room(), timeoutMs: 1_000 })
        .catch((reason: unknown) => reason);
      expect((error as LinkError).code).toBe('unavailable');
      expect((error as LinkError).message).toMatch(/localhost/);
    } finally {
      process.env.EXPO_PUBLIC_RELAY_URL = relayUrl;
    }
  });
});
