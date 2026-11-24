import { decodeBase64, encodeBase64 } from './base64';
import { createLanTransport, toLinkError } from './LanTransport';
import { LinkError, type LinkChannel, type LinkTransport } from './LinkTransport';
import { FakeNetwork, type FakeLinkNative } from './testing/FakeLinkNative';

const PAIR = 'Ab3_-xYz09QwErTy';
const CONFIG = { serviceType: '_test._tcp' };

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

async function expectLinkError(promise: Promise<unknown>, code: LinkError['code']) {
  await expect(promise).rejects.toBeInstanceOf(LinkError);
  await expect(promise).rejects.toMatchObject({ code });
}

function collect(channel: LinkChannel) {
  const chunks: number[] = [];
  channel.onData((bytes) => chunks.push(...bytes));
  return chunks;
}

describe('LanTransport', () => {
  let net: FakeNetwork;
  let hostNative: FakeLinkNative;
  let guestNative: FakeLinkNative;
  let host: LinkTransport;
  let guest: LinkTransport;

  beforeEach(() => {
    net = new FakeNetwork();
    hostNative = net.join('192.168.1.10');
    guestNative = net.join('192.168.1.20');
    host = createLanTransport(hostNative, CONFIG);
    guest = createLanTransport(guestNative, CONFIG);
  });

  afterEach(async () => {
    await host.dispose();
    await guest.dispose();
  });

  it('connects host and guest and moves bytes both ways', async () => {
    const [h, g] = await Promise.all([
      host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 }),
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }),
    ]);
    expect(h.endpoint).toEqual({
      kind: 'lan',
      localAddress: '192.168.1.10',
      remoteAddress: '192.168.1.20',
      interfaceName: 'wlan0',
    });
    expect(g.endpoint.remoteAddress).toBe('192.168.1.10');

    const atHost = collect(h);
    const atGuest = collect(g);
    await g.send(new Uint8Array([1, 2, 3]));
    await h.send(new Uint8Array([250, 0]));
    await tick();
    expect(atHost).toEqual([1, 2, 3]);
    expect(atGuest).toEqual([250, 0]);
    // Bytes cross the bridge as standard Base64.
    expect(guestNative.sent[0]?.data).toBe('AQID');
  });

  it('passes the service type and pair id, and tears down NSD and the listener after connecting', async () => {
    await Promise.all([
      host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 }),
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }),
    ]);
    expect(hostNative.calls).toEqual(
      expect.arrayContaining([
        'acquireLocks',
        'listen',
        `startAdvertising:_test._tcp:${PAIR}`,
        'stopAdvertising',
      ]),
    );
    expect(hostNative.calls.some((c) => c.startsWith('stopListening:'))).toBe(true);
    expect(guestNative.calls).toEqual(
      expect.arrayContaining(['acquireLocks', `startDiscovery:_test._tcp:${PAIR}`, 'stopDiscovery']),
    );
    expect(hostNative.advertising).toBeNull();
    expect(guestNative.discovering).toBeNull();
    expect(hostNative.openListeners.size).toBe(0);
  });

  it('host waits for a guest that starts later', async () => {
    const hostOpen = host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 });
    await tick(20);
    const g = await guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 });
    const h = await hostOpen;
    expect(h.endpoint.remoteAddress).toBe(g.endpoint.localAddress);
  });

  it('guest waits for a host that starts later', async () => {
    const guestOpen = guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 });
    await tick(20);
    await host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 });
    await expect(guestOpen).resolves.toBeDefined();
  });

  it('is unavailable without Wi-Fi', async () => {
    guestNative.wifi = false;
    await expect(guest.isAvailable()).resolves.toBe(false);
    await expectLinkError(guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }), 'unavailable');
    expect(guestNative.calls).not.toContain('acquireLocks');
  });

  it('times out when nobody answers, and cleans up', async () => {
    await expectLinkError(guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 30 }), 'timeout');
    expect(guestNative.discovering).toBeNull();
    await expectLinkError(host.open({ role: 'host', pairId: PAIR, timeoutMs: 30 }), 'timeout');
    expect(hostNative.advertising).toBeNull();
    expect(hostNative.openListeners.size).toBe(0);
  });

  it('runs the open timeout on the injected clock, not on JS timers', async () => {
    // A clock whose timers fire only when the test says so (stands in for the native ride clock).
    const pending = new Map<number, () => void>();
    let nextId = 0;
    const clock = {
      now: () => 1_000,
      setTimeout: (fn: () => void) => {
        pending.set(++nextId, fn);
        return nextId;
      },
      clearTimeout: (handle: unknown) => void pending.delete(handle as number),
    };
    const clocked = createLanTransport(guestNative, { ...CONFIG, clock });
    const opening = clocked.open({ role: 'guest', pairId: PAIR, timeoutMs: 30 });
    await tick(60); // well past 30 ms of real time: nothing happens without the clock
    expect(pending.size).toBe(1);
    expect(guestNative.discovering).not.toBeNull();
    for (const fire of [...pending.values()]) fire();
    await expectLinkError(opening, 'timeout');
    expect(guestNative.discovering).toBeNull();
    expect(pending.size).toBe(0);
    await clocked.dispose();
  });

  it('honours an AbortSignal, before and during open()', async () => {
    const pre = new AbortController();
    pre.abort();
    await expectLinkError(
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000, signal: pre.signal }),
      'aborted',
    );

    const during = new AbortController();
    const opening = host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000, signal: during.signal });
    await tick();
    during.abort();
    await expectLinkError(opening, 'aborted');
    expect(hostNative.advertising).toBeNull();
  });

  it('rejects a hung native connect at the deadline and closes the late connection', async () => {
    await host.open({ role: 'host', pairId: PAIR, timeoutMs: 30 }).catch(() => undefined);
    // Host advertises again; guest's connect never settles.
    const hostOpen = host.open({ role: 'host', pairId: PAIR, timeoutMs: 200 });
    guestNative.connectHangs = true;
    await expectLinkError(guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 40 }), 'timeout');
    await expectLinkError(hostOpen, 'timeout');
  });

  it('maps a refused connect to connect-failed', async () => {
    const hostOpen = host.open({ role: 'host', pairId: PAIR, timeoutMs: 100 });
    guestNative.connectError = 'ERR_LINK_CONNECT';
    await expectLinkError(guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 100 }), 'connect-failed');
    await expectLinkError(hostOpen, 'timeout');
  });

  it('rejects a malformed pair id without touching the native side', async () => {
    await expectLinkError(
      guest.open({ role: 'guest', pairId: 'not valid!', timeoutMs: 100 }),
      'connect-failed',
    );
    expect(guestNative.calls).toEqual([]);
  });

  it('reports close reasons: local, remote and network loss', async () => {
    const [h, g] = await Promise.all([
      host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 }),
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }),
    ]);
    const hostReasons: string[] = [];
    const guestReasons: string[] = [];
    h.onClose((r) => hostReasons.push(r));
    g.onClose((r) => guestReasons.push(r));
    await g.close();
    await tick();
    expect(guestReasons).toEqual(['local-close']); // once, even though native reports it too
    expect(hostReasons).toEqual(['remote-close']);
    await expect(g.send(new Uint8Array([1]))).rejects.toThrow('link closed');

    // A listener added after the close still hears about it.
    const late = await new Promise((resolve) => g.onClose(resolve));
    expect(late).toBe('local-close');

    const [h2, g2] = await Promise.all([
      host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 }),
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }),
    ]);
    const lost = new Promise<[string, string | undefined]>((resolve) =>
      g2.onClose((r, d) => resolve([r, d])),
    );
    guestNative.dropConnection([...guestNative.connections.keys()][0]!);
    await expect(lost).resolves.toEqual(['network-lost', 'local address no longer present']);
    expect(h2).toBeDefined();
  });

  it('buffers data that arrives before the first onData subscriber', async () => {
    const [h, g] = await Promise.all([
      host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 }),
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }),
    ]);
    await g.send(new Uint8Array([7]));
    await g.send(new Uint8Array([8, 9]));
    await tick();
    expect(collect(h)).toEqual([7, 8, 9]);
  });

  it('delivers events that arrive before connect() resolves (orphan buffer)', async () => {
    // Drive the guest transport with hand-made events: data and close for the connection id before connect resolves.
    const native = net.join('10.0.0.5');
    const transport = createLanTransport(native, CONFIG);
    let resolveConnect: (value: Awaited<ReturnType<FakeLinkNative['connect']>>) => void = () => undefined;
    native.connect = () =>
      new Promise((resolve) => {
        resolveConnect = resolve;
      });
    const opening = transport.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 });
    await tick();
    native.emit('onPeer', { kind: 'found', serviceName: `pn-${PAIR}`, host: '10.0.0.9', port: 4000 });
    await tick();
    native.emit('onData', { connectionId: 'early', data: encodeBase64(new Uint8Array([42])) });
    native.emit('onClose', { connectionId: 'early', reason: 'remote-close' });
    await tick();
    resolveConnect({
      connectionId: 'early',
      localAddress: '10.0.0.5',
      remoteAddress: '10.0.0.9',
      interfaceName: 'wlan0',
    });
    const channel = await opening;
    const reasons: string[] = [];
    channel.onClose((r) => reasons.push(r));
    expect(collect(channel)).toEqual([42]); // bytes received before the close still reach the first subscriber
    await tick();
    expect(reasons).toEqual(['remote-close']);
    await transport.dispose();
  });

  it('a new open() supersedes the previous channel', async () => {
    const [h1] = await Promise.all([
      host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 }),
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }),
    ]);
    const reasons: string[] = [];
    h1.onClose((r) => reasons.push(r));
    await Promise.all([
      host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 }),
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }),
    ]);
    expect(reasons[0]).toBe('local-close');
  });

  it('a new open() aborts one still in flight', async () => {
    const first = guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 });
    const second = guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 });
    await expectLinkError(first, 'aborted');
    await host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 });
    await expect(second).resolves.toBeDefined();
  });

  describe('an accept in the same turn as the cancel', () => {
    // Manual clock: the open timeout fires only when the test says so.
    function manualClock() {
      const pending = new Map<number, () => void>();
      let nextId = 0;
      return {
        pending,
        clock: {
          now: () => 1_000,
          setTimeout: (fn: () => void) => {
            pending.set(++nextId, fn);
            return nextId;
          },
          clearTimeout: (handle: unknown) => void pending.delete(handle as number),
        },
      };
    }

    async function hostWaitingForAccept() {
      const native = net.join('10.0.0.7');
      const { pending, clock } = manualClock();
      const transport = createLanTransport(native, { ...CONFIG, clock });
      const opening = transport.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 });
      opening.catch(() => undefined);
      await tick();
      expect(native.advertising).toBe(PAIR);
      const listenerId = [...native.openListeners.keys()][0]!;
      // Delivered synchronously (the fake's emit() defers to a macrotask), so it shares a turn with the cancel.
      const deliverAccept = (connectionId: string) => {
        for (const listener of [...(native.listeners.get('onAccept') ?? [])])
          (listener as (e: unknown) => void)({
            listenerId,
            connectionId,
            localAddress: '10.0.0.7',
            remoteAddress: '10.0.0.8',
            interfaceName: 'wlan0',
          });
      };
      const fireTimeout = () => {
        for (const fire of [...pending.values()]) fire();
      };
      return { native, transport, opening, deliverAccept, fireTimeout };
    }

    it('closes an accepted connection when the timeout fires first', async () => {
      const { native, transport, opening, deliverAccept, fireTimeout } = await hostWaitingForAccept();
      fireTimeout();
      deliverAccept('late-accept');
      await expectLinkError(opening, 'timeout');
      await tick();
      expect(native.calls).toContain('close:late-accept');
      expect(native.openListeners.size).toBe(0);
      await transport.dispose();
    });

    it('adopts or closes, never leaks, when the accept comes first', async () => {
      const { native, transport, opening, deliverAccept, fireTimeout } = await hostWaitingForAccept();
      deliverAccept('early-accept');
      fireTimeout();
      const outcome = await opening.then(
        (channel) => ({ channel }),
        (error: unknown) => ({ error }),
      );
      await tick();
      if ('channel' in outcome) {
        // Adopted: the channel owns the connection and nothing closed it behind its back.
        expect(native.calls).not.toContain('close:early-accept');
        await outcome.channel.close();
      }
      expect(native.calls).toContain('close:early-accept');
      await transport.dispose();
    });
  });

  it('closes a second guest that connects while the host is not listening', async () => {
    const third = createLanTransport(net.join('192.168.1.30'), CONFIG);
    await Promise.all([
      host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 }),
      guest.open({ role: 'guest', pairId: PAIR, timeoutMs: 1000 }),
    ]);
    // The host no longer advertises or listens: an intruder finds nobody.
    await expectLinkError(third.open({ role: 'guest', pairId: PAIR, timeoutMs: 40 }), 'timeout');
    await third.dispose();
  });

  it('dispose() aborts an open, closes the channel, releases native state and unsubscribes', async () => {
    const opening = host.open({ role: 'host', pairId: PAIR, timeoutMs: 1000 });
    await tick();
    await host.dispose();
    await expectLinkError(opening, 'aborted');
    expect(hostNative.calls).toContain('dispose');
    expect(hostNative.listenerCount()).toBe(0);
    await expectLinkError(host.open({ role: 'host', pairId: PAIR, timeoutMs: 100 }), 'unavailable');
    await expect(host.isAvailable()).resolves.toBe(false);
  });

  it('lists interfaces from the native module', async () => {
    await expect(guest.listInterfaces()).resolves.toEqual([
      { name: 'wlan0', kind: 'wifi', addresses: ['192.168.1.20'], up: true, multicast: true },
    ]);
  });
});

