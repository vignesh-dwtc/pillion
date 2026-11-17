import { isBytes, readU32BE, u32ToBytes } from './bytes';
import { MAX_FRAME_BYTES } from './constants';
import { ProtocolError } from './secureChannel';

/**
 * Frame codec: `[u32 big-endian payload length][payload]`.
 *
 * Decoder guarantees:
 *  - reassembles frames across arbitrary chunk boundaries and splits chunks that hold several frames;
 *  - the declared length is validated the moment the 4 header bytes are available, BEFORE any buffer is sized from
 *    it: memory use is bounded by the bytes actually received, never by what a peer claims;
 *  - a frame over the limit is `frame-too-large`; a zero-length frame is `malformed-frame` (no legitimate payload is
 *    empty); either poisons the decoder for good (the stream cannot be resynchronised);
 *  - copies every pushed chunk, so a transport that reuses its read buffer cannot corrupt a half-received frame.
 */

export const FRAME_HEADER_BYTES = 4;

export function encodeFrame(payload: Uint8Array, maxFrameBytes: number = MAX_FRAME_BYTES): Uint8Array {
  if (!isBytes(payload)) throw new TypeError('Uint8Array expected');
  if (payload.length === 0) throw new ProtocolError('malformed-frame', 'empty frame');
  if (payload.length > maxFrameBytes) {
    throw new ProtocolError('frame-too-large', `frame of ${payload.length} bytes exceeds ${maxFrameBytes}`);
  }
  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  out.set(u32ToBytes(payload.length), 0);
  out.set(payload, FRAME_HEADER_BYTES);
  return out;
}

function checkLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_FRAME_BYTES) {
    throw new RangeError('frame limit must be an integer between 1 and MAX_FRAME_BYTES');
  }
  return value;
}

const EMPTY = new Uint8Array(0);
/** Buffers larger than this are released as soon as the decoder runs empty. */
const KEEP_BUFFER_BYTES = 4096;

/**
 * Pull-based: `push` stores bytes, `next` hands out one complete frame at a time. Pulling lets the caller change
 * `maxFrameBytes` between frames (the secure channel tightens it before authentication and relaxes it after) even
 * when one chunk carries frames from both phases.
 */
export class FrameDecoder {
  private limit: number;
  private buffer: Uint8Array = EMPTY;
  private start = 0;
  private end = 0;
  private failure: ProtocolError | null = null;

  constructor(maxFrameBytes: number = MAX_FRAME_BYTES) {
    this.limit = checkLimit(maxFrameBytes);
  }

  get maxFrameBytes(): number {
    return this.limit;
  }

  /** Applies from the next frame header on. Never above MAX_FRAME_BYTES. */
  set maxFrameBytes(value: number) {
    this.limit = checkLimit(value);
  }

  /** Bytes received and not yet handed out as part of a frame. */
  get bufferedBytes(): number {
    return this.end - this.start;
  }

  /** The violation that poisoned this decoder, if any. */
  get error(): ProtocolError | null {
    return this.failure;
  }

  /** Stores a copy of `chunk`. Ignored once the decoder is poisoned. Throws TypeError for non-bytes (a transport bug). */
  push(chunk: Uint8Array): void {
    if (!isBytes(chunk)) throw new TypeError('Uint8Array expected');
    if (this.failure !== null || chunk.length === 0) return;
    this.reserve(chunk.length);
    this.buffer.set(chunk, this.end);
    this.end += chunk.length;
  }

  /**
   * The next complete frame payload (a fresh copy), or null when more bytes are needed. Throws ProtocolError on a
   * violation and keeps throwing it afterwards.
   */
  next(): Uint8Array | null {
    if (this.failure !== null) throw this.failure;
    if (this.end - this.start < FRAME_HEADER_BYTES) return null;
    const length = readU32BE(this.buffer, this.start);
    if (length === 0) throw this.poison(new ProtocolError('malformed-frame', 'empty frame'));
    if (length > this.limit) {
      throw this.poison(
        new ProtocolError('frame-too-large', `frame of ${length} bytes exceeds ${this.limit}`),
      );
    }
    if (this.end - this.start < FRAME_HEADER_BYTES + length) return null;
    const from = this.start + FRAME_HEADER_BYTES;
    const payload = this.buffer.slice(from, from + length);
    this.start = from + length;
    if (this.start === this.end) {
      this.start = 0;
      this.end = 0;
      if (this.buffer.length > KEEP_BUFFER_BYTES) this.buffer = EMPTY;
    }
    return payload;
  }

  private poison(error: ProtocolError): ProtocolError {
    this.failure = error;
    this.buffer = EMPTY;
    this.start = 0;
    this.end = 0;
    return error;
  }

  /** Makes room for `extra` more bytes: compact in place when possible, otherwise grow geometrically. */
  private reserve(extra: number): void {
    if (this.end + extra <= this.buffer.length) return;
    const used = this.end - this.start;
    if (used + extra <= this.buffer.length) {
      this.buffer.copyWithin(0, this.start, this.end);
      this.start = 0;
      this.end = used;
      return;
    }
    const grown = new Uint8Array(Math.max(used + extra, this.buffer.length * 2, 256));
    grown.set(this.buffer.subarray(this.start, this.end), 0);
    this.buffer = grown;
    this.start = 0;
    this.end = used;
  }
}
