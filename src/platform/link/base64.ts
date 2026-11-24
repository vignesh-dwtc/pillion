/**
 * Standard Base64 (RFC 4648 section 4, '=' padding, no line breaks): the byte encoding of the IntercomLink bridge
 * (specs/IntercomLink.ts "BYTE ENCODING"). Self-contained so it does not depend on `atob`/`btoa`/`Buffer` being present
 * in the JS runtime.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i += 1) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

/** @throws Error when `text` is not canonical standard Base64. */
export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new Error('invalid base64 length');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const last = i + 4 === text.length;
    const values = [0, 0, 0, 0];
    for (let j = 0; j < 4; j += 1) {
      const code = text.charCodeAt(i + j);
      if (last && code === 61 /* '=' */ && j >= 4 - padding) continue;
      const v = code < 128 ? LOOKUP[code]! : -1;
      if (v < 0) throw new Error('invalid base64 character');
      values[j] = v;
    }
    const n = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!;
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
