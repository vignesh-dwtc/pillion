import type { Unsubscribe } from '../common/types';
import { wipe } from './bytes';
import { encodeSessionMessage, parseSessionMessage } from './codec';
import { MAC_BYTES, MAX_FRAME_BYTES } from './constants';
import type { CryptoProvider } from './crypto';
import { encodeFrame, type FrameDecoder } from './frame';
import { openFrame, sealFrame } from './handshake';
import { MAX_BACKLOG_MESSAGES } from './limits';
import type { SessionMessage } from './messages';
import { ProtocolError, type ByteChannel, type SecureChannel } from './secureChannel';

/**
 * The authenticated channel that exists after a completed handshake.
 *
 * Security properties (each has a test in channel.test.ts / establish.test.ts):
 *  - every inbound frame must carry a valid HMAC tag for the NEXT expected counter before a single byte of its
 *    body is parsed; replay, reorder, drop, truncation and bit flips all surface as a tag mismatch;
 *  - any violation closes the channel (fail closed): there is no resynchronisation and no second chance;
 *  - outbound counters are allocated in wire order (sends are serialised) and never reused;
 *  - key material is wiped when the channel closes.
 */

export interface SecureChannelParams {
  role: 'host' | 'guest';
  channel: ByteChannel;
  /** May already hold bytes received during the handshake; they are processed immediately. */
  decoder: FrameDecoder;
  crypto: CryptoProvider;
  /** Authenticates frames this side sends. Owned (and wiped on close) by the secure channel from now on. */
  sendKey: Uint8Array;
  /** Authenticates frames this side receives. Owned (and wiped on close) by the secure channel from now on. */
  recvKey: Uint8Array;
  /** Counter of the next frame this side sends. */
  sendCounter: number;
  /** Counter of the next frame this side expects to receive. */
  recvCounter: number;
}

const noop = (): void => undefined;

function callSafely<T>(listener: (value: T) => void, value: T): void {
  try {
    listener(value);
  } catch {
    // A throwing listener must not break delivery to the others or leave the protocol state half-updated.
    // Listeners own their error handling (the session wraps its handlers and logs).
  }
}

async function closeQuietly(channel: ByteChannel): Promise<void> {
  try {
    await channel.close();
  } catch {
    // The link is already gone; nothing useful to do with the error.
  }
}

function closedError(detail: string): ProtocolError {
  return new ProtocolError('closed', `secure channel is closed (${detail})`);
}

/** Transport-provided reasons are free text: keep them short and printable before they reach an error message. */
function describeReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason : 'unknown';
  return text.replace(/[^\x20-\x7e]/g, '?').slice(0, 64);
}

export class SecureChannelImpl implements SecureChannel {
  readonly role: 'host' | 'guest';

  private readonly transport: ByteChannel;
  private readonly decoder: FrameDecoder;
  private readonly crypto: CryptoProvider;
  private readonly sendKey: Uint8Array;
  private readonly recvKey: Uint8Array;
  private sendCounter: number;
  private recvCounter: number;

  private readonly messageListeners = new Set<(message: SessionMessage) => void>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  /** Authenticated messages that arrived before the first onMessage subscription; null once it happened. */
  private backlog: SessionMessage[] | null = [];

  private isClosed = false;
  private closeReason: string | null = null;
  private closeFailure: ProtocolError | null = null;
  private transportClosing: Promise<void> = Promise.resolve();
  private sendTail: Promise<void> = Promise.resolve();
  private unsubscribeData: Unsubscribe | null = null;
  private unsubscribeClose: Unsubscribe | null = null;

  constructor(params: SecureChannelParams) {
    this.role = params.role;
    this.transport = params.channel;
    this.decoder = params.decoder;
    this.crypto = params.crypto;
    this.sendKey = params.sendKey;
    this.recvKey = params.recvKey;
    this.sendCounter = params.sendCounter;
    this.recvCounter = params.recvCounter;

    this.unsubscribeData = this.transport.onData((chunk) => this.onChunk(chunk));
    this.unsubscribeClose = this.transport.onClose((reason) =>
      this.shutdown(describeReason(reason), null, false),
    );
    this.drain(); // frames that were buffered during the handshake
  }

  /** Why the channel closed: a ProtocolError for protocol violations, ProtocolError('closed') otherwise. */
  get closeError(): ProtocolError | null {
    return this.closeFailure;
  }

  send(message: SessionMessage): Promise<void> {
    if (this.isClosed) return Promise.reject(closedError(this.closeReason ?? 'closed'));
    let body: Uint8Array;
    try {
      body = encodeSessionMessage(message);
      if (MAC_BYTES + body.length > MAX_FRAME_BYTES) {
        throw new ProtocolError('frame-too-large', `message of ${body.length} bytes does not fit one frame`);
      }
    } catch (error) {
      // The caller's message is bad; the channel itself is still sound, so it stays open.
      return Promise.reject(error);
    }
    const attempt = this.sendTail.then(() => this.transmit(body));
    this.sendTail = attempt.catch(noop);
    return attempt;
  }

