import { systemClock, type Unsubscribe } from '../common/types';
import { base64urlDecode, base64urlEncode } from './base64url';
import { isBytes, wipe } from './bytes';
import { SecureChannelImpl } from './channel';
import {
  encodeHandshakeMessage,
  parseHandshakeMessage,
  parseSessionMessage,
  type ParsedHandshakeMessage,
  type ParsedReject,
} from './codec';
import { MAX_FRAME_BYTES, NONCE_BYTES, PAIR_ID_BYTES, PROTOCOL_VERSION, SECRET_BYTES } from './constants';
import type { CryptoProvider } from './crypto';
import { FrameDecoder, encodeFrame } from './frame';
import {
  computeProof,
  deriveAuthKey,
  deriveSessionKeys,
  openFrame,
  type Role,
  type SessionKeys,
} from './handshake';
import {
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  MAX_HANDSHAKE_FRAME_BYTES,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './limits';
import type { RejectReason } from './messages';
import {
  ProtocolError,
  type ByteChannel,
  type EstablishSecureChannel,
  type SecureChannel,
  type SecureChannelOptions,
} from './secureChannel';

/**
 * Handshake state machine and `establishSecureChannel` (spec: header comment of messages.ts, supplemented by the
 * wire details at the top of handshake.ts).
 *
 *   guest: hello -> [await hello-ack] -> auth -> [await ready] -> SecureChannel
 *   host:  [await hello] -> hello-ack -> [await auth] -> ready -> SecureChannel
 *
 * Rules enforced here:
 *  - the host checks protocol version and pair id BEFORE drawing a nonce or running any crypto;
 *  - proofs and tags are compared with CryptoProvider.timingSafeEqual only;
 *  - before authentication only small frames are accepted (MAX_HANDSHAKE_FRAME_BYTES);
 *  - `reject` is an unauthenticated hint: it ends the handshake with a matching error, nothing more, and no state
 *    (stored pairing, retry policy) may be derived from it;
 *  - the deadline starts when establishSecureChannel is called, so a silent or slow-loris peer cannot hold it open;
 *  - handlers update state BEFORE sending, so a transport that delivers the reply synchronously still works;
 *  - on any failure the byte channel is closed and the promise rejects; nothing is ever left dangling.
 */

type Phase =
  'await-hello' | 'await-hello-ack' | 'await-auth' | 'await-ready' | 'finishing' | 'done' | 'failed';

interface ResolvedOptions {
  role: Role;
  pairId: string;
  pairIdBytes: Uint8Array;
  /** Private copy: the caller's array is never retained or modified. */
  secret: Uint8Array;
  crypto: CryptoProvider;
  handshakeTimeoutMs: number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/** Programmer errors (bad options) are TypeErrors, not ProtocolErrors: the peer did nothing wrong. */
function resolveOptions(options: SecureChannelOptions): ResolvedOptions {
  if (typeof options !== 'object' || options === null) throw new TypeError('secure channel options required');
  const { role } = options;
  if (role !== 'host' && role !== 'guest') throw new TypeError('role must be "host" or "guest"');
  const pairIdBytes = typeof options.pairId === 'string' ? base64urlDecode(options.pairId) : null;
  if (pairIdBytes === null || pairIdBytes.length !== PAIR_ID_BYTES) {
    throw new TypeError('pairId must be canonical base64url of 16 bytes');
  }
  if (!isBytes(options.secret) || options.secret.length !== SECRET_BYTES) {
    throw new TypeError(`secret must be ${SECRET_BYTES} bytes`);
  }
  const crypto = options.crypto;
  if (
    typeof crypto !== 'object' ||
    crypto === null ||
    typeof crypto.randomBytes !== 'function' ||
    typeof crypto.hmacSha256 !== 'function' ||
    typeof crypto.hkdfSha256 !== 'function' ||
    typeof crypto.timingSafeEqual !== 'function'
  ) {
    throw new TypeError('crypto provider required');
  }
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  if (
    typeof handshakeTimeoutMs !== 'number' ||
    !Number.isFinite(handshakeTimeoutMs) ||
    handshakeTimeoutMs <= 0
  ) {
    throw new TypeError('handshakeTimeoutMs must be a positive number');
  }
  if ((options.setTimeout === undefined) !== (options.clearTimeout === undefined)) {
    throw new TypeError('setTimeout and clearTimeout must be injected together');
  }
  return {
    role,
    pairId: options.pairId,
    pairIdBytes,
    secret: new Uint8Array(options.secret),
    crypto,
    handshakeTimeoutMs,
    setTimeout: options.setTimeout ?? systemClock.setTimeout,
    clearTimeout: options.clearTimeout ?? systemClock.clearTimeout,
  };
}

interface RejectHint {
  reason: RejectReason;
  supportedVersions?: number[];
}

/** What a peer's `reject` means to us. It is a hint about why the handshake ended, never evidence. */
function errorFromReject(message: ParsedReject): ProtocolError {
  const suffix = '(unauthenticated hint from the peer)';
  switch (message.reason) {
    case 'unsupported-version':
      return new ProtocolError(
        'unsupported-version',
        `peer rejected the handshake: unsupported version ${suffix}`,
      );
    case 'unknown-pair':
      return new ProtocolError('unknown-pair', `peer rejected the handshake: unknown pairing ${suffix}`);
    case 'bad-proof':
      return new ProtocolError('bad-proof', `peer rejected the handshake: proof not accepted ${suffix}`);
    case 'busy':
      return new ProtocolError('busy', `peer rejected the handshake: busy ${suffix}`);
    case 'malformed':
      return new ProtocolError('malformed-frame', `peer rejected the handshake: malformed message ${suffix}`);
  }
}

function tryParseReject(frame: Uint8Array): ParsedReject | null {
  try {
    const message = parseHandshakeMessage(frame);
    return message.type === 'reject' ? message : null;
  } catch {
    return null;
  }
}

function drawNonce(crypto: CryptoProvider): Uint8Array {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  if (!isBytes(nonce) || nonce.length !== NONCE_BYTES)
    throw new Error('random source returned the wrong amount');
  return nonce;
}

async function closeQuietly(channel: ByteChannel): Promise<void> {
  try {
    await channel.close();
  } catch {
    // The link is already gone.
  }
}

function sanitizeReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason : 'unknown';
  return text.replace(/[^\x20-\x7e]/g, '?').slice(0, 64);
}

class Handshake {
  private phase: Phase;
  private failure: unknown = null;
  private settled = false;
  private closeStarted = false;
  private timer: unknown = null;
  private timerArmed = false;
  private unsubscribeData: Unsubscribe | null = null;
  private unsubscribeClose: Unsubscribe | null = null;
  private nonceGuest: Uint8Array | null = null;
  private nonceHost: Uint8Array | null = null;
  private authKey: Uint8Array | null = null;
  private keys: SessionKeys | null = null;
  private secure: SecureChannelImpl | null = null;
  private readonly decoder = new FrameDecoder(MAX_HANDSHAKE_FRAME_BYTES);

  constructor(
    private readonly channel: ByteChannel,
    private readonly config: ResolvedOptions,
    private readonly resolvePromise: (channel: SecureChannel) => void,
    private readonly rejectPromise: (error: unknown) => void,
  ) {
    this.phase = config.role === 'host' ? 'await-hello' : 'await-hello-ack';
  }

  start(): void {
    try {
      this.timer = this.config.setTimeout(() => this.onTimeout(), this.config.handshakeTimeoutMs);
      this.timerArmed = true;
      let hello: Uint8Array | null = null;
      if (this.config.role === 'guest') {
        const nonceGuest = drawNonce(this.config.crypto);
        this.nonceGuest = nonceGuest;
        hello = encodeFrame(
          encodeHandshakeMessage({
            type: 'hello',
            v: PROTOCOL_VERSION,
            pairId: this.config.pairId,
            nonce: base64urlEncode(nonceGuest),
          }),
        );
      }
      this.unsubscribeData = this.channel.onData((chunk) => this.onData(chunk));
      this.unsubscribeClose = this.channel.onClose((reason) => this.onTransportClose(reason));
      if (this.isFinished()) {
        this.detach(); // the transport replayed bytes (or a close) while we were still subscribing
        return;
      }
      if (hello !== null) this.transmit(hello);
    } catch (error) {
      this.fail(error);
    }
  }

  // ---- events --------------------------------------------------------------------------------------------

  private onData(chunk: Uint8Array): void {
    if (this.isFinished()) return;
    try {
      this.decoder.push(chunk);
    } catch {
      this.fail(new ProtocolError('malformed-frame', 'link delivered a non-byte chunk'), {
        reason: 'malformed',
      });
      return;
    }
    this.pump();
  }

  private onTransportClose(reason: string): void {
    this.fail(
      new ProtocolError('closed', `link closed during the handshake (${sanitizeReason(reason)})`),
      undefined,
      true,
    );
  }

  private onTimeout(): void {
    this.timerArmed = false;
    if (this.settled) return;
    const timeout = new ProtocolError('handshake-timeout', 'secure handshake timed out');
    switch (this.phase) {
      case 'failed':
        // A failure is already being wrapped up (a hint or a close is stuck): settle now with the original error.
        this.closeTransport(false);
        this.settle(() => this.rejectPromise(this.failure));
        return;
      case 'finishing':
        this.failFinishing(timeout);
        return;
      case 'done':
        return;
      default:
        this.fail(timeout);
    }
  }

  private onSendFailed(): void {
    // A failed write does not mean the link has closed (a half-open socket still needs closing): close it ourselves.
    this.fail(new ProtocolError('closed', 'link send failed during the handshake'));
  }

  // ---- frame loop ----------------------------------------------------------------------------------------

  private pump(): void {
    while (!this.isFinished() && this.phase !== 'finishing') {
      let frame: Uint8Array | null;
      try {
        frame = this.decoder.next();
      } catch (error) {
        this.fail(error, { reason: 'malformed' });
        return;
      }
      if (frame === null) return;
      try {
        this.handleFrame(frame);
      } catch (error) {
        this.fail(error); // unexpected: a bug or a failing CryptoProvider; reject with it as it is
        return;
      }
    }
  }

  private handleFrame(frame: Uint8Array): void {
    switch (this.phase) {
      case 'await-hello':
        this.onHello(frame);
        return;
      case 'await-hello-ack':
        this.onHelloAck(frame);
        return;
      case 'await-auth':
        this.onAuth(frame);
        return;
      case 'await-ready':
        this.onReady(frame);
        return;
      default:
        return;
    }
  }

  /** Parses a plain handshake frame; on failure the handshake is already failed and null comes back. */
  private parsePlain(frame: Uint8Array): ParsedHandshakeMessage | null {
    try {
      return parseHandshakeMessage(frame);
    } catch (error) {
      this.fail(error, { reason: 'malformed' });
      return null;
    }
  }

  private unexpected(): void {
    this.fail(new ProtocolError('malformed-frame', 'unexpected handshake message for this step'), {
      reason: 'malformed',
    });
  }

  // ---- host ----------------------------------------------------------------------------------------------

  private onHello(frame: Uint8Array): void {
    const message = this.parsePlain(frame);
    if (message === null) return;
    if (message.type === 'reject') {
      this.fail(errorFromReject(message));
      return;
    }
    if (message.type !== 'hello') {
      this.unexpected();
      return;
    }
    // Cheap, crypto-free checks first: an unauthenticated peer must not make us spend any cryptographic work.
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(message.v)) {
      this.fail(new ProtocolError('unsupported-version', `peer speaks protocol version ${message.v}`), {
        reason: 'unsupported-version',
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      });
      return;
    }
    if (message.pairId !== this.config.pairId) {
      this.fail(new ProtocolError('unknown-pair', 'peer asked for a pairing this device does not hold'), {
        reason: 'unknown-pair',
      });
      return;
    }
    const { crypto, pairIdBytes } = this.config;
    const nonceGuest = message.nonce;
    const nonceHost = drawNonce(crypto);
    if (crypto.timingSafeEqual(nonceGuest, nonceHost)) {
      // The guest nonce equals our fresh one: a reflected nonce or a broken random source. Never proceed.
      this.fail(new ProtocolError('bad-proof', 'peer nonce collides with ours'), { reason: 'bad-proof' });
      return;
    }
    const authKey = deriveAuthKey(crypto, this.config.secret);
    const proof = computeProof(crypto, authKey, 'host', pairIdBytes, nonceGuest, nonceHost);
    this.nonceGuest = nonceGuest;
    this.nonceHost = nonceHost;
    this.authKey = authKey;
    this.phase = 'await-auth';
    this.transmit(
      encodeFrame(
        encodeHandshakeMessage({
          type: 'hello-ack',
          v: message.v,
          nonce: base64urlEncode(nonceHost),
          proof: base64urlEncode(proof),
        }),
      ),
    );
  }

  private onAuth(frame: Uint8Array): void {
    const message = this.parsePlain(frame);
    if (message === null) return;
    if (message.type === 'reject') {
      this.fail(errorFromReject(message));
      return;
    }
    if (message.type !== 'auth') {
      this.unexpected();
      return;
    }
    const { crypto, pairIdBytes } = this.config;
    const { authKey, nonceGuest, nonceHost } = this;
    if (authKey === null || nonceGuest === null || nonceHost === null)
      throw new Error('handshake state missing');
    const expected = computeProof(crypto, authKey, 'guest', pairIdBytes, nonceGuest, nonceHost);
    const valid = crypto.timingSafeEqual(expected, message.proof);
    wipe(expected);
    if (!valid) {
      this.fail(new ProtocolError('bad-proof', 'guest proof rejected'), { reason: 'bad-proof' });
      return;
    }
    const keys = deriveSessionKeys(crypto, this.config.secret, nonceGuest, nonceHost);
    this.handOver('host', keys, 0, 0);
    const secure = this.secure;
    if (secure === null) return;
    // `ready` is the host's first authenticated message (its counter 0): proof for the guest that we accepted its
    // proof and derived the same keys.
    secure.send({ type: 'ready' }).then(
      () => this.finish(secure),
      () =>
        this.failFinishing(
          secure.closeError ?? new ProtocolError('closed', 'link closed before ready was sent'),
        ),
    );
  }

  // ---- guest ---------------------------------------------------------------------------------------------

  private onHelloAck(frame: Uint8Array): void {
    const message = this.parsePlain(frame);
    if (message === null) return;
    if (message.type === 'reject') {
      this.fail(errorFromReject(message));
      return;
    }
    if (message.type !== 'hello-ack') {
      this.unexpected();
      return;
    }
    if (message.v !== PROTOCOL_VERSION) {
      this.fail(
        new ProtocolError('unsupported-version', `peer answered with protocol version ${message.v}`),
        {
          reason: 'unsupported-version',
          supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        },
      );
      return;
    }
    const { crypto, pairIdBytes } = this.config;
    const nonceGuest = this.nonceGuest;
    if (nonceGuest === null) throw new Error('handshake state missing');
    const nonceHost = message.nonce;
    if (crypto.timingSafeEqual(nonceGuest, nonceHost)) {
      // Our own nonce came back as the host's: a reflection attempt or a broken random source.
      this.fail(new ProtocolError('bad-proof', 'peer nonce collides with ours'), { reason: 'bad-proof' });
      return;
    }
    const authKey = deriveAuthKey(crypto, this.config.secret);
    const expected = computeProof(crypto, authKey, 'host', pairIdBytes, nonceGuest, nonceHost);
    const valid = crypto.timingSafeEqual(expected, message.proof);
    wipe(expected);
    if (!valid) {
      wipe(authKey);
      this.fail(new ProtocolError('bad-proof', 'host proof rejected'), { reason: 'bad-proof' });
      return;
    }
    const guestProof = computeProof(crypto, authKey, 'guest', pairIdBytes, nonceGuest, nonceHost);
    wipe(authKey);
    this.keys = deriveSessionKeys(crypto, this.config.secret, nonceGuest, nonceHost);
    this.nonceHost = nonceHost;
    this.phase = 'await-ready';
    this.transmit(encodeFrame(encodeHandshakeMessage({ type: 'auth', proof: base64urlEncode(guestProof) })));
  }

  private onReady(frame: Uint8Array): void {
    const keys = this.keys;
    if (keys === null) throw new Error('handshake state missing');
    const opened = openFrame(this.config.crypto, keys.hostToGuest, 0, frame);
    if (!opened.ok) {
      // The host answers a proof it does not accept with a plain `reject` instead of `ready`.
      const hint = tryParseReject(frame);
      if (hint !== null) {
        this.fail(errorFromReject(hint));
        return;
      }
      this.fail(
        opened.reason === 'bad-mac'
          ? new ProtocolError('bad-mac', 'first authenticated frame failed verification')
          : new ProtocolError('malformed-frame', 'first authenticated frame is too short'),
      );
      return;
    }
    let first;
    try {
      first = parseSessionMessage(opened.body);
    } catch (error) {
      this.fail(error);
      return;
    }
    if (first.type !== 'ready') {
      this.fail(new ProtocolError('malformed-frame', 'first authenticated message was not ready'));
      return;
    }
    this.handOver('guest', keys, 0, 1);
    const secure = this.secure;
    if (secure === null) return;
    if (secure.closeError !== null) {
      this.failFinishing(secure.closeError); // the peer broke the protocol right behind `ready`
      return;
    }
    this.finish(secure);
  }

  // ---- completion ----------------------------------------------------------------------------------------

  /** Moves the decoder, keys and link subscription over to the SecureChannel. */
  private handOver(role: Role, keys: SessionKeys, sendCounter: number, recvCounter: number): void {
    this.phase = 'finishing';
    this.detach();
    wipe(this.authKey);
    this.authKey = null;
    this.keys = null; // from here on the secure channel owns (and wipes) the key arrays
    this.decoder.maxFrameBytes = MAX_FRAME_BYTES;
    this.secure = new SecureChannelImpl({
      role,
      channel: this.channel,
      decoder: this.decoder,
      crypto: this.config.crypto,
      sendKey: role === 'host' ? keys.hostToGuest : keys.guestToHost,
      recvKey: role === 'host' ? keys.guestToHost : keys.hostToGuest,
      sendCounter,
      recvCounter,
    });
  }

  private finish(secure: SecureChannelImpl): void {
    if (this.phase !== 'finishing') return;
    this.phase = 'done';
    this.settle(() => this.resolvePromise(secure));
  }

  private failFinishing(error: unknown): void {
    if (this.phase !== 'finishing') return;
    this.phase = 'failed';
    this.failure = error;
    this.closeStarted = true;
    void this.secure?.close(); // closes the link as well
    this.settle(() => this.rejectPromise(error));
  }

  /**
   * Ends the handshake in failure. `hint` is sent as a plain `reject` first (best effort) so the peer can tell
   * "wrong pairing" from "link dropped"; `transportGone` means the link already closed and nothing can be sent.
   */
  private fail(error: unknown, hint?: RejectHint, transportGone = false): void {
    if (this.phase === 'failed' || this.phase === 'done') return;
    if (this.phase === 'finishing') {
      this.failFinishing(error);
      return;
    }
    this.phase = 'failed';
    this.failure = error;
    this.detach();
    this.wipeSecrets();
    void this.wrapUp(hint, transportGone);
  }

  private async wrapUp(hint: RejectHint | undefined, transportGone: boolean): Promise<void> {
    if (hint !== undefined && !transportGone) {
      try {
        await this.channel.send(
          encodeFrame(
            encodeHandshakeMessage(
              hint.supportedVersions === undefined
                ? { type: 'reject', reason: hint.reason }
                : { type: 'reject', reason: hint.reason, supportedVersions: hint.supportedVersions },
            ),
          ),
        );
      } catch {
        // Best effort: the hint is a courtesy, the close below is what matters.
      }
    }
    this.closeTransport(transportGone);
    this.settle(() => this.rejectPromise(this.failure));
  }

  private closeTransport(transportGone: boolean): void {
    if (this.closeStarted) return;
    this.closeStarted = true;
    if (!transportGone) void closeQuietly(this.channel);
  }

  private settle(action: () => void): void {
    if (this.settled) return;
    this.settled = true;
    this.clearTimer();
    this.wipeSecrets();
    action();
  }

  // ---- plumbing ------------------------------------------------------------------------------------------

  private transmit(frame: Uint8Array): void {
    try {
      Promise.resolve(this.channel.send(frame)).catch(() => this.onSendFailed());
    } catch {
      this.onSendFailed();
    }
  }

  private isFinished(): boolean {
    return this.phase === 'failed' || this.phase === 'done';
  }

  private detach(): void {
    this.unsubscribeData?.();
    this.unsubscribeClose?.();
    this.unsubscribeData = null;
    this.unsubscribeClose = null;
  }

  private clearTimer(): void {
    if (!this.timerArmed) return;
    this.timerArmed = false;
    this.config.clearTimeout(this.timer);
  }

  private wipeSecrets(): void {
    wipe(this.config.secret, this.authKey);
    this.authKey = null;
    if (this.keys !== null) {
      wipe(this.keys.guestToHost, this.keys.hostToGuest);
      this.keys = null;
    }
  }
}

/**
 * Runs the handshake over `channel` and resolves with an authenticated channel, or rejects (closing `channel`)
 * with a ProtocolError. Bad options are programmer errors and reject with TypeError. See the file header.
 */
export const establishSecureChannel: EstablishSecureChannel = (channel, options) =>
  new Promise<SecureChannel>((resolve, reject) => {
    let config: ResolvedOptions;
    try {
      config = resolveOptions(options);
    } catch (error) {
      void closeQuietly(channel);
      reject(error);
      return;
    }
    new Handshake(channel, config, resolve, reject).start();
  });
