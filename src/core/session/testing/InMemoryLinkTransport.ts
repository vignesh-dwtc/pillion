import {
  LinkError,
  type LinkChannel,
  type LinkEndpoint,
  type LinkKind,
  type LinkNetworkInterface,
  type LinkOpenOptions,
  type LinkRole,
  type LinkTransport,
} from '../../../platform/link/LinkTransport';
import type { Clock, TimerHandle, Unsubscribe } from '../../common/types';
import { FakeNetwork } from './FakeNetwork';
import { createSeededUnit } from './seededRandom';

/**
 * In-memory `LinkTransport` pair (host side and guest side) that behaves like the real byte pipes the app will
 * run on, including the unpleasant parts:
 *
 *  - rendezvous: a host `open()` waits for a guest `open()` with the same pair id (NSD discovery + connect), either
 *    order, bounded by `timeoutMs` and `signal` like a real transport;
 *  - delivery is ordered and reliable but asynchronous, with a configurable one-way latency (on the injected clock),
 *    and arbitrary chunk boundaries: each send can be cut into fixed or seeded-random pieces, and sends made in
 *    the same tick can be merged into one chunk (several frames in one read);
 *  - the link can be cut on command (`dropLink`, `hub.network.setUp(false)`) with the close reason a platform
 *    would report, restored, or silently black-holed (a half-open connection that only heartbeats can detect);
 *  - failures can be injected per role (`failNextOpen`, `failOpens`).
 *
 * No real timers: latency and open timeouts use the injected Clock (a ManualClock in the simulation).
 */

export type ChunkingMode =
  | { mode: 'whole' }
  | { mode: 'fixed'; size: number }
  | { mode: 'random'; min: number; max: number; seed: number };

export interface InMemoryLinkOptions {
  clock: Clock;
  /** Shared with the fake media path so one switch takes both down. A private network when omitted. */
  network?: FakeNetwork;
  /** One-way delivery delay per chunk, in ms. Default 0 (asynchronous, but within the same instant). */
  latencyMs?: number;
  chunking?: ChunkingMode;
  /** Merge everything sent in one tick into a single chunk before cutting it. Default false. */
  coalesce?: boolean;
  /**
   * What `open()` does while the network is down: 'wait' (discovery just never finds the partner; the call ends
   * by timeout or when the network returns) or 'unavailable' (rejects at once, like LAN without Wi-Fi).
   */
  whenDown?: 'wait' | 'unavailable';
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** One direction of a link: a FIFO of deliveries, each due at a time on the injected clock. */
class Wire {
  private queue: { due: number; run: () => void }[] = [];
  private scheduled = false;
  private timer: TimerHandle | null = null;
  private generation = 0;

  constructor(
    private readonly clock: Clock,
    private readonly latency: () => number,
  ) {}

  push(run: () => void): void {
    this.queue.push({ due: this.clock.now() + Math.max(0, this.latency()), run });
    this.kick();
  }

  /** Drops everything in flight (a connection reset). */
  clear(): void {
    this.queue = [];
    this.scheduled = false;
    this.generation += 1;
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get inFlight(): number {
    return this.queue.length;
  }

  private kick(): void {
    if (this.scheduled) return;
    const head = this.queue[0];
    if (!head) return;
    this.scheduled = true;
    const generation = this.generation;
    const wait = head.due - this.clock.now();
    if (wait <= 0) {
      void Promise.resolve().then(() => {
        if (generation === this.generation) this.drain();
      });
    } else {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        if (generation === this.generation) this.drain();
      }, wait);
    }
  }

  private drain(): void {
    this.scheduled = false;
    for (;;) {
      const head = this.queue[0];
      if (!head || head.due > this.clock.now()) break;
      this.queue.shift();
      head.run();
    }
    this.kick();
  }
}

/** One end of an in-memory link channel. `injectIncoming` lets a test play the partner's raw bytes. */
export class InMemoryChannel implements LinkChannel {
  readonly endpoint: LinkEndpoint;
  peer!: InMemoryChannel;
  bytesSent = 0;
  bytesReceived = 0;

  private closedFlag = false;
  private outbox: Uint8Array[] = [];
  private readonly dataListeners = new Set<(data: Uint8Array) => void>();
  private readonly closeListeners = new Set<(reason: string, detail?: string) => void>();