  onMessage(listener: (message: SessionMessage) => void): Unsubscribe {
    this.messageListeners.add(listener);
    const queued = this.backlog;
    if (queued !== null) {
      this.backlog = null;
      for (const message of queued) this.dispatch(message);
    }
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onClose(listener: (reason: string) => void): Unsubscribe {
    if (this.isClosed) {
      // "Fires once": a listener that subscribes after the close still hears about it, asynchronously so that
      // `const stop = channel.onClose(() => stop())` cannot trip over its own binding.
      let cancelled = false;
      const reason = this.closeReason ?? 'closed';
      void Promise.resolve().then(() => {
        if (!cancelled) callSafely(listener, reason);
      });
      return () => {
        cancelled = true;
      };
    }
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  close(): Promise<void> {
    this.shutdown('local-close', null, true);
    return this.transportClosing;
  }

  // ---- sending -------------------------------------------------------------------------------------------

  private async transmit(body: Uint8Array): Promise<void> {
    if (this.isClosed) throw closedError(this.closeReason ?? 'closed');
    let frame: Uint8Array;
    try {
      frame = encodeFrame(sealFrame(this.crypto, this.sendKey, this.sendCounter, body));
    } catch {
      // Cannot authenticate: continuing would mean sending unauthenticated or desynchronised frames.
      this.shutdown('closed', new ProtocolError('closed', 'cannot authenticate an outgoing frame'), true);
      throw closedError('authentication failure');
    }
    this.sendCounter += 1; // committed: this counter value is never used again, even if the write fails
    try {
      await this.transport.send(frame);
    } catch {
      this.shutdown('io-error', null, true);
      throw closedError('send failed');
    }
  }

  // ---- receiving -----------------------------------------------------------------------------------------

  private onChunk(chunk: Uint8Array): void {
    if (this.isClosed) return;
    try {
      this.decoder.push(chunk);
    } catch {
      this.shutdown(
        'malformed-frame',
        new ProtocolError('malformed-frame', 'link delivered a non-byte chunk'),
        true,
      );
      return;
    }
    this.drain();
  }

  private drain(): void {
    try {
      while (!this.isClosed) {
        let payload: Uint8Array | null;
        try {
          payload = this.decoder.next();
        } catch (error) {
          const failure = error instanceof ProtocolError ? error : new ProtocolError('malformed-frame');
          this.shutdown(failure.code, failure, true);
          return;
        }
        if (payload === null) return;
        this.handleFrame(payload);
      }
    } catch {
      // Unexpected failure inside our own code or the injected CryptoProvider: fail closed rather than limp on.
      this.shutdown('closed', new ProtocolError('closed', 'internal error while receiving'), true);
    }
  }

  private handleFrame(payload: Uint8Array): void {
    const opened = openFrame(this.crypto, this.recvKey, this.recvCounter, payload);
    if (!opened.ok) {
      const failure =
        opened.reason === 'bad-mac'
          ? new ProtocolError('bad-mac', 'message authentication failed')
          : new ProtocolError('malformed-frame', 'frame too short to carry a MAC tag');
      this.shutdown(failure.code, failure, true);
      return;
    }
    this.recvCounter += 1;
    let message: SessionMessage;
    try {
      message = parseSessionMessage(opened.body);
    } catch (error) {
      const failure = error instanceof ProtocolError ? error : new ProtocolError('malformed-frame');
      this.shutdown(failure.code, failure, true);
      return;
    }
    this.deliver(message);
  }

  private deliver(message: SessionMessage): void {
    if (this.backlog !== null) {
      this.backlog.push(message);
      if (this.backlog.length > MAX_BACKLOG_MESSAGES) this.backlog.shift();
      return;
    }
    this.dispatch(message);
  }

  private dispatch(message: SessionMessage): void {
    for (const listener of Array.from(this.messageListeners)) callSafely(listener, message);
  }

  // ---- closing -------------------------------------------------------------------------------------------

  private shutdown(reason: string, failure: ProtocolError | null, closeTransport: boolean): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.closeReason = reason;
    this.closeFailure = failure ?? closedError(reason);
    this.unsubscribeData?.();
    this.unsubscribeClose?.();
    this.unsubscribeData = null;
    this.unsubscribeClose = null;
    wipe(this.sendKey, this.recvKey);
    if (closeTransport) this.transportClosing = closeQuietly(this.transport);
    const listeners = Array.from(this.closeListeners);
    this.closeListeners.clear();
    for (const listener of listeners) callSafely(listener, reason);
  }
}

export function createSecureChannel(params: SecureChannelParams): SecureChannelImpl {
  return new SecureChannelImpl(params);
}
