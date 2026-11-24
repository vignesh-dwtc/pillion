/**
 * LanTransport: LinkTransport over the native IntercomLink module (specs/IntercomLink.ts): NSD/mDNS + TCP on a shared
 * Wi-Fi network.
 *
 *   host  : isWifiConnected -> acquireLocks -> listen(port 0) -> startAdvertising(pairId, port) -> first onAccept
 *   guest : isWifiConnected -> acquireLocks -> startDiscovery(pairId) -> first resolved onPeer -> connect(host, port)
 *
 * After every attempt (success or failure) the advertisement, listener and discovery are torn down: the channel that was
 * accepted or connected lives on by itself, and the next open() starts from scratch (one peer at a time, no stale
 * listeners). open() honours `timeoutMs` (LinkError 'timeout') and `signal` (LinkError 'aborted'); a native resource that
 * arrives after the attempt was cancelled is closed again. A new open() supersedes the previous channel (closed with
 * 'local-close') and any open() still in flight (LinkError 'aborted').
 *
 * Native events reach JS independently of promise results, so a connection's first `onData` (or even `onClose`) can
 * arrive before `connect()` resolves: those are buffered per connection id (bounded) and handed to the channel.
 * The Wi-Fi locks are taken on the first open() and released by dispose(); the multicast lock is held natively only while
 * advertising or discovering (both stop after every attempt).
 * The open timeout runs on `config.clock` (the native ride clock from createLinkTransport: JS timers stop with the
 * screen off).
 *
 * No product names here: the service type comes from config/identity.json through createLinkTransport.ts.
 */
import type {
  IntercomLinkEvents,
  LinkAcceptEvent,
  LinkPeerEvent,
  NativeConnection,
  NativeNetworkInterface,
} from '../../../specs/IntercomLink';
import { systemClock, type Clock, type Unsubscribe } from '../../core/common/types';
import { decodeBase64, encodeBase64 } from './base64';
import {
  LinkError,
  type LinkChannel,
  type LinkCloseReason,
  type LinkEndpoint,
  type LinkErrorCode,
  type LinkNetworkInterface,
  type LinkOpenOptions,
  type LinkTransport,
} from './LinkTransport';

/** The part of IntercomLinkNativeModule this wrapper uses (the real module satisfies it; tests pass a fake). */
export interface LinkNativeModule {
  isWifiConnected(): Promise<boolean>;
  listInterfaces(): Promise<NativeNetworkInterface[]>;
  acquireLocks(): Promise<void>;
  releaseLocks(): Promise<void>;
  startAdvertising(options: {
    serviceType: string;
    pairId: string;
    serviceNamePrefix?: string;
    port: number;
  }): Promise<{ registeredName: string }>;
  stopAdvertising(): Promise<void>;
  startDiscovery(options: { serviceType: string; pairId: string; serviceNamePrefix?: string }): Promise<void>;
  stopDiscovery(): Promise<void>;
  listen(options: { port: number }): Promise<{
    listenerId: string;
    port: number;
    localAddress: string | null;
    interfaceName: string | null;
  }>;
  stopListening(listenerId: string): Promise<void>;
  connect(options: { host: string; port: number; timeoutMs: number }): Promise<NativeConnection>;
  send(connectionId: string, dataBase64: string): Promise<void>;
  close(connectionId: string): Promise<void>;
  dispose(): Promise<void>;
  addListener<E extends keyof IntercomLinkEvents>(
    eventName: E,
    listener: IntercomLinkEvents[E],
  ): { remove(): void };
}

export interface LanTransportConfig {
  /** NSD service type, e.g. `_pillion._tcp` (config/identity.json `nsdServiceType`). */
  serviceType: string;
  /** Timers and time for the open timeout and connect deadline. Default: systemClock. */
  clock?: Clock;
  /** Service-name prefix; the native default (`pn-`) when omitted. */
  serviceNamePrefix?: string;
}

const PAIR_ID = /^[A-Za-z0-9_-]{1,48}$/;
/** Lower bound for the native connect timeout (the native side clamps too). */
const MIN_CONNECT_TIMEOUT_MS = 100;
/** Orphan buffers: events for connection ids no channel has claimed yet. */
const MAX_ORPHAN_IDS = 8;
const MAX_ORPHAN_BYTES = 256 * 1024;
const MAX_PENDING_ACCEPTS = 4;
const MAX_RETIRED_LISTENERS = 32;

