import { LinkError, type LinkChannel } from '../../../platform/link/LinkTransport';
import { ManualClock } from './ManualClock';
import { createInMemoryLinkPair, type InMemoryLinkOptions } from './InMemoryLinkTransport';
import { createSeededUnit } from './seededRandom';

const PAIR = 'pair-1';

function setup(options: Partial<InMemoryLinkOptions> = {}) {
  const clock = new ManualClock();
  const pair = createInMemoryLinkPair({ clock, ...options });
  const openHost = (timeoutMs = 10_000, signal?: AbortSignal): Promise<LinkChannel> =>
    pair.host.open({ role: 'host', pairId: PAIR, timeoutMs, signal });
  const openGuest = (timeoutMs = 10_000, signal?: AbortSignal): Promise<LinkChannel> =>
    pair.guest.open({ role: 'guest', pairId: PAIR, timeoutMs, signal });
  return { clock, ...pair, openHost, openGuest };
}

async function connect(env: ReturnType<typeof setup>): Promise<{ host: LinkChannel; guest: LinkChannel }> {
  const hostP = env.openHost();
  const guestP = env.openGuest();
  await env.clock.settle();
  return { host: await hostP, guest: await guestP };
}

function collect(channel: LinkChannel): { chunks: Uint8Array[]; closes: string[]; bytes: () => number[] } {
  const chunks: Uint8Array[] = [];
  const closes: string[] = [];
  channel.onData((d) => chunks.push(d));
  channel.onClose((reason) => closes.push(reason));
  return { chunks, closes, bytes: () => chunks.flatMap((c) => [...c]) };
}

describe('rendezvous', () => {
  it('connects a host that opened first and a guest that opened second, with matching endpoints', async () => {
    const env = setup();
    const hostP = env.openHost();
    await env.clock.settle();
    expect(env.hub.waitingOpens).toBe(1);
    const guestP = env.openGuest();
    const [host, guest] = [await hostP, await guestP];
    expect(host.endpoint).toMatchObject({
      kind: 'memory',
      localAddress: '10.0.0.1',
      remoteAddress: '10.0.0.2',
    });
    expect(guest.endpoint).toMatchObject({
      kind: 'memory',
      localAddress: '10.0.0.2',
      remoteAddress: '10.0.0.1',
    });
    expect(env.hub.waitingOpens).toBe(0);
    expect(env.hub.channelsOpened).toBe(1);
    expect(env.host.kind).toBe('memory');
  });

  it('works in the other order too', async () => {
    const env = setup();
    const guestP = env.openGuest();
    await env.clock.settle();
    const hostP = env.openHost();
    await expect(Promise.all([hostP, guestP])).resolves.toHaveLength(2);
  });

  it('does not connect different pair ids', async () => {
    const env = setup();
    const hostP = env.host.open({ role: 'host', pairId: 'a', timeoutMs: 1000 });
    const guestP = env.guest.open({ role: 'guest', pairId: 'b', timeoutMs: 1000 });
    const results = Promise.allSettled([hostP, guestP]);
    await env.clock.advance(1000);
    const [h, g] = await results;
    expect(h.status).toBe('rejected');
    expect(g.status).toBe('rejected');
    expect((h as PromiseRejectedResult).reason).toMatchObject({ name: 'LinkError', code: 'timeout' });
  });

  it('rejects with LinkError(timeout) when no partner shows up within timeoutMs, and not before', async () => {
    const env = setup();
    const result = env.openHost(5000).then(
      () => 'connected',
      (error: unknown) => error,
    );
    await env.clock.advance(4999);
    expect(env.hub.waitingOpens).toBe(1);
    await env.clock.advance(1);
    const error = await result;
    expect(error).toBeInstanceOf(LinkError);
    expect((error as LinkError).code).toBe('timeout');
    expect(env.hub.waitingOpens).toBe(0);
    expect(env.clock.pendingTimers()).toBe(0);
  });

  it('honours an AbortSignal, before and during the wait', async () => {
    const env = setup();
    const early = new AbortController();
    early.abort();
    await expect(env.openHost(1000, early.signal)).rejects.toMatchObject({ code: 'aborted' });

    const late = new AbortController();
    const pending = env.openGuest(60_000, late.signal);
    await env.clock.settle();
    late.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(env.hub.waitingOpens).toBe(0);
    expect(env.clock.pendingTimers()).toBe(0);
  });

  it('counts open calls per side', async () => {
    const env = setup();
    await connect(env);
    expect(env.host.openCalls).toBe(1);
    expect(env.guest.openCalls).toBe(1);
    expect(env.hub.openCount('host')).toBe(1);
  });
});

