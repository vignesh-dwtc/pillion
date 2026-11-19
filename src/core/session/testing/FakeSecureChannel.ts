import type { Unsubscribe } from '../../common/types';
import type { SessionMessage } from '../../protocol/messages';
import {
  ProtocolError,
  type ByteChannel,
  type EstablishSecureChannel,
  type SecureChannel,
  type SecureChannelOptions,
} from '../../protocol/secureChannel';

/**
 * Stand-in secure channel for session tests: the same shape as the real handshake (guest hello, host ack, guest
 * auth, host ready, then framed messages) over any `ByteChannel`, with the failure modes the session has to
 * classify: wrong secret (bad-proof), unknown pair id, version mismatch, a peer that never answers, a closing
 * link, malformed frames. It is NOT security: proofs are plain HMACs of fixed strings (no nonces, replayable),
 * there are no per-frame MACs. The real protocol is exercised in twoPeer.realProtocol.test.ts.
 *
 * It is deliberately strict about one thing the real channel is lenient about: with `dropUnsubscribed`, a
 * message that arrives before the first `onMessage` subscription is thrown away instead of queued, so a session
 * that subscribes late (or relies on the host speaking first) fails loudly here.
 */

export interface FakeEstablishOptions {
  /** Protocol version this peer speaks. A host answers 'unsupported-version' to a different one. Default 1. */
  version?: number;
  /** Drop messages that arrive before the first onMessage listener instead of queueing them. Default false. */
  dropUnsubscribed?: boolean;
  /** Never answer: the handshake can only end by its deadline or by the link closing. */
  stall?: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_FRAME = 256 * 1024;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function frame(value: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(value));
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(body, 4);
  return out;
}

class FrameReader {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
  }

  /** The next complete frame body, or null. Throws on an absurd length. */
  next(): Uint8Array | null {
    if (this.buffer.length < 4) return null;
    const length = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4).getUint32(0);
    if (length > MAX_FRAME) throw new ProtocolError('frame-too-large', 'frame too large');
    if (this.buffer.length < 4 + length) return null;
    const body = this.buffer.slice(4, 4 + length);
    this.buffer = this.buffer.slice(4 + length);
    return body;
  }
}

type Phase = 'hello' | 'ack' | 'auth' | 'ready' | 'open' | 'failed';

interface WireHello {
  t: 'hello';
  v: number;
  pairId: string;
  proof: string;
}

class FakeSecureSession implements SecureChannel {
  readonly role: 'host' | 'guest';

  private phase: Phase;
  private readonly reader = new FrameReader();
  private readonly messageListeners = new Set<(message: SessionMessage) => void>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  private backlog: SessionMessage[] | null = [];
  private closed = false;
  private timer: unknown = null;
  private readonly offs: Unsubscribe[] = [];
  private readonly secret: Uint8Array;
  private settled = false;

  constructor(
    private readonly channel: ByteChannel,
    private readonly options: SecureChannelOptions,
    private readonly settings: FakeEstablishOptions,
    private readonly resolve: (channel: SecureChannel) => void,
    private readonly reject: (error: unknown) => void,
  ) {
    this.role = options.role;
    this.secret = new Uint8Array(options.secret);
    this.phase = options.role === 'host' ? 'hello' : 'ack';
  }

  start(): void {
    const { setTimeout: setT, handshakeTimeoutMs } = this.options;
    if (setT) {
      this.timer = setT(
        () => this.fail(new ProtocolError('handshake-timeout', 'handshake timed out')),
        handshakeTimeoutMs ?? 5000,
      );
    }
    this.offs.push(this.channel.onData((chunk) => this.onData(chunk)));
    this.offs.push(this.channel.onClose((reason) => this.onTransportClose(reason)));
    if (this.role === 'guest' && !this.settings.stall) {
      this.transmit(frame(this.hello()));
    }
  }

  // ---- SecureChannel ----------------------------------------------------------------------------------

  send(message: SessionMessage): Promise<void> {
    if (this.closed || this.phase !== 'open')
      return Promise.reject(new ProtocolError('closed', 'channel is closed'));
    return this.channel.send(frame({ t: 'msg', m: message })).catch(() => {
      this.shutdown('io-error', true);
      throw new ProtocolError('closed', 'send failed');
    });
  }