  constructor(
    private readonly hub: InMemoryLinkHub,
    readonly side: LinkRole,
    readonly wire: Wire,
    localAddress: string,
    remoteAddress: string,
  ) {
    this.endpoint = {
      kind: 'memory',
      localAddress,
      remoteAddress,
      interfaceName: 'mem0',
    };
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  send(data: Uint8Array): Promise<void> {
    if (this.closedFlag) return Promise.reject(new Error('link channel is closed'));
    const bytes = new Uint8Array(data); // the caller may reuse its buffer
    this.bytesSent += bytes.length;
    if (this.hub.network.isBlackholed) return Promise.resolve();
    if (this.hub.coalesce) {
      this.outbox.push(bytes);
      if (this.outbox.length === 1) {
        void Promise.resolve().then(() => this.flushOutbox());
      }
    } else {
      this.transmit(bytes);
    }
    return Promise.resolve();
  }

  onData(listener: (data: Uint8Array) => void): Unsubscribe {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onClose(listener: (reason: string, detail?: string) => void): Unsubscribe {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /** Local close: our listeners hear 'local-close', the peer hears 'remote-close' after the data in flight. */
  close(): Promise<void> {
    if (this.closedFlag) return Promise.resolve();
    this.flushOutbox();
    this.closedFlag = true;
    this.hub.record(`${this.side} closed its end`);
    this.announceClose('local-close');
    // A black-holed link cannot carry the FIN either: the partner only finds out through its heartbeat.
    if (!this.hub.network.isBlackholed) {
      const peer = this.peer;
      this.wire.push(() => peer.receiveClose('remote-close'));
    }
    return Promise.resolve();
  }

  /** Cut by the network: both ends close at once, in-flight bytes are lost. */
  cut(reason: string): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.outbox = [];
    this.wire.clear();
    this.announceClose(reason);
  }

  /** Test hook: bytes that arrive at this end as if the partner had sent them (bypasses latency and chunking). */
  injectIncoming(data: Uint8Array): void {
    this.deliver(new Uint8Array(data));
  }

  deliver(chunk: Uint8Array): void {
    if (this.closedFlag) return;
    this.bytesReceived += chunk.length;
    for (const listener of [...this.dataListeners]) listener(chunk);
  }

  receiveClose(reason: string): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.hub.record(`${this.side} saw the link close (${reason})`);
    this.announceClose(reason);
  }

  private flushOutbox(): void {
    if (this.outbox.length === 0) return;
    const merged = concat(this.outbox);
    this.outbox = [];
    if (!this.closedFlag) this.transmit(merged);
  }

  private transmit(bytes: Uint8Array): void {
    for (const chunk of this.hub.cut(bytes)) {
      const peer = this.peer;
      this.wire.push(() => peer.deliver(chunk));
    }
  }

  /** Listeners hear about a close asynchronously, like a native event, never inside close() itself. */
  private announceClose(reason: string): void {
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    this.dataListeners.clear();
    void Promise.resolve().then(() => {
      for (const listener of listeners) listener(reason);
    });
  }
}

interface Waiter {
  transport: InMemoryLinkTransport;
  role: LinkRole;
  pairId: string;
  resolve: (channel: LinkChannel) => void;
  reject: (error: unknown) => void;
  timer: TimerHandle | null;
  detachAbort: (() => void) | null;
}

interface InjectedFailure {
  error: unknown;
  /** Reject only after this many ms (a slow failure) instead of at once. */
  afterMs: number;
}

/**
 * Shared state of one host/guest pair and its control surface for tests.
 */
export class InMemoryLinkHub {
  readonly network: FakeNetwork;
  /** Chronological notes for failure messages (capped). */
  readonly events: string[] = [];

  latencyMs: number;
  coalesce: boolean;

  private chunking: ChunkingMode;
  private randomUnit: () => number = () => 0;
  private readonly whenDown: 'wait' | 'unavailable';
  private waiting: Waiter[] = [];
  private live: [InMemoryChannel, InMemoryChannel][] = [];
  private readonly failures = new Map<LinkRole, InjectedFailure[]>();
  private readonly persistentFailures = new Map<LinkRole, unknown>();
  private readonly opens: Record<LinkRole, number> = { host: 0, guest: 0 };
  /** Virtual time of every open() call per role: the backoff schedule can be asserted from it. */
  readonly openTimes: Record<LinkRole, number[]> = { host: [], guest: [] };
  private opened = 0;

