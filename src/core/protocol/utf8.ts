/**
 * UTF-8 without TextEncoder / TextDecoder (neither is guaranteed in Hermes).
 *
 * Encoding follows the WHATWG encoder: a lone surrogate becomes U+FFFD. Decoding is STRICT (it returns null instead
 * of substituting U+FFFD): overlong forms, surrogate code points, values above U+10FFFF, truncated sequences and stray
 * continuation bytes are all rejected. The protocol never needs lenient decoding of untrusted bytes.
 */

const REPLACEMENT = 0xfffd;

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** Number of bytes `utf8Encode(text)` produces, computed without allocating. */
export function utf8Length(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      length += 1;
    } else if (unit < 0x800) {
      length += 2;
    } else if (isHighSurrogate(unit) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      length += 4;
      i += 1;
    } else {
      length += 3; // BMP character, or a lone surrogate encoded as U+FFFD
    }
  }
  return length;
}

export function utf8Encode(text: string): Uint8Array {
  if (typeof text !== 'string') throw new TypeError('string expected');
  const out = new Uint8Array(utf8Length(text));
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    let codePoint = text.charCodeAt(i);
    if (isHighSurrogate(codePoint) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      i += 1;
    } else if (isHighSurrogate(codePoint) || isLowSurrogate(codePoint)) {
      codePoint = REPLACEMENT;
    }
    if (codePoint < 0x80) {
      out[o++] = codePoint;
    } else if (codePoint < 0x800) {
      out[o++] = 0xc0 | (codePoint >> 6);
      out[o++] = 0x80 | (codePoint & 0x3f);
    } else if (codePoint < 0x10000) {
      out[o++] = 0xe0 | (codePoint >> 12);
      out[o++] = 0x80 | ((codePoint >> 6) & 0x3f);
      out[o++] = 0x80 | (codePoint & 0x3f);
    } else {
      out[o++] = 0xf0 | (codePoint >> 18);
      out[o++] = 0x80 | ((codePoint >> 12) & 0x3f);
      out[o++] = 0x80 | ((codePoint >> 6) & 0x3f);
      out[o++] = 0x80 | (codePoint & 0x3f);
    }
  }
  return out;
}

function isContinuation(byte: number | undefined): byte is number {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

const FLUSH_AT = 2048;

/** Strict UTF-8 decode. Returns null for any malformed input. */
export function utf8Decode(bytes: Uint8Array): string | null {
  const parts: string[] = [];
  let units: number[] = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b0 = bytes[i] ?? 0;
    let codePoint: number;
    if (b0 < 0x80) {
      codePoint = b0;
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      const b1 = bytes[i + 1];
      if (!isContinuation(b1)) return null;
      codePoint = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if (!isContinuation(b1) || !isContinuation(b2)) return null;
      if (b0 === 0xe0 && b1 < 0xa0) return null; // overlong
      if (b0 === 0xed && b1 > 0x9f) return null; // UTF-16 surrogate code points
      codePoint = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      if (!isContinuation(b1) || !isContinuation(b2) || !isContinuation(b3)) return null;
      if (b0 === 0xf0 && b1 < 0x90) return null; // overlong
      if (b0 === 0xf4 && b1 > 0x8f) return null; // above U+10FFFF
      codePoint = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      i += 4;
    } else {
      return null; // 0x80..0xC1 (stray continuation / overlong lead) and 0xF5..0xFF
    }
    if (codePoint >= 0x10000) {
      const offset = codePoint - 0x10000;
      units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      units.push(codePoint);
    }
    if (units.length >= FLUSH_AT) {
      parts.push(String.fromCharCode(...units));
      units = [];
    }
  }
  if (units.length > 0) parts.push(String.fromCharCode(...units));
  return parts.join('');
}