  onMessage(listener: (message: SessionMessage) => void): Unsubscribe {
    this.messageListeners.add(listener);
    const queued = this.backlog;
    if (queued !== null) {
      this.backlog = null;
      for (const message of queued) listener(message);
    }
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onClose(listener: (reason: string) => void): Unsubscribe {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  close(): Promise<void> {
    this.shutdown('local-close', true);
    return Promise.resolve();
  }

  // ---- handshake --------------------------------------------------------------------------------------

  private proof(who: 'guest' | 'host'): string {
    return toHex(
      this.options.crypto.hmacSha256(this.secret, encoder.encode(`${who}|${this.options.pairId}`)),
    );
  }

  private hello(): WireHello {
    return {
      t: 'hello',
      v: this.settings.version ?? 1,
      pairId: this.options.pairId,
      proof: this.proof('guest'),
    };
  }

  /** Read through a getter: TypeScript cannot see that onFrame() may have changed `phase`. */
  private get halted(): boolean {
    return this.closed || this.phase === 'failed';
  }

  private onData(chunk: Uint8Array): void {
    if (this.halted) return;
    if (this.settings.stall && this.phase !== 'open') return;
    this.reader.push(chunk);
    try {
      for (;;) {
        const body = this.reader.next();
        if (body === null) return;
        this.onFrame(JSON.parse(decoder.decode(body)) as Record<string, unknown>);
        if (this.halted) return;
      }
    } catch (error) {
      const failure =
        error instanceof ProtocolError ? error : new ProtocolError('malformed-frame', 'unreadable frame');
      if (this.phase === 'open') this.shutdown(failure.code, true);
      else this.fail(failure);
    }
  }

  private onFrame(message: Record<string, unknown>): void {
    if (message.t === 'reject') {
      const reason = typeof message.reason === 'string' ? message.reason : 'malformed';
      this.fail(
        new ProtocolError(
          reason === 'malformed' ? 'malformed-frame' : (reason as 'bad-proof'),
          `peer rejected: ${reason}`,
        ),
      );
      return;
    }
    switch (this.phase) {
      case 'hello':
        this.onHello(message);
        return;
      case 'ack':
        this.onAck(message);
        return;
      case 'auth':
        if (message.t !== 'auth') throw new ProtocolError('malformed-frame', 'expected auth');
        this.phase = 'open';
        this.transmit(frame({ t: 'ready' }));
        this.complete();
        return;
      case 'ready':
        if (message.t !== 'ready') throw new ProtocolError('malformed-frame', 'expected ready');
        this.phase = 'open';
        this.complete();
        return;
      case 'open':
        if (message.t !== 'msg') throw new ProtocolError('malformed-frame', 'expected msg');
        this.deliver(message.m as SessionMessage);
        return;
      case 'failed':
        return;
    }
  }

  private onHello(message: Record<string, unknown>): void {
    if (message.t !== 'hello') throw new ProtocolError('malformed-frame', 'expected hello');
    if (message.v !== (this.settings.version ?? 1)) {
      this.rejectPeer('unsupported-version');
      return;
    }
    if (message.pairId !== this.options.pairId) {
      this.rejectPeer('unknown-pair');
      return;
    }
    if (message.proof !== this.proof('guest')) {
      this.rejectPeer('bad-proof');
      return;
    }
    this.phase = 'auth';
    this.transmit(frame({ t: 'ack', proof: this.proof('host') }));
  }

  private onAck(message: Record<string, unknown>): void {
    if (message.t !== 'ack') throw new ProtocolError('malformed-frame', 'expected ack');
    if (message.proof !== this.proof('host')) {
      this.rejectPeer('bad-proof');
      return;
    }
    this.phase = 'ready';
    this.transmit(frame({ t: 'auth' }));
  }

  /** Tells the peer why (best effort), then fails locally with the matching code. */
  private rejectPeer(reason: 'unsupported-version' | 'unknown-pair' | 'bad-proof'): void {
    this.transmit(frame({ t: 'reject', reason }));
    this.fail(new ProtocolError(reason, `rejected the peer: ${reason}`));
  }

  private complete(): void {
    if (this.settled) return;
    this.settled = true;
    this.clearTimer();
    this.resolve(this);
  }

  private fail(error: ProtocolError): void {
    if (this.settled || this.phase === 'failed') return;
    this.phase = 'failed';
    this.settled = true;
    this.clearTimer();
    this.shutdown(error.code, true, false);
    this.reject(error);
  }

  private onTransportClose(reason: string): void {
    if (this.phase === 'open') {
      this.shutdown(reason, false);
    } else {
      this.fail(new ProtocolError('closed', `link closed during the handshake (${reason})`));
    }
  }

  // ---- open channel -----------------------------------------------------------------------------------

  private deliver(message: SessionMessage): void {
    if (this.backlog !== null) {
      if (!this.settings.dropUnsubscribed) this.backlog.push(message);
      return;
    }
    for (const listener of [...this.messageListeners]) listener(message);
  }

  private shutdown(reason: string, closeLink: boolean, notify = true): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    for (const off of this.offs.splice(0)) off();
    if (closeLink) void this.channel.close().catch(() => undefined);
    if (!notify) return;
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) listener(reason);
  }

  private transmit(bytes: Uint8Array): void {
    this.channel.send(bytes).catch(() => this.shutdown('io-error', false));
  }

  private clearTimer(): void {
    if (this.timer !== null && this.options.clearTimeout) this.options.clearTimeout(this.timer);
    this.timer = null;
  }
}

export function createFakeEstablish(settings: FakeEstablishOptions = {}): EstablishSecureChannel {
  return (channel, options) =>
    new Promise<SecureChannel>((resolve, reject) => {
      new FakeSecureSession(channel, options, settings, resolve, reject).start();
    });
}

/** The default stand-in: a well-behaved peer speaking protocol version 1. */
export const establishFakeSecureChannel: EstablishSecureChannel = createFakeEstablish();
