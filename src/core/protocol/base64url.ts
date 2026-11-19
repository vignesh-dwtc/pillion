/**
 * Base64url (RFC 4648 section 5) without padding, implemented here because neither Buffer nor atob/btoa can be
 * assumed in Hermes. Decoding is STRICT and canonical: exactly one text per byte string, so a value cannot be
 * re-encoded into a different-looking but equivalent string (no padding, no '+' '/', no whitespace, no non-zero
 * trailing bits).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const LOOKUP: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** Length of the unpadded base64url text for `byteLength` bytes. */
export function base64urlLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

export function base64urlEncode(bytes: Uint8Array): string {
  const pieces: string[] = [];
  let chunk = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const triple = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    chunk +=
      ALPHABET.charAt((triple >> 18) & 63) +
      ALPHABET.charAt((triple >> 12) & 63) +
      ALPHABET.charAt((triple >> 6) & 63) +
      ALPHABET.charAt(triple & 63);
    if (chunk.length >= 4096) {
      pieces.push(chunk);
      chunk = '';
    }
  }
  const rest = n - i;
  if (rest === 1) {
    const triple = (bytes[i] ?? 0) << 16;
    chunk += ALPHABET.charAt((triple >> 18) & 63) + ALPHABET.charAt((triple >> 12) & 63);
  } else if (rest === 2) {
    const triple = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    chunk +=
      ALPHABET.charAt((triple >> 18) & 63) +
      ALPHABET.charAt((triple >> 12) & 63) +
      ALPHABET.charAt((triple >> 6) & 63);
  }
  pieces.push(chunk);
  return pieces.join('');
}

function sextet(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return code < 128 ? (LOOKUP[code] ?? -1) : -1;
}

/** Strict canonical decode. Returns null for anything that is not exactly what `base64urlEncode` could produce. */
export function base64urlDecode(text: string): Uint8Array | null {
  if (typeof text !== 'string') return null;
  const n = text.length;
  if (n % 4 === 1) return null;
  const fullGroups = Math.floor(n / 4);
  const rest = n % 4;
  const out = new Uint8Array(fullGroups * 3 + (rest === 0 ? 0 : rest - 1));
  let o = 0;
  let i = 0;
  for (let g = 0; g < fullGroups; g++, i += 4) {
    const a = sextet(text, i);
    const b = sextet(text, i + 1);
    const c = sextet(text, i + 2);
    const d = sextet(text, i + 3);
    if ((a | b | c | d) < 0) return null;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (triple >> 16) & 0xff;
    out[o++] = (triple >> 8) & 0xff;
    out[o++] = triple & 0xff;
  }
  if (rest === 2) {
    const a = sextet(text, i);
    const b = sextet(text, i + 1);
    if ((a | b) < 0) return null;
    if ((b & 0x0f) !== 0) return null; // non-canonical trailing bits
    out[o++] = (a << 2) | (b >> 4);
  } else if (rest === 3) {
    const a = sextet(text, i);
    const b = sextet(text, i + 1);
    const c = sextet(text, i + 2);
    if ((a | b | c) < 0) return null;
    if ((c & 0x03) !== 0) return null; // non-canonical trailing bits
    out[o++] = (a << 2) | (b >> 4);
    out[o++] = ((b & 0x0f) << 4) | (c >> 2);
  }
  return out;
}