describe('toLinkError', () => {
  it.each([
    ['ERR_LINK_NOT_WIFI', 'unavailable'],
    ['ERR_LINK_PERMISSION', 'permission'],
    ['ERR_LINK_NSD', 'discovery-failed'],
    ['ERR_LINK_CONNECT', 'connect-failed'],
    ['ERR_NOT_IMPLEMENTED', 'unsupported'],
    ['ERR_LINK_IO', 'connect-failed'],
  ])('maps %s to %s', (native, code) => {
    const error = toLinkError(Object.assign(new Error('x'), { code: native }), 'connect-failed');
    expect(error).toBeInstanceOf(LinkError);
    expect(error.code).toBe(code);
  });

  it('passes LinkErrors through', () => {
    const original = new LinkError('timeout');
    expect(toLinkError(original, 'connect-failed')).toBe(original);
  });
});

describe('base64', () => {
  it('round-trips every length and byte value', () => {
    for (let length = 0; length < 70; length += 1) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + length) & 255);
      const text = encodeBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(decodeBase64(text))).toEqual(Array.from(bytes));
    }
  });

  it('rejects malformed input', () => {
    for (const bad of ['A', 'AB=C', 'A===', '****', 'AQID\n', 'é123']) {
      expect(() => decodeBase64(bad)).toThrow();
    }
  });
});