  constructor(
    readonly clock: Clock,
    options: InMemoryLinkOptions,
  ) {
    this.network = options.network ?? new FakeNetwork();
    this.latencyMs = options.latencyMs ?? 0;
    this.coalesce = options.coalesce ?? false;
    this.whenDown = options.whenDown ?? 'wait';
    this.chunking = { mode: 'whole' };
    this.setChunking(options.chunking ?? { mode: 'whole' });
    this.network.onChange(() => {
      if (!this.network.isUp) this.dropLink('network-lost');
      else this.tryMatch();
    });
  }

  // ---- control surface --------------------------------------------------------------------------------

  setLatency(ms: number): void {
    this.latencyMs = Math.max(0, ms);
  }

  setChunking(mode: ChunkingMode): void {
    this.chunking = mode;
    if (mode.mode === 'random') this.randomUnit = createSeededUnit(mode.seed);
  }

  /** Cuts the current link (both ends close with `reason`); the next open() can connect again at once. */
  dropLink(reason: 'network-lost' | 'io-error' | 'timeout' = 'network-lost'): void {
    this.record(`link dropped (${reason})`);
    for (const [a, b] of this.live) {
      a.cut(reason);
      b.cut(reason);
    }
    this.live = [];
  }

  /** The live channel ends, for tests that inject or inspect raw bytes. Null when there is no link. */
  liveChannels(): { host: InMemoryChannel; guest: InMemoryChannel } | null {
    for (const [a, b] of this.live) {
      if (a.closed || b.closed) continue;
      return a.side === 'host' ? { host: a, guest: b } : { host: b, guest: a };
    }
    return null;
  }

  /** Makes the next open() of `role` fail with `error` (once, in call order). */
  failNextOpen(role: LinkRole, error: unknown, afterMs = 0): void {
    const queue = this.failures.get(role) ?? [];
    queue.push({ error, afterMs });
    this.failures.set(role, queue);
  }

  /** Makes every open() of `role` fail with `error` until cleared with null. */
  failOpens(role: LinkRole, error: unknown | null): void {
    if (error === null) this.persistentFailures.delete(role);
    else this.persistentFailures.set(role, error);
  }

  openCount(role: LinkRole): number {
    return this.opens[role];
  }

  get channelsOpened(): number {
    return this.opened;
  }

  get waitingOpens(): number {
    return this.waiting.length;
  }

  /** Chunks still travelling in either direction. */
  get inFlight(): number {
    return this.live.reduce((sum, [a, b]) => sum + a.wire.inFlight + b.wire.inFlight, 0);
  }

  record(note: string): void {
    this.events.push(`t=${this.clock.now()} ${note}`);
    if (this.events.length > 200) this.events.shift();
  }

  // ---- internals --------------------------------------------------------------------------------------

  cut(bytes: Uint8Array): Uint8Array[] {
    const mode = this.chunking;
    if (mode.mode === 'whole' || bytes.length === 0) return [bytes];
    const pieces: Uint8Array[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      let size: number;
      if (mode.mode === 'fixed') {
        size = Math.max(1, Math.floor(mode.size));
      } else {
        const min = Math.max(1, Math.floor(mode.min));
        const max = Math.max(min, Math.floor(mode.max));
        size = min + Math.floor(this.randomUnit() * (max - min + 1));
      }
      pieces.push(bytes.slice(offset, offset + size));
      offset += size;
    }
    return pieces;
  }

  open(transport: InMemoryLinkTransport, options: LinkOpenOptions): Promise<LinkChannel> {
    this.opens[options.role] += 1;
    this.openTimes[options.role].push(this.clock.now());
    this.record(`${options.role} open() #${this.opens[options.role]}`);
    const { role } = options;
    return new Promise<LinkChannel>((resolve, reject) => {
      if (transport.disposed) {
        reject(new LinkError('unavailable', 'transport disposed'));
        return;
      }
      if (options.signal?.aborted) {
        reject(new LinkError('aborted', 'open aborted before it started'));
        return;
      }
      const persistent = this.persistentFailures.get(role);
      if (persistent !== undefined) {
        reject(persistent);
        return;
      }
      const injected = this.failures.get(role)?.shift();
      if (injected) {
        if (injected.afterMs <= 0) reject(injected.error);
        else this.clock.setTimeout(() => reject(injected.error), injected.afterMs);
        return;
      }
      if (!this.network.isUp && this.whenDown === 'unavailable') {
        reject(new LinkError('unavailable', 'network is down'));
        return;
      }

      const waiter: Waiter = {
        transport,
        role,
        pairId: options.pairId,
        resolve,
        reject,
        timer: null,
        detachAbort: null,
      };
      waiter.timer = this.clock.setTimeout(() => {
        waiter.timer = null;
        this.settleWaiter(waiter, () =>
          reject(new LinkError('timeout', `no partner within ${options.timeoutMs} ms`)),
        );
      }, options.timeoutMs);
      const signal = options.signal;
      if (signal) {
        const onAbort = (): void => {
          this.settleWaiter(waiter, () => reject(new LinkError('aborted', 'open aborted')));
        };
        signal.addEventListener('abort', onAbort);
        waiter.detachAbort = () => signal.removeEventListener('abort', onAbort);
      }
      this.waiting.push(waiter);
      this.tryMatch();
    });
  }