const CLOSE_REASONS: readonly LinkCloseReason[] = [
  'local-close',
  'remote-close',
  'io-error',
  'timeout',
  'network-lost',
  'aborted',
];

type CloseListener = (reason: LinkCloseReason | string, detail?: string) => void;

/** Maps a native rejection (`code` from CodedException) to a LinkError. LinkErrors pass through. */
export function toLinkError(error: unknown, fallback: LinkErrorCode): LinkError {
  if (error instanceof LinkError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'ERR_LINK_NOT_WIFI':
      return new LinkError('unavailable', message);
    case 'ERR_LINK_PERMISSION':
      return new LinkError('permission', message);
    case 'ERR_LINK_NSD':
      return new LinkError('discovery-failed', message);
    case 'ERR_LINK_CONNECT':
      return new LinkError('connect-failed', message);
    case 'ERR_NOT_IMPLEMENTED':
      return new LinkError('unsupported', message);
    default:
      return new LinkError(fallback, message);
  }
}

class NativeLinkChannel implements LinkChannel {
  readonly endpoint: LinkEndpoint;
  private readonly dataListeners = new Set<(data: Uint8Array) => void>();
  private readonly closeListeners = new Set<CloseListener>();
  /** Bytes that arrived before the first onData() subscriber; flushed in order to the first subscriber. */
  private backlog: Uint8Array[] | null = [];
  private closedWith: { reason: LinkCloseReason; detail?: string } | null = null;

  constructor(
    private readonly native: LinkNativeModule,
    readonly connectionId: string,
    connection: NativeConnection,
    private readonly onFinished: (channel: NativeLinkChannel) => void,
  ) {
    this.endpoint = {
      kind: 'lan',
      localAddress: connection.localAddress,
      remoteAddress: connection.remoteAddress,
      interfaceName: connection.interfaceName,
    };
  }

  get closed(): boolean {
    return this.closedWith !== null;
  }

