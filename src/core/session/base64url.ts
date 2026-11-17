/**
 * Minimal base64url codec (RFC 4648 section 5). Self-contained on purpose: the session layer must not rely on
 * `atob` / `Buffer` existing in every runtime (Hermes), and must not depend on another owner's helper module.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Decodes unpadded (or padded) base64url. Returns null for anything that is not valid base64url. */
export function decodeBase64Url(input: string): Uint8Array | null {
  const text = input.replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  // A single leftover sextet cannot encode a byte.
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < text.length; i += 1) {
    accumulator = (accumulator << 6) | ALPHABET.indexOf(text.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
    accumulator &= (1 << bits) - 1;
  }
  return out;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  let accumulator = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    accumulator = (accumulator << 8) | (bytes[i] ?? 0);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET.charAt((accumulator >> bits) & 0x3f);
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET.charAt((accumulator << (6 - bits)) & 0x3f);
  return out;
}
