import type { Unsubscribe } from '../common/types';
import type { CryptoProvider } from './crypto';
import type { SessionMessage } from './messages';

/**
 * Minimal byte pipe the protocol layer needs. platform/link `LinkChannel` extends this, so
 * src/core/protocol has no platform imports. Delivery is ordered and reliable (TCP / WebSocket).
 * Chunk boundaries are arbitrary: the frame decoder must reassemble across chunks and split multi-frame chunks.
 */
export interface ByteChannel {
  send(data: Uint8Array): Promise<void>;
  onData(listener: (data: Uint8Array) => void): Unsubscribe;
  onClose(listener: (reason: string) => void): Unsubscribe;
  close(): Promise<void>;
}

export type ProtocolErrorCode =
  | 'handshake-timeout'
  | 'unsupported-version'
  | 'unknown-pair'
  | 'bad-proof'
  | 'bad-mac'
  | 'malformed-frame'
  | 'frame-too-large'
  | 'busy'
  | 'closed';

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  constructor(code: ProtocolErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/** Authenticated, framed message channel produced by a completed handshake. */
export interface SecureChannel {
  readonly role: 'host' | 'guest';
  /** Frames and MACs the message. Rejects with ProtocolError('closed') once closed. */
  send(message: SessionMessage): Promise<void>;
  /** Only messages that passed MAC verification are delivered. A MAC failure closes the channel. */
  onMessage(listener: (message: SessionMessage) => void): Unsubscribe;
  /** Fires once, with the ProtocolError code or a transport reason. */
  onClose(listener: (reason: string) => void): Unsubscribe;
  close(): Promise<void>;
}

export interface SecureChannelOptions {
  role: 'host' | 'guest';
  /** From the stored PairingRecord. `secret` is the decoded 32 bytes. */
  pairId: string;
  secret: Uint8Array;
  crypto: CryptoProvider;
  /** Handshake deadline from the first byte; default 5000. */
  handshakeTimeoutMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * Runs the handshake over `channel` and resolves with an authenticated channel, or rejects with ProtocolError
 * (closing `channel`). Implemented in src/core/protocol/establish.ts by `core-protocol`.
 */
export type EstablishSecureChannel = (
  channel: ByteChannel,
  options: SecureChannelOptions,
) => Promise<SecureChannel>;