describe('byte delivery', () => {
  it('delivers in order and asynchronously, and copies the sender buffer', async () => {
    const env = setup();
    const { host, guest } = await connect(env);
    const received = collect(guest);
    const buffer = new Uint8Array([1, 2, 3]);
    const first = host.send(buffer);
    buffer.fill(9); // the sender reuses its buffer
    expect(received.chunks).toHaveLength(0); // delivery is never synchronous
    await first;
    await host.send(new Uint8Array([4, 5]));
    await env.clock.settle();
    expect(received.bytes()).toEqual([1, 2, 3, 4, 5]);
  });

  it('applies the one-way latency on the injected clock and keeps the order', async () => {
    const env = setup({ latencyMs: 40 });
    const { host, guest } = await connect(env);
    const received = collect(guest);
    await host.send(new Uint8Array([1]));
    await env.clock.advance(20);
    await host.send(new Uint8Array([2]));
    await env.clock.advance(19);
    expect(received.bytes()).toEqual([]);
    await env.clock.advance(1);
    expect(received.bytes()).toEqual([1]);
    await env.clock.advance(20);
    expect(received.bytes()).toEqual([1, 2]);
  });

  it('cuts a send into fixed-size chunks', async () => {
    const env = setup({ chunking: { mode: 'fixed', size: 3 } });
    const { host, guest } = await connect(env);
    const received = collect(guest);
    await host.send(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
    await env.clock.settle();
    expect(received.chunks.map((c) => c.length)).toEqual([3, 3, 1]);
    expect(received.bytes()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('cuts at seeded random boundaries without losing or reordering a byte, and reproducibly', async () => {
    const run = async (): Promise<{ sizes: number[]; same: boolean }> => {
      const env = setup({ chunking: { mode: 'random', min: 1, max: 9, seed: 11 } });
      const { host, guest } = await connect(env);
      const received = collect(guest);
      const unit = createSeededUnit(3);
      const sent: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        const piece = new Uint8Array(Math.floor(unit() * 40) + 1).map(() => Math.floor(unit() * 256));
        sent.push(...piece);
        await host.send(piece);
      }
      await env.clock.settle();
      return {
        sizes: received.chunks.map((c) => c.length),
        same: JSON.stringify(received.bytes()) === JSON.stringify(sent),
      };
    };
    const first = await run();
    const second = await run();
    expect(first.same).toBe(true);
    expect(first.sizes.every((size) => size >= 1 && size <= 9)).toBe(true);
    expect(first.sizes.length).toBeGreaterThan(60);
    expect(second.sizes).toEqual(first.sizes);
  });

  it('with coalesce, sends from one tick arrive as a single chunk (several frames in one read)', async () => {
    const env = setup({ coalesce: true });
    const { host, guest } = await connect(env);
    const received = collect(guest);
    await Promise.all([
      host.send(new Uint8Array([1, 2])),
      host.send(new Uint8Array([3])),
      host.send(new Uint8Array([4, 5, 6])),
    ]);
    await env.clock.settle();
    expect(received.chunks.map((c) => [...c])).toEqual([[1, 2, 3, 4, 5, 6]]);
    await host.send(new Uint8Array([7]));
    await env.clock.settle();
    expect(received.chunks).toHaveLength(2);
  });

  it('can be reconfigured while running', async () => {
    const env = setup();
    const { host, guest } = await connect(env);
    const received = collect(guest);
    env.hub.setChunking({ mode: 'fixed', size: 1 });
    await host.send(new Uint8Array([1, 2, 3]));
    await env.clock.settle();
    expect(received.chunks).toHaveLength(3);
    env.hub.setLatency(10);
    await host.send(new Uint8Array([4]));
    await env.clock.settle();
    expect(received.bytes()).toEqual([1, 2, 3]);
    await env.clock.advance(10);
    expect(received.bytes()).toEqual([1, 2, 3, 4]);
  });
});

describe('closing', () => {
  it('a local close tells the owner local-close and the partner remote-close, after the data in flight', async () => {
    const env = setup({ latencyMs: 10 });
    const { host, guest } = await connect(env);
    const mine = collect(host);
    const theirs = collect(guest);
    await host.send(new Uint8Array([1, 2, 3]));
    await host.close();
    await env.clock.settle();
    expect(mine.closes).toEqual(['local-close']);
    expect(theirs.closes).toEqual([]);
    await env.clock.advance(10);
    expect(theirs.bytes()).toEqual([1, 2, 3]);
    expect(theirs.closes).toEqual(['remote-close']);
    await expect(guest.send(new Uint8Array([9]))).rejects.toThrow(/closed/);
    await expect(host.send(new Uint8Array([9]))).rejects.toThrow(/closed/);
  });

  it('close is idempotent and never fires a listener twice', async () => {
    const env = setup();
    const { host, guest } = await connect(env);
    const mine = collect(host);
    const theirs = collect(guest);
    await host.close();
    await host.close();
    await guest.close();
    await env.clock.settle();
    expect(mine.closes).toEqual(['local-close']);
    expect(theirs.closes).toHaveLength(1);
  });

  it('dropLink cuts both ends at once with the reason, loses what is in flight, and the next open connects again', async () => {
    const env = setup({ latencyMs: 50 });
    const { host, guest } = await connect(env);
    const mine = collect(host);
    const theirs = collect(guest);
    await host.send(new Uint8Array([1, 2, 3]));
    env.hub.dropLink('io-error');
    await env.clock.settle();
    expect(mine.closes).toEqual(['io-error']);
    expect(theirs.closes).toEqual(['io-error']);
    await env.clock.advance(100);
    expect(theirs.bytes()).toEqual([]);
    expect(env.hub.liveChannels()).toBeNull();
    const again = await connect(env);
    expect(again.host).not.toBe(host);
    expect(env.hub.channelsOpened).toBe(2);
  });

  it('a network outage closes live links with network-lost and holds new opens until it ends', async () => {
    const env = setup();
    const { host, guest } = await connect(env);
    const mine = collect(host);
    const theirs = collect(guest);
    env.network.setUp(false);
    await env.clock.settle();
    expect(mine.closes).toEqual(['network-lost']);
    expect(theirs.closes).toEqual(['network-lost']);
    await expect(env.host.isAvailable()).resolves.toBe(false);

    let connected = 0;
    void env.openHost().then(() => (connected += 1));
    void env.openGuest().then(() => (connected += 1));
    await env.clock.advance(5000);
    expect(connected).toBe(0);
    expect(env.hub.waitingOpens).toBe(2);
    env.network.setUp(true);
    await env.clock.settle();
    expect(connected).toBe(2);
    await expect(env.host.isAvailable()).resolves.toBe(true);
  });

  it('whenDown "unavailable" makes open() fail at once instead of waiting', async () => {
    const env = setup({ whenDown: 'unavailable' });
    env.network.setUp(false);
    await expect(env.openGuest()).rejects.toMatchObject({ code: 'unavailable' });
    expect(env.hub.waitingOpens).toBe(0);
  });

  it('a black hole swallows bytes and the FIN without any close event, so only heartbeats can notice', async () => {
    const env = setup();
    const { host, guest } = await connect(env);
    const mine = collect(host);
    const theirs = collect(guest);
    env.network.setBlackhole(true);
    await host.send(new Uint8Array([1, 2, 3]));
    await host.close();
    await env.clock.advance(60_000);
    expect(theirs.bytes()).toEqual([]);
    expect(theirs.closes).toEqual([]);
    expect(mine.closes).toEqual(['local-close']);
  });
});

describe('injected failures, disposal and interfaces', () => {
  it('failNextOpen fails exactly the next open of that role, in order', async () => {
    const env = setup();
    env.hub.failNextOpen('guest', new LinkError('connect-failed', 'refused'));
    await expect(env.openGuest()).rejects.toMatchObject({ code: 'connect-failed' });
    const hostP = env.openHost();
    const guestP = env.openGuest();
    await expect(Promise.all([hostP, guestP])).resolves.toHaveLength(2);
  });

  it('failNextOpen with a delay rejects only after that much clock time', async () => {
    const env = setup();
    env.hub.failNextOpen('host', new LinkError('discovery-failed'), 300);
    const result = env.openHost().then(
      () => 'ok',
      (error: unknown) => (error as LinkError).code,
    );
    await env.clock.advance(299);
    let settled = false;
    void result.then(() => (settled = true));
    await env.clock.settle();
    expect(settled).toBe(false);
    await env.clock.advance(1);
    await expect(result).resolves.toBe('discovery-failed');
  });

  it('failOpens fails every open until cleared', async () => {
    const env = setup();
    env.hub.failOpens('host', new LinkError('unavailable'));
    await expect(env.openHost()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(env.openHost()).rejects.toMatchObject({ code: 'unavailable' });
    env.hub.failOpens('host', null);
    const hostP = env.openHost();
    const guestP = env.openGuest();
    await expect(Promise.all([hostP, guestP])).resolves.toHaveLength(2);
  });

  it('dispose rejects the transport pending opens, closes its channel, and makes it unusable', async () => {
    const env = setup();
    const pending = env.openGuest(60_000);
    await env.clock.settle();
    await env.guest.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    await expect(env.openGuest()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(env.guest.isAvailable()).resolves.toBe(false);

    const env2 = setup();
    const { host, guest } = await connect(env2);
    const theirs = collect(guest);
    void host;
    await env2.host.dispose();
    await env2.clock.settle();
    expect(theirs.closes).toEqual(['remote-close']);
    await env2.host.dispose(); // idempotent
  });

  it('exposes a plausible interface list for diagnostics', async () => {
    const env = setup();
    const interfaces = await env.host.listInterfaces();
    expect(interfaces).toEqual([
      { name: 'mem0', kind: 'other', addresses: ['10.0.0.1'], up: true, multicast: true },
    ]);
    env.network.setUp(false);
    expect((await env.guest.listInterfaces())[0]?.up).toBe(false);
  });

  it('liveChannels exposes the raw ends for injecting bytes as if the partner had sent them', async () => {
    const env = setup();
    const { guest } = await connect(env);
    const received = collect(guest);
    env.hub.liveChannels()?.guest.injectIncoming(new Uint8Array([7, 7]));
    expect(received.bytes()).toEqual([7, 7]);
  });
});
