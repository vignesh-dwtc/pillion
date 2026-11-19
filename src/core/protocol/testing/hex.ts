export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error('invalid hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/**
 * Equality that reports a boolean only. Jest prints both operands when `expect(a).toEqual(b)` fails, which would put
 * key material into test output: compare secrets with this and assert on the boolean.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function filled(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}

/** 0, 1, 2, ... wrapping at 256, plus an offset: a recognisable, obviously fake pattern for fixtures. */
export function pattern(length: number, offset = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i + offset) & 0xff;
  return out;
}
