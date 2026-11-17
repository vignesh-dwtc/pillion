/// <reference types="node" />
import type { Unsubscribe } from '../../common/types';
import type { ByteChannel } from '../secureChannel';

/**
 * In-memory duplex byte pipe for protocol tests. It behaves like the real link contract (ordered, reliable,
 * arbitrary chunk boundaries) and adds test controls: chunking, per-direction taps (to drop, duplicate, reorder or
 * corrupt frames in transit), recording, and link failure injection.
 *
 * Like a real LinkChannel it buffers inbound bytes until the first data listener subscribes.
 */

export type Delivery = 'sync' | 'async';

/** Receives each send() call's bytes (our protocol sends exactly one frame per call) and returns what to deliver. */
export type Tap = (data: Uint8Array, index: number) => Uint8Array[];

export interface PipeOptions {
  /** `async` (default) delivers in a microtask, like a real transport; `sync` delivers inside send(). */
  delivery?: Delivery;
  /** Splits what one send() delivers into chunks (reassembly tests). Applied after the tap. */
  chunker?: (data: Uint8Array) => Uint8Array[];
  tapAtoB?: Tap;
  tapBtoA?: Tap;
}

type QueueItem = { kind: 'data'; chunk: Uint8Array } | { kind: 'close'; reason: string };

export class MemoryEnd implements ByteChannel {
  /** Every send() call's bytes, as given (copied). */
  readonly sent: Uint8Array[] = [];
  closeCalls = 0;
  isClosed = false;
  closeReasons: string[] = [];
  /** Make the next send() calls fail (transport write error). */
  failSends = false;

  peer!: MemoryEnd;
  private readonly dataListeners = new Set<(data: Uint8Array) => void>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  private readonly inbox: QueueItem[] = [];
  private flushScheduled = false;
  private subscribedOnce = false;
  private sendIndex = 0;

  constructor(
    private readonly options: Required<Pick<PipeOptions, 'delivery'>> & PipeOptions,
    private readonly tap: Tap | undefined,
  ) {}

  send(data: Uint8Array): Promise<void> {
    if (this.isClosed) return Promise.reject(new Error('pipe end is closed'));
    if (this.failSends) return Promise.reject(new Error('simulated write failure'));
    this.sent.push(new Uint8Array(data));
    const forwarded = this.tap ? this.tap(new Uint8Array(data), this.sendIndex) : [new Uint8Array(data)];
    this.sendIndex += 1;
    for (const piece of forwarded) {
      const chunks = this.options.chunker ? this.options.chunker(piece) : [piece];
      for (const chunk of chunks) this.peer.enqueue({ kind: 'data', chunk: new Uint8Array(chunk) });
    }
    return Promise.resolve();
  }

  onData(listener: (data: Uint8Array) => void): Unsubscribe {
    this.dataListeners.add(listener);
    this.subscribedOnce = true;
    this.scheduleFlush();
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onClose(listener: (reason: string) => void): Unsubscribe {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    if (this.isClosed) return Promise.resolve();
    this.markClosed('local-close');
    this.peer.enqueue({ kind: 'close', reason: 'remote-close' });
    return Promise.resolve();
  }

  // ---- test controls -------------------------------------------------------------------------------------

  /** Delivers bytes to this end as if the peer had sent them (bypasses the tap and the peer). */
  inject(bytes: Uint8Array): void {
    this.enqueue({ kind: 'data', chunk: new Uint8Array(bytes) });
  }

  /** The link dies under both ends (no local/remote distinction), after already-queued data. */
  dropLink(reason = 'network-lost'): void {
    this.enqueue({ kind: 'close', reason });
    this.peer.enqueue({ kind: 'close', reason });
  }

  get listenerCount(): number {
    return this.dataListeners.size;
  }

  // ---- internals -----------------------------------------------------------------------------------------

  enqueue(item: QueueItem): void {
    this.inbox.push(item);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.options.delivery === 'sync') {
      this.flush();
      return;
    }
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void Promise.resolve().then(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    // Real links hold inbound bytes until somebody listens.
    if (!this.subscribedOnce) return;
    while (this.inbox.length > 0) {
      const item = this.inbox[0];
      if (item === undefined) break;
      if (item.kind === 'data' && this.dataListeners.size === 0) break;
      this.inbox.shift();
      if (item.kind === 'close') {
        this.markClosed(item.reason);
      } else if (!this.isClosed) {
        for (const listener of Array.from(this.dataListeners)) listener(new Uint8Array(item.chunk));
      }
    }
  }

  private markClosed(reason: string): void {
    if (this.isClosed && this.closeReasons.length > 0) return;
    this.isClosed = true;
    this.closeReasons.push(reason);
    for (const listener of Array.from(this.closeListeners)) listener(reason);
  }
}

export interface MemoryPipe {
  a: MemoryEnd;
  b: MemoryEnd;
}

export function createMemoryPipe(options: PipeOptions = {}): MemoryPipe {
  const resolved = { ...options, delivery: options.delivery ?? 'async' } as const;
  const a = new MemoryEnd(resolved, options.tapAtoB);
  const b = new MemoryEnd(resolved, options.tapBtoA);
  a.peer = b;
  b.peer = a;
  return { a, b };
}

/** Lets pending microtasks AND one macrotask turn pass: everything async in a test settles, rejections surface. */
export function settle(turns = 3): Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  for (let i = 0; i < turns; i++) {
    chain = chain.then(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
  return chain;
}

/** Cuts `data` into pieces of random size 1..maxPiece. */
export function randomChunker(next: () => number, maxPiece: number): (data: Uint8Array) => Uint8Array[] {
  return (data) => {
    const pieces: Uint8Array[] = [];
    let offset = 0;
    while (offset < data.length) {
      const size = Math.min(data.length - offset, 1 + Math.floor(next() * maxPiece));
      pieces.push(data.slice(offset, offset + size));
      offset += size;
    }
    return pieces;
  };
}

/** One byte per chunk: the cruellest boundaries. */
export const byteAtATime = (data: Uint8Array): Uint8Array[] =>
  Array.from(data, (byte) => Uint8Array.of(byte));