  send(data: Uint8Array): Promise<void> {
    if (this.closedWith !== null) return Promise.reject(new Error('link closed'));
    return this.native.send(this.connectionId, encodeBase64(data)).catch((error: unknown) => {
      throw new Error(`link send failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  onData(listener: (data: Uint8Array) => void): Unsubscribe {
    this.dataListeners.add(listener);
    if (this.backlog !== null) {
      const pending = this.backlog;
      this.backlog = null;
      for (const bytes of pending) listener(bytes);
    }
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onClose(listener: CloseListener): Unsubscribe {
    if (this.closedWith !== null) {
      const { reason, detail } = this.closedWith;
      queueMicrotask(() => listener(reason, detail));
      return () => undefined;
    }
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.closedWith !== null) return;
    // Report right away; the native onClose that follows is ignored.
    this.finish('local-close');
    await this.native.close(this.connectionId).catch(() => undefined);
  }

  /** Native bytes for this connection. */
  deliver(bytes: Uint8Array) {
    if (this.closedWith !== null) return;
    if (this.backlog !== null) {
      this.backlog.push(bytes);
      return;
    }
    for (const listener of [...this.dataListeners]) listener(bytes);
  }

  finish(reason: LinkCloseReason, detail?: string) {
    if (this.closedWith !== null) return;
    this.closedWith = detail === undefined ? { reason } : { reason, detail };
    // The backlog survives: bytes that arrived before the close (a final message) still reach a late first subscriber.
    this.onFinished(this);
    for (const listener of [...this.closeListeners]) listener(reason, detail);
    this.closeListeners.clear();
    this.dataListeners.clear();
  }
}

/** One open() call: cancellation, deadline and cleanup steps. */
class Attempt {
  private settled = false;
  private cancelReason: LinkError | null = null;
  private rejectCancelled: ((error: LinkError) => void) | null = null;
  private readonly cleanups: (() => Promise<unknown>)[] = [];
  readonly cancelled: Promise<never>;
  readonly deadline: number;

  constructor(timeoutMs: number, now: number) {
    this.deadline = now + timeoutMs;
    this.cancelled = new Promise<never>((_, reject) => {
      this.rejectCancelled = reject;
    });
    // Never an unhandled rejection: the attempt's own awaits observe it through race().
    this.cancelled.catch(() => undefined);
  }

  get done(): boolean {
    return this.settled || this.cancelReason !== null;
  }

  cancel(error: LinkError) {
    if (this.done) return;
    this.cancelReason = error;
    this.rejectCancelled?.(error);
  }

  /** Awaits `promise` unless the attempt is cancelled first. Native rejections become LinkErrors. */
  async race<T>(promise: Promise<T>, fallback: LinkErrorCode): Promise<T> {
    if (this.cancelReason !== null) throw this.cancelReason;
    try {
      return await Promise.race([promise, this.cancelled]);
    } catch (error) {
      throw toLinkError(error, fallback);
    }
  }

  onCleanup(step: () => Promise<unknown>) {
    this.cleanups.push(step);
  }

  async finish() {
    this.settled = true;
    const steps = this.cleanups.splice(0).reverse();
    for (const step of steps) await step().catch(() => undefined);
  }
}

class LanTransport implements LinkTransport {
  readonly kind = 'lan' as const;
  private disposed = false;
  private locksHeld = false;
  private attempt: Attempt | null = null;
  private lastAttemptSettled: Promise<void> = Promise.resolve();
  private openGeneration = 0;
  /** Listeners already stopped by their attempt: a late onAccept on them is closed at once. */
  private readonly retiredListeners = new Set<string>();
  private channel: NativeLinkChannel | null = null;
  private readonly channels = new Map<string, NativeLinkChannel>();
  private readonly orphanData = new Map<string, { chunks: Uint8Array[]; bytes: number }>();
  private readonly orphanClose = new Map<string, { reason: LinkCloseReason; detail?: string }>();
  private pendingAccepts: LinkAcceptEvent[] = [];
  private acceptWaiter: { listenerId: string; resolve: (event: LinkAcceptEvent) => void } | null = null;
  private peerWaiter: ((event: LinkPeerEvent) => void) | null = null;
  private readonly subscriptions: { remove(): void }[];
  private readonly clock: Clock;

  constructor(
    private readonly native: LinkNativeModule,
    private readonly config: LanTransportConfig,
  ) {
    this.clock = config.clock ?? systemClock;
    this.subscriptions = [
      native.addListener('onData', (event) => this.handleData(event.connectionId, event.data)),
      native.addListener('onClose', (event) =>
        this.handleClose(event.connectionId, event.reason, event.detail),
      ),
      native.addListener('onAccept', (event) => this.handleAccept(event)),
      native.addListener('onPeer', (event) => this.handlePeer(event)),
    ];
  }

  async isAvailable(): Promise<boolean> {
    if (this.disposed) return false;
    try {
      return await this.native.isWifiConnected();
    } catch {
      return false;
    }
  }

  async listInterfaces(): Promise<LinkNetworkInterface[]> {
    return this.native.listInterfaces();
  }

  async open(options: LinkOpenOptions): Promise<LinkChannel> {
    if (this.disposed) throw new LinkError('unavailable', 'LanTransport is disposed');
    if (options.signal?.aborted) throw new LinkError('aborted');
    if (!PAIR_ID.test(options.pairId)) throw new LinkError('connect-failed', 'malformed pair id');

    // One peer at a time: a new open() supersedes the previous one (in flight or not) and its channel. The previous
    // attempt's cleanup (stopDiscovery, stopListening, ...) must finish first, or it would tear down what this one starts.
    const generation = ++this.openGeneration;
    this.attempt?.cancel(new LinkError('aborted', 'superseded by a new open()'));
    const previous = this.lastAttemptSettled;
    const run = (async () => {
      await previous;
      if (generation !== this.openGeneration) throw new LinkError('aborted', 'superseded by a new open()');
      await this.channel?.close();
      if (this.disposed) throw new LinkError('aborted', 'transport disposed');
      if (options.signal?.aborted) throw new LinkError('aborted');
      const attempt = new Attempt(Math.max(0, options.timeoutMs), this.clock.now());
      this.attempt = attempt;
      return this.run(attempt, options);
    })();
    this.lastAttemptSettled = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async run(attempt: Attempt, options: LinkOpenOptions): Promise<LinkChannel> {
    const timer = this.clock.setTimeout(
      () =>
        attempt.cancel(new LinkError('timeout', `no ${options.role === 'host' ? 'guest' : 'host'} in time`)),
      Math.max(0, options.timeoutMs),
    );
    const onAbort = () => attempt.cancel(new LinkError('aborted'));
    options.signal?.addEventListener('abort', onAbort);
    try {
      const connection =
        options.role === 'host'
          ? await this.openHost(attempt, options)
          : await this.openGuest(attempt, options);
      return this.adopt(connection);
    } finally {
      this.clock.clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (this.attempt === attempt) this.attempt = null;
      this.acceptWaiter = null;
      this.peerWaiter = null;
      await attempt.finish();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.attempt?.cancel(new LinkError('aborted', 'transport disposed'));
    await this.channel?.close();
    for (const subscription of this.subscriptions) subscription.remove();
    this.orphanData.clear();
    this.orphanClose.clear();
    this.pendingAccepts = [];
    this.locksHeld = false;
    await this.native.dispose().catch(() => undefined);
  }

  // ---- open() steps ------------------------------------------------------------------------------------------------

  private async prepare(attempt: Attempt) {
    const wifi = await attempt.race(this.native.isWifiConnected(), 'unavailable');
    if (!wifi) throw new LinkError('unavailable', 'not connected to a Wi-Fi network');
    if (!this.locksHeld) {
      await attempt.race(this.native.acquireLocks(), 'unavailable');
      this.locksHeld = true;
    }
  }

  private async openHost(attempt: Attempt, options: LinkOpenOptions): Promise<NativeConnection> {
    await this.prepare(attempt);
    const listening = this.native.listen({ port: 0 });
    // Whatever happens to the attempt, a listener that was opened is closed again at the end.
    attempt.onCleanup(async () => {
      const result = await listening.catch(() => null);
      if (result === null) return;
      this.retiredListeners.add(result.listenerId);
      if (this.retiredListeners.size > MAX_RETIRED_LISTENERS) {
        const oldest = this.retiredListeners.values().next().value;
        if (oldest !== undefined) this.retiredListeners.delete(oldest);
      }
      await this.native.stopListening(result.listenerId);
      this.closePendingAccepts(result.listenerId);
    });
    const { listenerId, port } = await attempt.race(listening, 'connect-failed');

    const accepted = new Promise<LinkAcceptEvent>((resolve) => {
      const early = this.pendingAccepts.find((event) => event.listenerId === listenerId);
      if (early) {
        this.pendingAccepts = this.pendingAccepts.filter((event) => event !== early);
        resolve(early);
      } else {
        this.acceptWaiter = { listenerId, resolve };
      }
    });

    const advertising = this.native.startAdvertising({
      serviceType: this.config.serviceType,
      pairId: options.pairId,
      ...(this.config.serviceNamePrefix !== undefined
        ? { serviceNamePrefix: this.config.serviceNamePrefix }
        : {}),
      port,
    });
    attempt.onCleanup(async () => {
      if ((await advertising.then(() => true).catch(() => false)) === true)
        await this.native.stopAdvertising();
    });
    await attempt.race(advertising, 'discovery-failed');

    this.closeIfNotAdopted(attempt, accepted);
    return attempt.race(accepted, 'connect-failed');
  }

  private async openGuest(attempt: Attempt, options: LinkOpenOptions): Promise<NativeConnection> {
    await this.prepare(attempt);
    const found = new Promise<LinkPeerEvent>((resolve) => {
      this.peerWaiter = (event) => {
        if (event.kind === 'found' && event.host !== null && event.port !== null) {
          this.peerWaiter = null;
          resolve(event);
        }
      };
    });
    const discovering = this.native.startDiscovery({
      serviceType: this.config.serviceType,
      pairId: options.pairId,
      ...(this.config.serviceNamePrefix !== undefined
        ? { serviceNamePrefix: this.config.serviceNamePrefix }
        : {}),
    });
    attempt.onCleanup(async () => {
      if ((await discovering.then(() => true).catch(() => false)) === true) await this.native.stopDiscovery();
    });
    await attempt.race(discovering, 'discovery-failed');

    const peer = await attempt.race(found, 'discovery-failed');
    const connecting = this.native.connect({
      host: peer.host!,
      port: peer.port!,
      timeoutMs: Math.max(MIN_CONNECT_TIMEOUT_MS, attempt.deadline - this.clock.now()),
    });
    this.closeIfNotAdopted(attempt, connecting);
    return attempt.race(connecting, 'connect-failed');
  }

  /**
   * Closes the connection [pending] yields if the attempt ends without adopting it: an accept or connect that settles
   * in the same turn the attempt is cancelled (timeout, abort, superseded), or after it. Adoption happens synchronously
   * before the attempt's cleanups run, so the check in the cleanup step sees the final state; a connection that only
   * arrives after the cleanups ran is closed as soon as it arrives.
   */
  private closeIfNotAdopted(attempt: Attempt, pending: Promise<NativeConnection>) {
    let arrived: NativeConnection | null = null;
    let finished = false;
    const closeOrphan = (connection: NativeConnection) => {
      if (this.channels.has(connection.connectionId)) return;
      this.dropOrphan(connection.connectionId);
      void this.native.close(connection.connectionId).catch(() => undefined);
    };
    void pending.then(
      (connection) => {
        arrived = connection;
        if (finished) closeOrphan(connection);
      },
      () => undefined,
    );
    attempt.onCleanup(async () => {
      finished = true;
      if (arrived !== null) closeOrphan(arrived);
    });
  }

  private adopt(connection: NativeConnection): NativeLinkChannel {
    const id = connection.connectionId;
    const channel = new NativeLinkChannel(this.native, id, connection, (finished) => {
      this.channels.delete(finished.connectionId);
      if (this.channel === finished) this.channel = null;
    });
    this.channels.set(id, channel);
    this.channel = channel;
    const orphan = this.orphanData.get(id);
    this.orphanData.delete(id);
    for (const chunk of orphan?.chunks ?? []) channel.deliver(chunk);
    const closed = this.orphanClose.get(id);
    this.orphanClose.delete(id);
    if (closed) channel.finish(closed.reason, closed.detail);
    return channel;
  }

  // ---- native events -----------------------------------------------------------------------------------------------

  private handleData(connectionId: string, data: string) {
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(data);
    } catch {
      return; // the native side only sends valid Base64; nothing sensible to do with garbage
    }
    const channel = this.channels.get(connectionId);
    if (channel) {
      channel.deliver(bytes);
      return;
    }
    if (this.disposed) return;
    let orphan = this.orphanData.get(connectionId);
    if (!orphan) {
      if (this.orphanData.size >= MAX_ORPHAN_IDS) {
        const oldest = this.orphanData.keys().next().value;
        if (oldest !== undefined) this.orphanData.delete(oldest);
      }
      orphan = { chunks: [], bytes: 0 };
      this.orphanData.set(connectionId, orphan);
    }
    if (orphan.bytes + bytes.length > MAX_ORPHAN_BYTES) {
      // Nobody is reading this connection: refuse to buffer without bound.
      this.dropOrphan(connectionId);
      void this.native.close(connectionId).catch(() => undefined);
      return;
    }
    orphan.chunks.push(bytes);
    orphan.bytes += bytes.length;
  }

  private handleClose(connectionId: string, reason: string, detail?: string) {
    const normalized: LinkCloseReason = (CLOSE_REASONS as readonly string[]).includes(reason)
      ? (reason as LinkCloseReason)
      : 'io-error';
    const channel = this.channels.get(connectionId);
    if (channel) {
      channel.finish(normalized, detail);
      return;
    }
    if (this.disposed) return;
    if (this.orphanClose.size >= MAX_ORPHAN_IDS) {
      const oldest = this.orphanClose.keys().next().value;
      if (oldest !== undefined) this.orphanClose.delete(oldest);
    }
    this.orphanClose.set(
      connectionId,
      detail === undefined ? { reason: normalized } : { reason: normalized, detail },
    );
  }

  private handleAccept(event: LinkAcceptEvent) {
    const waiter = this.acceptWaiter;
    if (waiter && waiter.listenerId === event.listenerId) {
      this.acceptWaiter = null;
      waiter.resolve(event);
      return;
    }
    if (this.disposed || this.retiredListeners.has(event.listenerId)) {
      void this.native.close(event.connectionId).catch(() => undefined);
      return;
    }
    // Possible only in the window between listen() resolving and the waiter being set; bounded.
    this.pendingAccepts.push(event);
    while (this.pendingAccepts.length > MAX_PENDING_ACCEPTS) {
      const dropped = this.pendingAccepts.shift();
      if (dropped) void this.native.close(dropped.connectionId).catch(() => undefined);
    }
  }

  private handlePeer(event: LinkPeerEvent) {
    this.peerWaiter?.(event);
  }

  private closePendingAccepts(listenerId: string) {
    const stale = this.pendingAccepts.filter((event) => event.listenerId === listenerId);
    this.pendingAccepts = this.pendingAccepts.filter((event) => event.listenerId !== listenerId);
    for (const event of stale) {
      if (!this.channels.has(event.connectionId)) {
        this.dropOrphan(event.connectionId);
        void this.native.close(event.connectionId).catch(() => undefined);
      }
    }
  }

  private dropOrphan(connectionId: string) {
    this.orphanData.delete(connectionId);
    this.orphanClose.delete(connectionId);
  }
}

export function createLanTransport(native: LinkNativeModule, config: LanTransportConfig): LinkTransport {
  return new LanTransport(native, config);
}
