/**
 * Byte helpers for the protocol layer. Pure TypeScript: no Buffer, no TextEncoder, no BigInt (Hermes-safe).
 */

/** True for Uint8Array and subclasses (Node Buffer), also across realms (Jest sandboxes, iframes). */
export function isBytes(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    (ArrayBuffer.isView(value) &&
      value.constructor.name === 'Uint8Array' &&
      (value as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1)
  );
}

/** Concatenates into a fresh array. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
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

/** Independent copy with its own ArrayBuffer (Node's Buffer.slice would alias instead). */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

/** Best-effort zeroisation of key material (JavaScript cannot guarantee that no other copy exists). */
export function wipe(...arrays: (Uint8Array | null | undefined)[]): void {
  for (const array of arrays) array?.fill(0);
}

/** Big-endian u32. Throws RangeError for values outside 0..2^32-1 (programmer error). */
export function u32ToBytes(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError('u32 out of range');
  }
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

/** Reads a big-endian u32. Throws RangeError when fewer than 4 bytes are available at `offset`. */
export function readU32BE(bytes: Uint8Array, offset = 0): number {
  if (!Number.isInteger(offset) || offset < 0 || offset + 4 > bytes.length) {
    throw new RangeError('u32 read out of bounds');
  }
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

const TWO_POW_32 = 0x1_0000_0000;

/**
 * Big-endian u64 for a JavaScript number. Only safe integers (< 2^53) are representable; message counters never
 * get anywhere near that. Throws RangeError otherwise (programmer error).
 */
export function u64ToBytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('u64 out of range');
  const high = Math.floor(value / TWO_POW_32);
  const low = value % TWO_POW_32;
  const out = new Uint8Array(8);
  out.set(u32ToBytes(high), 0);
  out.set(u32ToBytes(low), 4);
  return out;
}

/** Reads a big-endian u64. Throws RangeError when it does not fit a safe integer. */
export function readU64BE(bytes: Uint8Array, offset = 0): number {
  const high = readU32BE(bytes, offset);
  const low = readU32BE(bytes, offset + 4);
  if (high > 0x1f_ffff) throw new RangeError('u64 does not fit a safe integer');
  return high * TWO_POW_32 + low;
}