  /** Called when the owning transport is disposed: pending opens end, its live channel closes. */
  disposeSide(transport: InMemoryLinkTransport): void {
    for (const waiter of [...this.waiting]) {
      if (waiter.transport === transport) {
        this.settleWaiter(waiter, () => waiter.reject(new LinkError('aborted', 'transport disposed')));
      }
    }
    for (const [a, b] of this.live) {
      const mine = a.side === transport.side ? a : b;
      if (!mine.closed) void mine.close();
    }
  }

  private settleWaiter(waiter: Waiter, action: () => void): void {
    const index = this.waiting.indexOf(waiter);
    if (index < 0) return;
    this.waiting.splice(index, 1);
    if (waiter.timer !== null) this.clock.clearTimeout(waiter.timer);
    waiter.detachAbort?.();
    action();
  }

  private tryMatch(): void {
    while (this.matchOnce()) {
      // keep pairing while there are host and guest opens waiting for each other
    }
  }

  private matchOnce(): boolean {
    if (!this.network.isUp) return false;
    for (const hostWaiter of this.waiting.filter((w) => w.role === 'host')) {
      const guestWaiter = this.waiting.find((w) => w.role === 'guest' && w.pairId === hostWaiter.pairId);
      if (!guestWaiter) continue;
      this.settleWaiter(hostWaiter, () => undefined);
      this.settleWaiter(guestWaiter, () => undefined);
      const hostToGuest = new Wire(this.clock, () => this.latencyMs);
      const guestToHost = new Wire(this.clock, () => this.latencyMs);
      const hostEnd = new InMemoryChannel(this, 'host', hostToGuest, '10.0.0.1', '10.0.0.2');
      const guestEnd = new InMemoryChannel(this, 'guest', guestToHost, '10.0.0.2', '10.0.0.1');
      hostEnd.peer = guestEnd;
      guestEnd.peer = hostEnd;
      this.live = this.live.filter(([a, b]) => !(a.closed && b.closed));
      this.live.push([hostEnd, guestEnd]);
      this.opened += 1;
      this.record(`link established #${this.opened}`);
      hostWaiter.resolve(hostEnd);
      guestWaiter.resolve(guestEnd);
      return true;
    }
    return false;
  }
}

export class InMemoryLinkTransport implements LinkTransport {
  readonly kind: LinkKind = 'memory';
  disposed = false;

  constructor(
    private readonly hub: InMemoryLinkHub,
    readonly side: LinkRole,
  ) {}

  /** Number of open() calls made on this side. */
  get openCalls(): number {
    return this.hub.openCount(this.side);
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(!this.disposed && this.hub.network.isUp);
  }

  open(options: LinkOpenOptions): Promise<LinkChannel> {
    return this.hub.open(this, options);
  }

  listInterfaces(): Promise<LinkNetworkInterface[]> {
    return Promise.resolve([
      {
        name: 'mem0',
        kind: 'other',
        addresses: [this.side === 'host' ? '10.0.0.1' : '10.0.0.2'],
        up: this.hub.network.isUp,
        multicast: true,
      },
    ]);
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    this.hub.record(`${this.side} transport disposed`);
    this.hub.disposeSide(this);
    return Promise.resolve();
  }
}

export interface InMemoryLinkPair {
  host: InMemoryLinkTransport;
  guest: InMemoryLinkTransport;
  hub: InMemoryLinkHub;
  network: FakeNetwork;
}

export function createInMemoryLinkPair(options: InMemoryLinkOptions): InMemoryLinkPair {
  const hub = new InMemoryLinkHub(options.clock, options);
  return {
    host: new InMemoryLinkTransport(hub, 'host'),
    guest: new InMemoryLinkTransport(hub, 'guest'),
    hub,
    network: hub.network,
  };
}
